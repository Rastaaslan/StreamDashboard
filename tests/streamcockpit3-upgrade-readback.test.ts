import {afterEach,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDurableDesktopUpgradePlanner} from '../apps/desktop/src/streamcockpit-upgrade.js';
import {createUpgradeReadbackReconciler,type UpgradeReadbackIdentity,type UpgradeReadbackExpectation} from '../apps/desktop/src/streamcockpit-upgrade-readback.js';
import type {UpgradeManifest} from '../packages/core/src/streamcockpit-upgrade.js';

const manifest:UpgradeManifest={id:'sc3-readback-lab',version:'3.0.0',fromVersion:'2.1.0',target:'desktop',
  source:'https://example.test/qa-only',sha256:'f'.repeat(64),signature:{keyId:'lab',value:'synthetic-only'},
  schema:{from:1,to:2}};
const digest=(data:string)=>createHash('sha256').update(data).digest('hex');
const body=(tag:string)=>({
  packageFiles:[{path:'StreamCockpit.exe',sha256:digest(tag+'-exe'),bytes:Buffer.byteLength(tag+'-exe')},
    {path:'resources/app.asar',sha256:digest(tag+'-asar'),bytes:Buffer.byteLength(tag+'-asar')}],
  profileFiles:[{path:'configuration/settings.json',sha256:digest(tag+'-settings'),bytes:Buffer.byteLength(tag+'-settings')},
    {path:'ledger/receipt.sqlite',sha256:digest(tag+'-receipt'),bytes:Buffer.byteLength(tag+'-receipt')}],
});
const before:UpgradeReadbackExpectation={identity:{version:'2.1.0',revision:'a'.repeat(40),applicationId:'com.sc3.windows',signer:'OLD_PIN'},
  ...body('old')};
const after:UpgradeReadbackExpectation={identity:{version:'3.0.0',revision:'b'.repeat(40),applicationId:'com.sc3.windows',signer:'NEW_PIN'},
  ...body('new')};
const roots:string[]=[];
const now=1_000_000;
const identity=(value:UpgradeReadbackExpectation):UpgradeReadbackIdentity=>({...value.identity,observedAt:now});
async function fixture(){
  const root=await mkdtemp(join(tmpdir(),'sc3-readback-'));roots.push(root);
  const packageRoot=join(root,'installed-app'),profileRoot=join(root,'installed-profile');
  const coordinator=join(root,'coordinator');await Promise.all([mkdir(packageRoot),mkdir(profileRoot),mkdir(coordinator)]);
  let attested:UpgradeReadbackIdentity|undefined=identity(before);
  const attestInstalled=vi.fn(async()=>attested);
  const write=async(expected:UpgradeReadbackExpectation,tag:string)=>{
    for(const [folder,entries] of [[packageRoot,expected.packageFiles],[profileRoot,expected.profileFiles]] as const){
      for(const entry of entries){const target=join(folder,...entry.path.split('/'));
        await mkdir(join(target,'..'),{recursive:true});await writeFile(target,tag+'-'+
          (entry.path.endsWith('.exe')?'exe':entry.path.endsWith('.asar')?'asar':entry.path.endsWith('settings.json')?'settings':'receipt'));
      }
    }
    attested=identity(expected);
  };
  await write(before,'old');
  const readback=()=>createUpgradeReadbackReconciler({manifest,packageRoot,profileRoot,target:after,rollback:before,
    attestInstalled,now:()=>now});
  return {root,coordinator,packageRoot,profileRoot,write,readback,attestInstalled,identity:(id:UpgradeReadbackIdentity|undefined)=>{attested=id}};
}
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})))});

it('confirms actual package AND complete profile bytes, independent identity twice, only for the pending exact action key',async()=>{
  const f=await fixture();await f.write(after,'new');
  const rec=f.readback();
  expect(await rec('stage',manifest.id+':stage')).toBeUndefined();
  expect(await rec('install','OTHER:install')).toBeUndefined();
  expect(await rec('install',manifest.id+':install')).toMatchObject({reference:expect.stringMatching(/^readback:install:[a-f0-9]{64}$/)});
  expect(f.attestInstalled).toHaveBeenCalledTimes(2);
});
it('rejects stale, missing, wrong-signer or changed identities even when package and profile hashes match',async()=>{
  const f=await fixture();await f.write(after,'new');const valid=identity(after);
  for(const wrong of [undefined,{...valid,signer:'SPOOF'}, {...valid,version:'2.1.0'}, {...valid,revision:'0'.repeat(40)},
    {...valid,applicationId:'other'}, {...valid,observedAt:now-6000},{...valid,observedAt:now+1}]){
    f.identity(wrong);expect(await f.readback()('install',manifest.id+':install')).toBeUndefined();
  }
  f.identity(valid);f.attestInstalled.mockResolvedValueOnce(valid).mockResolvedValueOnce({...valid,signer:'CHANGED'});
  expect(await f.readback()('install',manifest.id+':install')).toBeUndefined();
});
it('rejects modified or extra app and profile files and never modifies them during inspection',async()=>{
  const f=await fixture();await f.write(after,'new');const check=()=>f.readback()('install',manifest.id+':install');
  const bad=join(f.packageRoot,'StreamCockpit.exe'),original=await readFile(bad);
  await writeFile(bad,'tampered');expect(await check()).toBeUndefined();
  expect((await readFile(bad)).toString()).toBe('tampered');
  await writeFile(bad,original);expect(await check()).toBeDefined();
  const extra=join(f.profileRoot,'injected.txt');
  await writeFile(extra,'surprise');expect(await check()).toBeUndefined();
  expect((await readFile(extra)).toString()).toBe('surprise');
});
it('refuses no attester, invalid expected inventory, or unavailable paths rather than inventing a recovery receipt',async()=>{
  const f=await fixture();await f.write(after,'new');
  expect(await createUpgradeReadbackReconciler({manifest,packageRoot:f.packageRoot,profileRoot:f.profileRoot,
    target:after,rollback:before,now:()=>now})('install',manifest.id+':install')).toBeUndefined();
  expect(()=>createUpgradeReadbackReconciler({manifest,packageRoot:f.packageRoot,profileRoot:f.profileRoot,
    target:{...after,profileFiles:[...after.profileFiles,after.profileFiles[0]]},rollback:before,
    attestInstalled:f.attestInstalled})).toThrow();
  f.attestInstalled.mockRejectedValueOnce(Error('Bearer SECRET_ONLY_FIXTURE'));
  expect(await f.readback()('install',manifest.id+':install')).toBeUndefined();
});
it('reconciles a lost install and rollback ACK on persisted SQLite journal WITHOUT another side effect',async()=>{
  const f=await fixture();const installed=vi.fn(async()=>{await f.write(after,'new');throw Error('simulated ack lost')});
  const restored=vi.fn(async()=>{await f.write(before,'old');throw Error('simulated rollback ack lost')});
  const make=()=>createDurableDesktopUpgradePlanner(f.coordinator,{
    verify:async()=>true,stage:async()=>({reference:'synthetic-staged'}),
    backup:async()=>({reference:'synthetic-backup'}),migrate:async()=>({reference:'synthetic-migrated'}),
    install:installed,rollback:restored,reconcile:f.readback(),
  },{assessRestartSafety:async()=>({safe:true})});
  const one=make();await one.register(manifest,'synthetic-artifact');
  const interrupted=await one.install();expect(interrupted.phase).toBe('deferred');
  expect(interrupted.pending?.operation).toBe('install');expect(installed).toHaveBeenCalledTimes(1);
  const recovered=await make().install();expect(recovered.phase).toBe('installed');
  expect(recovered.installed).toBe(true);expect(installed).toHaveBeenCalledTimes(1);
  const firstRollback=await make().rollback();expect(firstRollback.pending?.operation).toBe('rollback');
  const recoveredRollback=await make().rollback();expect(recoveredRollback.phase).toBe('rolledBack');
  expect(restored).toHaveBeenCalledTimes(1);
  expect((await readFile(join(f.packageRoot,'StreamCockpit.exe'))).toString()).toBe('old-exe');
});
it('blocks readback of an incomplete install, leaving the existing durable pending intent untouched',async()=>{
  const f=await fixture();const installed=vi.fn(async()=>{await writeFile(join(f.packageRoot,'StreamCockpit.exe'),'new-exe');throw Error('crash before profile update')});
  const make=()=>createDurableDesktopUpgradePlanner(f.coordinator,{
    verify:async()=>true,stage:async()=>({reference:'synthetic-staged'}),
    backup:async()=>({reference:'synthetic-backup'}),migrate:async()=>({reference:'synthetic-migrated'}),
    install:installed,rollback:async()=>({reference:'no'}),reconcile:f.readback(),
  },{assessRestartSafety:async()=>({safe:true})});
  await make().register(manifest,'synthetic-artifact');
  const pending=await make().install();expect(pending.pending?.operation).toBe('install');
  expect((await make().install()).pending?.operation).toBe('install');
  expect(installed).toHaveBeenCalledTimes(1);
});
