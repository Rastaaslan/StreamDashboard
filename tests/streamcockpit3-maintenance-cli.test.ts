import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {readFile,rm,readdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {nativeMaintenanceRequest,runMaintenanceEnvelope,readPreparedMaintenanceRequest,verifyMaintenanceCarrier} from '../apps/desktop/src/streamcockpit-maintenance-cli.js';
import {nativeMaintenanceFixture,digest} from './helpers/streamcockpit-maintenance-fixture.js';
// @ts-expect-error Build tooling is a standalone ESM script, not a declared package.
import {buildMaintenance} from '../scripts/build-maintenance.mjs';
const fake=vi.hoisted(()=>({signature:vi.fn(),observe:vi.fn(),close:vi.fn(),writers:vi.fn(),open:vi.fn()}));
vi.mock('../apps/desktop/src/streamcockpit-windows-authenticode.js',async original=>({
 ...await original<typeof import('../apps/desktop/src/streamcockpit-windows-authenticode.js')>(),inspectWindowsAuthenticode:fake.signature,
}));
vi.mock('../apps/desktop/src/streamcockpit-maintenance-observer.js',async original=>({
 ...await original<typeof import('../apps/desktop/src/streamcockpit-maintenance-observer.js')>(),
 createIndependentMaintenanceObserver:fake.open,inspectWindowsMaintenanceWriters:fake.writers,
}));
const roots:string[]=[];
async function fixture(){const f=await nativeMaintenanceFixture();roots.push(f.root);return f}
beforeEach(()=>{
 vi.resetAllMocks();vi.stubEnv('SC3_MAINTENANCE_TRUST_FILE','');
 fake.signature.mockImplementation(async(path:string)=>{const bytes=await readFile(path);return {path,observedAt:Date.now(),
  status:'valid',signer:'A'.repeat(40),sha256:digest(bytes),version:bytes.toString().startsWith('NEW')?'3.0.0':'2.1.0'}});
 fake.observe.mockImplementation(async()=>({authority:'fixe-independent',session:'TEST_ONLY',observedAt:Date.now(),obs:'idle',twitch:'offline'}));
 fake.close.mockResolvedValue(undefined);fake.writers.mockResolvedValue(true);
 fake.open.mockImplementation(async()=>({observe:fake.observe,close:fake.close}));
});
afterEach(async()=>{vi.unstubAllEnvs();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true})});
it('runs the concrete native entry through prepare, install and rollback with real temporary files/SQLite (positive OS/live proofs simulated)',async()=>{
 const f=await fixture(),ready=vi.fn();
 for(const action of ['prepare','install','rollback']as const){
  f.envelope.request.action=action;f.envelope.consent.action=action;
  const result=await runMaintenanceEnvelope(f.envelope,ready);
  expect(result).toMatchObject({phase:{prepare:'verified',install:'installed',rollback:'rolledBack'}[action],pending:false});
 }
 expect(ready).toHaveBeenCalledTimes(3);expect(fake.close).toHaveBeenCalledTimes(3);
 expect(await f.inventory(f.paths.packageRoot)).toEqual(f.request.options.rollback.packageFiles);
 expect(await f.inventory(f.paths.profileRoot)).toEqual(f.request.options.rollback.profileFiles);
 expect(fake.writers).toHaveBeenCalled();expect(fake.signature).toHaveBeenCalled();
});
it.each(['missing-trust','callback','different-profile','different-journal','unsigned-metadata'])(
 'refuses %s before native observations or journal admission',async kind=>{
 const f=await fixture(),r=structuredClone(f.request)as any;let trust=f.trust as any;
 if(kind==='missing-trust')trust=undefined;if(kind==='callback')r.options.runtimeStopped=true;
 if(kind==='different-profile')r.rootUserData=join(f.root,'other');
 if(kind==='different-journal')r.options.journalDirectory=join(f.root,'other');
 if(kind==='unsigned-metadata')r.options.manifest.id='changed';
 expect(()=>nativeMaintenanceRequest(r,trust)).toThrow();expect(fake.open).not.toHaveBeenCalled();
 expect(await readdir(f.paths.journalDirectory)).toEqual([]);
});
it.each(['cancelled','wrong-action','unsigned-carrier','live','writers'])(
 'does not mutate the temporary installation when %s',async kind=>{
 const f=await fixture();f.envelope.request.action='install';f.envelope.consent.action='install';
 if(kind==='cancelled')f.envelope.consent.releaseId='other';if(kind==='wrong-action')f.envelope.consent.action='rollback';
 if(kind==='unsigned-carrier')fake.signature.mockResolvedValue(undefined);
 if(kind==='live')fake.observe.mockResolvedValue(undefined);if(kind==='writers')fake.writers.mockResolvedValue(false);
 await expect(runMaintenanceEnvelope(f.envelope)).rejects.toThrow();
 expect(await f.inventory(f.paths.packageRoot)).toEqual(f.request.options.rollback.packageFiles);
 expect(await readdir(f.paths.journalDirectory)).toEqual([]);
});
it('reads a selected request independently of trust and refuses a changed carrier before executing it',async()=>{
 const f=await fixture();const request=await readPreparedMaintenanceRequest(f.requestFile,f.trust);
 expect((await verifyMaintenanceCarrier(request)).script).toBe(join(f.paths.sourcePackage,'resources/streamcockpit-maintenance.cjs'));
 await writeFile(join(f.paths.sourcePackage,'resources/streamcockpit-maintenance.cjs'),'changed');
 await expect(verifyMaintenanceCarrier(request)).rejects.toThrow('CARRIER_CHANGED');
 expect(fake.open).not.toHaveBeenCalled();
});
it('bundles a real standalone entry and runs its refusal path with repository Electron in Node mode, without app startup or provider calls',async()=>{
 const f=await fixture(),output=join(f.root,'bundle');
 const built=await buildMaintenance(output);expect(built.productionPolicyIncluded).toBe(false);
 const electron=createRequire(import.meta.url)('electron') as string;
 const result=spawnSync(electron,[built.entry,'--stdio-v1'],{input:JSON.stringify({untrusted:'TEST_ONLY_TOKEN'}),
  encoding:'utf8',timeout:15000,windowsHide:true,env:{SystemRoot:process.env.SystemRoot,TEMP:f.root,TMP:f.root,
   APPDATA:f.root,LOCALAPPDATA:f.root,ELECTRON_RUN_AS_NODE:'1',NODE_NO_WARNINGS:'1'}});
 expect(result.error).toBeUndefined();expect(result.status).toBe(1);
 expect(result.stdout.trim()).toBe('{"kind":"blocked","code":"MAINTENANCE_NOT_CONFIRMED"}');
 expect(result.stdout+result.stderr).not.toContain('TEST_ONLY_TOKEN');
 expect(await readdir(f.paths.journalDirectory)).toEqual([]);expect(fake.open).not.toHaveBeenCalled();
},30000);

it('captures final shutdown writes only after the runtime exits, then preserves that immutable same-schema snapshot through rollback',async()=>{
 const f=await fixture();f.envelope.captureStoppedProfile=true;
 expect((await runMaintenanceEnvelope(f.envelope)).phase).toBe('verified');
 // Simulated last native log: a pre-quit inventory cannot predict these bytes.
 await f.write(f.paths.profileRoot,'logs/last-shutdown.log','TEST_ONLY completed native shutdown');
 const actual=await f.inventory(f.paths.profileRoot);
 f.envelope.request.action='install';f.envelope.consent.action='install';
 expect((await runMaintenanceEnvelope(f.envelope)).phase).toBe('installed');
 expect(await f.inventory(f.paths.profileRoot)).toEqual(actual);
 const snapshot=join(f.paths.journalDirectory,'profile-'+f.request.options.manifest.id+'.json');
 const pinned=await readFile(snapshot,'utf8');expect(pinned).not.toContain('TEST_ONLY completed native shutdown');
 f.envelope.request.action='rollback';f.envelope.consent.action='rollback';
 expect((await runMaintenanceEnvelope(f.envelope)).phase).toBe('rolledBack');
 expect(await f.inventory(f.paths.profileRoot)).toEqual(actual);expect(await readFile(snapshot,'utf8')).toBe(pinned);
});
it('never rebaselines a stopped snapshot to erase newer data or manufactures a missing snapshot during recovery',async()=>{
 const f=await fixture();f.envelope.captureStoppedProfile=true;f.envelope.request.action='install';f.envelope.consent.action='install';
 expect((await runMaintenanceEnvelope(f.envelope)).phase).toBe('installed');
 await f.write(f.paths.profileRoot,'new-uncertain-receipt.txt','TEST_ONLY newer record');
 const actual=await f.inventory(f.paths.profileRoot);
 f.envelope.request.action='rollback';f.envelope.consent.action='rollback';
 await expect(runMaintenanceEnvelope(f.envelope)).rejects.toThrow('PROFILE_CHANGED_SINCE_CAPTURE');
 expect(await f.inventory(f.paths.profileRoot)).toEqual(actual);
 await rm(join(f.paths.journalDirectory,'profile-'+f.request.options.manifest.id+'.json'));
 await expect(runMaintenanceEnvelope(f.envelope)).rejects.toThrow('PROFILE_SNAPSHOT_MISSING_AFTER_EFFECT');
 expect(await f.inventory(f.paths.profileRoot)).toEqual(actual);
});
