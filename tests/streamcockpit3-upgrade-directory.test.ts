import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import * as fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {dirname,join,relative,sep} from 'node:path';
import {createWindowsDirectoryUpgradePlanner,type DirectoryUpgradeOptions} from '../apps/desktop/src/streamcockpit-upgrade-directory.js';
import type {UpgradeReadbackFile,UpgradeReadbackIdentity} from '../apps/desktop/src/streamcockpit-upgrade-readback.js';
import {AutoModActionIntentSqlite} from '../apps/server/src/streamcockpit-automod-action-intent-sqlite.js';
import {PredictionIntentSqlite} from '../apps/server/src/streamcockpit-prediction-intent-sqlite.js';
import {MomentsSqliteStorage} from '../apps/server/src/streamcockpit-moments-sqlite.js';
import type {UpgradeManifest} from '../packages/core/src/streamcockpit-upgrade.js';

vi.mock('node:fs/promises',async original=>{
  const actual=await original<typeof import('node:fs/promises')>();
  return {...actual,rename:vi.fn(actual.rename)};
});
beforeEach(async()=>{
  const actual=await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  vi.mocked(fs.rename).mockReset().mockImplementation(actual.rename);
});

const roots:string[]=[];
afterEach(async()=>{vi.restoreAllMocks();for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true})});
const onWindows=process.platform==='win32'?it:it.skip;
const manifest:UpgradeManifest={id:'directory-test',version:'3.0.0',fromVersion:'2.1.0',target:'desktop',
  source:'https://example.test/synthetic',sha256:'a'.repeat(64),signature:{keyId:'synthetic',value:'NO_REAL_SIGNATURE'},schema:{from:1,to:2}};
const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
async function inventory(root:string):Promise<UpgradeReadbackFile[]>{
  const result:UpgradeReadbackFile[]=[];
  const visit=async(folder:string)=>{for(const entry of await fs.readdir(folder,{withFileTypes:true})){
    const file=join(folder,entry.name);if(entry.isDirectory())await visit(file);
    else{const bytes=await fs.readFile(file);result.push({path:relative(root,file).split(sep).join('/'),sha256:digest(bytes),bytes:bytes.length})}
  }};
  await visit(root);return result.sort((a,b)=>a.path.localeCompare(b.path));
}
async function fixture(){
  const root=await fs.mkdtemp(join(tmpdir(),'sc3-directory-upgrade-'));roots.push(root);
  const paths={journalDirectory:join(root,'journal'),packageRoot:join(root,'app'),profileRoot:join(root,'data'),
    preparedPackage:join(root,'staged'),preparedProfile:join(root,'migrated'),backupPackage:join(root,'backup-app'),backupProfile:join(root,'backup-data')};
  for(const folder of [paths.packageRoot,paths.profileRoot,paths.journalDirectory])await fs.mkdir(folder);
  const write=async(folder:string,name:string,bytes:string)=>{const file=join(folder,name);await fs.mkdir(dirname(file),{recursive:true});await fs.writeFile(file,bytes)};
  await write(paths.packageRoot,'StreamCockpit.exe','OLD_SYNTHETIC_NOT_AN_EXECUTABLE');
  await write(paths.packageRoot,'resources/app.asar','OLD_SYNTHETIC_ASAR');
  await write(paths.profileRoot,'configuration/settings.json',JSON.stringify({schemaVersion:1,associations:{phone:'fixture'},profiles:{fixe:'master'}}));
  new AutoModActionIntentSqlite(join(paths.profileRoot,'streamcockpit-automod-action-intents.sqlite')).reserve('42','held-one','12','ALLOW');
  new PredictionIntentSqlite(join(paths.profileRoot,'streamcockpit-prediction-intents.sqlite')).reserve('42');
  await new MomentsSqliteStorage(join(paths.profileRoot,'streamcockpit-moments.sqlite')).compareAndSwap(null,'retained marker');
  await fs.cp(paths.packageRoot,paths.backupPackage,{recursive:true});await fs.cp(paths.profileRoot,paths.backupProfile,{recursive:true});
  await fs.cp(paths.packageRoot,paths.preparedPackage,{recursive:true});await fs.cp(paths.profileRoot,paths.preparedProfile,{recursive:true});
  await write(paths.preparedPackage,'StreamCockpit.exe','NEW_SYNTHETIC_NOT_AN_EXECUTABLE');
  await write(paths.preparedPackage,'resources/app.asar','NEW_SYNTHETIC_ASAR');
  await write(paths.preparedProfile,'configuration/settings.json',JSON.stringify({schemaVersion:2,associations:{phone:'fixture'},profiles:{fixe:'master'}}));
  const identity=(version:string)=>({version,revision:(version==='3.0.0'?'b':'c').repeat(40),applicationId:'fixture.windows',signer:'SYNTHETIC_PIN'});
  const rollback={identity:identity('2.1.0'),packageFiles:await inventory(paths.backupPackage),profileFiles:await inventory(paths.backupProfile)};
  const target={identity:identity('3.0.0'),packageFiles:await inventory(paths.preparedPackage),profileFiles:await inventory(paths.preparedProfile)};
  const runtimeStopped=vi.fn(async()=>true),assessRestartSafety=vi.fn(async()=>({safe:true}));
  // Test-only identity observation: NOT an Authenticode attestation.
  const attestInstalled=vi.fn(async():Promise<UpgradeReadbackIdentity|undefined>=>{
    const bytes=await fs.readFile(join(paths.packageRoot,'StreamCockpit.exe'),'utf8');
    return {...identity(bytes.startsWith('NEW')?'3.0.0':'2.1.0'),observedAt:Date.now()};
  });
  const options:DirectoryUpgradeOptions={manifest,...paths,target,rollback,runtimeStopped,attestInstalled};
  const preparation={stage:vi.fn(async()=>({reference:paths.preparedPackage})),verify:vi.fn(async()=>true),
    backup:vi.fn(async()=>({reference:paths.backupPackage})),migrate:vi.fn(async()=>({reference:paths.preparedProfile}))};
  const planner=()=>createWindowsDirectoryUpgradePlanner(options,preparation,{assessRestartSafety});
  await planner().register(manifest,'synthetic-release');
  const retained=(name:'app'|'data',operation:'install'|'rollback')=>join(root,'.'+name+'.sc3-'+manifest.id+'-'+operation+'-previous');
  return{root,paths,options,preparation,planner,retained,runtimeStopped,assessRestartSafety,attestInstalled,write};
}
async function assertReceipts(folder:string){
  expect(new AutoModActionIntentSqlite(join(folder,'streamcockpit-automod-action-intents.sqlite')).isBlocked('42','held-one')).toBe(true);
  expect(new PredictionIntentSqlite(join(folder,'streamcockpit-prediction-intents.sqlite')).isBlocked('42')).toBe(true);
  expect(await new MomentsSqliteStorage(join(folder,'streamcockpit-moments.sqlite')).read()).toBe('retained marker');
}
onWindows('applies complete app/profile trees and explicitly rolls back without losing F02/F08/F09 SQLite receipts',async()=>{
  const f=await fixture();
  expect((await f.planner().install()).phase).toBe('installed');
  expect(await inventory(f.paths.packageRoot)).toEqual(f.options.target.packageFiles);
  expect(await inventory(f.paths.profileRoot)).toEqual(f.options.target.profileFiles);
  expect(await inventory(f.retained('app','install'))).toEqual(f.options.rollback.packageFiles);
  await assertReceipts(f.paths.profileRoot);
  expect((await f.planner().rollback()).phase).toBe('rolledBack');
  expect(await inventory(f.paths.packageRoot)).toEqual(f.options.rollback.packageFiles);
  expect(await inventory(f.paths.profileRoot)).toEqual(f.options.rollback.profileFiles);
  await assertReceipts(f.paths.profileRoot);await assertReceipts(f.paths.backupProfile);
  const rename=vi.mocked(fs.rename).mockClear();
  expect((await f.planner().install()).phase).toBe('rolledBack');
  expect((await f.planner().rollback()).phase).toBe('rolledBack');expect(rename).not.toHaveBeenCalled();
});
onWindows.each(['live','not-stopped','unverified']as const)('refuses %s without moving installed files',async state=>{
  const f=await fixture();
  if(state==='live')f.assessRestartSafety.mockResolvedValue({safe:false});
  if(state==='not-stopped')f.runtimeStopped.mockResolvedValue(false);
  if(state==='unverified')f.preparation.verify.mockResolvedValue(false);
  const rename=vi.mocked(fs.rename).mockClear();expect((await f.planner().install()).installed).toBe(false);
  expect(rename).not.toHaveBeenCalled();expect(await inventory(f.paths.profileRoot)).toEqual(f.options.rollback.profileFiles);
});
onWindows.each(['active-data','prepared-app','prepared-data','backup-data','extra-file']as const)('refuses %s changed since the pinned inventory without replacing active roots',async change=>{
  const f=await fixture();
  const folder=change==='active-data'?f.paths.profileRoot:change==='prepared-app'?f.paths.preparedPackage:
    change==='prepared-data'?f.paths.preparedProfile:change==='backup-data'?f.paths.backupProfile:f.paths.packageRoot;
  const file=change==='extra-file'?'unexpected.txt':change==='prepared-app'?'StreamCockpit.exe':'configuration/settings.json';
  await f.write(folder,file,'tampered');const before=await inventory(f.paths.profileRoot);
  const rename=vi.mocked(fs.rename).mockClear();const result=await f.planner().install();
  expect(result.pending?.operation).toBe('install');expect(result.installed).toBe(false);
  expect(rename).not.toHaveBeenCalled();expect(await inventory(f.paths.profileRoot)).toEqual(before);
});
onWindows('refuses rollback after new journal writes instead of erasing anti-replay history',async()=>{
  const f=await fixture();await f.planner().install();
  const automod=new AutoModActionIntentSqlite(join(f.paths.profileRoot,'streamcockpit-automod-action-intents.sqlite'));
  expect(automod.reserve('42','held-after-update','12','DENY')).toBe(true);
  const before=await inventory(f.paths.profileRoot),rename=vi.mocked(fs.rename).mockClear();
  const result=await f.planner().rollback();expect(result.rolledBack).toBe(false);expect(result.pending?.operation).toBe('rollback');
  expect(rename).not.toHaveBeenCalled();expect(await inventory(f.paths.profileRoot)).toEqual(before);
  expect(automod.isBlocked('42','held-after-update')).toBe(true);
});
onWindows.each([1,2,3,4])('retains pending intent after lost rename acknowledgement %i; never repeats a partially applied operation',async failAt=>{
  const f=await fixture(),native=(await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')).rename;let count=0;
  const renames=vi.mocked(fs.rename).mockClear().mockImplementation(async(from,to)=>{
    await native(from,to);if(++count===failAt)throw Error('simulated lost rename acknowledgement');
  });
  const first=await f.planner().install();expect(first.pending?.operation).toBe('install');
  expect(count).toBe(failAt);const calls=renames.mock.calls.length;
  const second=await f.planner().install();
  if(failAt===4){expect(second.installed).toBe(true);expect(second.pending).toBeUndefined()}
  else{expect(second.pending?.operation).toBe('install');expect(second.installed).toBe(false)}
  expect(renames).toHaveBeenCalledTimes(calls);
  expect(await inventory(f.retained('app','install'))).toEqual(f.options.rollback.packageFiles);
  await assertReceipts(f.paths.backupProfile);
});
onWindows('reconciles an entirely applied rollback after lost ACK by readback only',async()=>{
  const f=await fixture();await f.planner().install();const native=(await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')).rename;let count=0;
  const renames=vi.mocked(fs.rename).mockClear().mockImplementation(async(from,to)=>{await native(from,to);if(++count===4)throw Error('lost rollback ACK')});
  expect((await f.planner().rollback()).pending?.operation).toBe('rollback');
  const recovered=await f.planner().rollback();expect(recovered.rolledBack).toBe(true);expect(recovered.pending).toBeUndefined();
  expect(renames).toHaveBeenCalledTimes(4);await assertReceipts(f.paths.profileRoot);
});
onWindows('refuses a concurrent restart between swaps and keeps both previous trees for manual recovery',async()=>{
  const f=await fixture(),native=(await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')).rename;let count=0;
  const renames=vi.mocked(fs.rename).mockClear().mockImplementation(async(from,to)=>{await native(from,to);if(++count===2)f.runtimeStopped.mockResolvedValue(false)});
  expect((await f.planner().install()).pending?.operation).toBe('install');
  expect(renames).toHaveBeenCalledTimes(2);await assertReceipts(f.paths.profileRoot);
  expect((await f.planner().install()).installed).toBe(false);expect(renames).toHaveBeenCalledTimes(2);
});
onWindows('does not accept an applied result with a missing independent identity attestation',async()=>{
  const f=await fixture();f.attestInstalled.mockResolvedValue(undefined);
  const result=await f.planner().install();expect(result.installed).toBe(false);expect(result.pending?.operation).toBe('install');
  const rename=vi.mocked(fs.rename).mockClear();expect((await f.planner().install()).installed).toBe(false);expect(rename).not.toHaveBeenCalled();
});
onWindows('rejects overlapping roots, unsafe entries and mismatched preparation receipts',async()=>{
  const f=await fixture(),make=(options:DirectoryUpgradeOptions)=>createWindowsDirectoryUpgradePlanner(options,f.preparation,{assessRestartSafety:f.assessRestartSafety});
  expect(()=>make({...f.options,journalDirectory:join(f.paths.profileRoot,'coordinator')})).toThrow('ROOTS_OVERLAP');
  expect(()=>make({...f.options,preparedPackage:f.paths.packageRoot})).toThrow('ROOTS_OVERLAP');
  for(const name of ['../outside','C:/outside','con.txt','foo.','bar:stream']){
    const target=structuredClone(f.options.target);target.packageFiles[0]!.path=name;
    expect(()=>make({...f.options,target})).toThrow('ENTRY_INVALID');
  }
  f.preparation.migrate.mockResolvedValue({reference:'unrelated-profile'});
  const rename=vi.mocked(fs.rename).mockClear();expect((await f.planner().install()).installed).toBe(false);expect(rename).not.toHaveBeenCalled();
});
onWindows('preserves pre-existing recovery files instead of overwriting them',async()=>{
  const f=await fixture();await fs.mkdir(f.retained('app','install'));await fs.writeFile(join(f.retained('app','install'),'keep'),'evidence');
  const rename=vi.mocked(fs.rename).mockClear();expect((await f.planner().install()).installed).toBe(false);expect(rename).not.toHaveBeenCalled();
  expect(await fs.readFile(join(f.retained('app','install'),'keep'),'utf8')).toBe('evidence');
});
onWindows('snapshots expected inventories so external object changes cannot authorize different files',async()=>{
  const f=await fixture(),planner=f.planner();
  await f.write(f.paths.preparedProfile,'configuration/settings.json','changed after preparation');
  f.options.target.profileFiles=await inventory(f.paths.preparedProfile);
  const rename=vi.mocked(fs.rename).mockClear();expect((await planner.install()).installed).toBe(false);expect(rename).not.toHaveBeenCalled();
});

onWindows.each(['removed','changed','added','sidecar']as const)('rejects an unqualified durable journal transformation (%s) even when declared in the target inventory',async change=>{
  const f=await fixture(),target=structuredClone(f.options.target);
  const name='streamcockpit-automod-action-intents.sqlite';
  if(change==='removed')target.profileFiles=target.profileFiles.filter(file=>file.path!==name);
  if(change==='changed')target.profileFiles.find(file=>file.path===name)!.sha256='e'.repeat(64);
  if(change==='added')target.profileFiles.push({path:'other/'+name,bytes:1,sha256:'e'.repeat(64)});
  if(change==='sidecar')target.profileFiles.push({path:name+'-wal',bytes:1,sha256:'e'.repeat(64)});
  const rename=vi.mocked(fs.rename).mockClear();
  expect(()=>createWindowsDirectoryUpgradePlanner({...f.options,target},f.preparation,{assessRestartSafety:f.assessRestartSafety}))
    .toThrow('DURABLE_JOURNAL_TRANSFORM_UNQUALIFIED');
  expect(rename).not.toHaveBeenCalled();await assertReceipts(f.paths.profileRoot);
});
