import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import * as fs from 'node:fs/promises';
import {join} from 'node:path';
import {createSignedWindowsUpgradePlanner} from '../apps/desktop/src/streamcockpit-upgrade-squirrel.js';
import {createSignedWindowsDirectoryUpgradePlanner,directoryReleaseImageHash} from '../apps/desktop/src/streamcockpit-upgrade-signed-preparation.js';
import {SqliteUpgradeJournal} from '../apps/desktop/src/streamcockpit-upgrade-journal.js';
import {AutoModActionIntentSqlite} from '../apps/server/src/streamcockpit-automod-action-intent-sqlite.js';
import {squirrelFixture} from './helpers/streamcockpit-squirrel-fixture.js';
import {prepareNativeMaintenanceLaunch} from '../apps/desktop/src/streamcockpit-maintenance-launcher.js';
import {digest} from './helpers/streamcockpit-maintenance-fixture.js';
import {bindSquirrelVersions} from '../apps/desktop/src/streamcockpit-squirrel-contract.js';
const mock=vi.hoisted(()=>({native:vi.fn(),signature:vi.fn()}));
vi.mock('../apps/desktop/src/streamcockpit-windows-authenticode.js',async original=>({
 ...await original<typeof import('../apps/desktop/src/streamcockpit-windows-authenticode.js')>(),inspectWindowsAuthenticode:mock.signature,
}));
vi.mock('../apps/desktop/src/streamcockpit-squirrel-native.js',async original=>({
 ...await original<typeof import('../apps/desktop/src/streamcockpit-squirrel-native.js')>(),nativeSquirrelState:mock.native,
}));
vi.mock('node:fs/promises',async original=>{
 const actual=await original<typeof import('node:fs/promises')>();return {...actual,rename:vi.fn(actual.rename)};
});
const roots:string[]=[];
beforeEach(async()=>{
 mock.native.mockReset();mock.signature.mockImplementation(async(path:string)=>{const bytes=await fs.readFile(path);return {path,observedAt:Date.now(),status:'valid',signer:'A'.repeat(40),sha256:digest(bytes),version:bytes.toString().startsWith('NEW')?'3.0.0':'2.1.0'}});
 vi.mocked(fs.rename).mockReset().mockImplementation((await vi.importActual<typeof fs>('node:fs/promises')).rename);
});
afterEach(async()=>{vi.restoreAllMocks();for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true})});
async function fixture(){
 const f=await squirrelFixture();roots.push(f.root);mock.native.mockImplementation(f.native);
 const safety=vi.fn(async()=>({safe:true})),stopped=vi.fn(f.options.runtimeStopped);f.options.runtimeStopped=stopped;
 const planner=()=>createSignedWindowsUpgradePlanner(f.options,{assessRestartSafety:safety});
 await planner().register(f.options.manifest,f.options.sourcePackage);
 return {...f,planner,safety,stopped};
}
const applies=()=>mock.native.mock.calls.filter(x=>x[0]==='apply').length;
it('uses the existing committed planner for native install and exact explicit app/data/registration/shortcut rollback',async()=>{
 const f=await fixture(),before=await f.inventory(f.installationRoot);
 expect((await f.planner().install()).phase).toBe('installed');expect(applies()).toBe(1);
 expect(await f.inventory(f.newRoot)).toEqual(f.options.target.packageFiles);
 expect(new AutoModActionIntentSqlite(join(f.paths.profileRoot,'streamcockpit-automod-action-intents.sqlite')).isBlocked('42','retained-before-update')).toBe(true);
 expect((await f.planner().rollback()).phase).toBe('rolledBack');
 expect(await f.inventory(f.installationRoot)).toEqual(before);
 expect(await f.inventory(f.paths.profileRoot)).toEqual(f.options.rollback.profileFiles);
 expect(f.getState()).toEqual(f.oldState);
 expect((await f.planner().install()).rolledBack).toBe(true);expect(applies()).toBe(1);
});
it('never passes a Squirrel contract through portable copy/swap',async()=>{
 const f=await fixture();
 expect(()=>createSignedWindowsDirectoryUpgradePlanner(f.options,{assessRestartSafety:async()=>({safe:true})})).toThrow('NATIVE_SQUIRREL_REQUIRED');
});
it('authenticates native package metadata before any Squirrel side effect',async()=>{
 const f=await fixture();f.options.image.squirrel!.package.sha256='0'.repeat(64);
 f.options.manifest.sha256=directoryReleaseImageHash(f.options.image);
 expect(()=>f.planner()).toThrow('SIGNATURE_INVALID');expect(mock.native).not.toHaveBeenCalled();
});
it.each(['package','updater','live','writers']as const)('refuses changed %s before native apply',async what=>{
 const f=await fixture(),before=await f.inventory(f.installationRoot);
 if(what==='package')await fs.writeFile(join(f.feed,f.options.image.squirrel!.package.path),'TEST_TAMPERED');
 if(what==='updater')await fs.writeFile(join(f.installationRoot,'Update.exe'),'TEST_TAMPERED');
 if(what==='live')f.safety.mockResolvedValue({safe:false});
 if(what==='writers')f.stopped.mockResolvedValue(false);
 expect((await f.planner().install()).installed).toBe(false);expect(applies()).toBe(0);
 if(what!=='updater')expect(await f.inventory(f.installationRoot)).toEqual(before);
 expect(await f.inventory(f.paths.profileRoot)).toEqual(f.options.rollback.profileFiles);
});
it.each([false,true])('does not replay a native failure, even when native effects already happened: %s',async applied=>{
 const f=await fixture();mock.native.mockImplementation(async(...args:any[])=>{
  if(args[0]==='apply'){if(applied)await (f.native as any)(...args);throw Error('TEST_ONLY_UNCERTAIN_NATIVE_TOKEN')}
  return (f.native as any)(...args);
 });
 const first=await f.planner().install();expect(first.pending?.operation).toBe('install');expect(first.installed).toBe(false);
 const second=await f.planner().install();expect(second.pending?.operation).toBe('install');expect(applies()).toBe(1);
 expect(JSON.stringify(second)).not.toContain('TEST_ONLY_UNCERTAIN_NATIVE_TOKEN');
});
it('recovers a lost final journal acknowledgement by readback, without a second native update',async()=>{
 const f=await fixture(),write=SqliteUpgradeJournal.prototype.write;let lost=false;
 vi.spyOn(SqliteUpgradeJournal.prototype,'write').mockImplementation(async function(this:SqliteUpgradeJournal,journal){
  if(journal.installed&&!journal.pending&&!lost){lost=true;throw Error('TEST_ONLY_LOST_ACK')}
  return write.call(this,journal);
 });
 expect((await f.planner().install()).pending?.operation).toBe('install');
 const recovered=await f.planner().install();expect(recovered.installed).toBe(true);expect(recovered.pending).toBeUndefined();expect(applies()).toBe(1);
});
it('refuses rollback after later data writes and preserves the new anti-replay receipt',async()=>{
 const f=await fixture();await f.planner().install();
 const store=new AutoModActionIntentSqlite(join(f.paths.profileRoot,'streamcockpit-automod-action-intents.sqlite'));
 expect(store.reserve('42','new-after-update','12','DENY')).toBe(true);
 const before=await f.inventory(f.paths.profileRoot),result=await f.planner().rollback();
 expect(result.rolledBack).toBe(false);expect(result.pending?.operation).toBe('rollback');
 expect(await f.inventory(f.paths.profileRoot)).toEqual(before);expect(store.isBlocked('42','new-after-update')).toBe(true);
});
it('refuses rollback after a later shortcut or registration modification',async()=>{
 const f=await fixture();await f.planner().install();const state=f.getState();state.shortcuts[0]!.data=Buffer.from('USER_CHANGED_LINK').toString('base64');f.setState(state);
 expect((await f.planner().rollback()).rolledBack).toBe(false);
 expect(mock.native.mock.calls.filter(x=>x[0]==='restore')).toHaveLength(0);
});
it.each([1,2,3,4])('retains incomplete rollback rename %i without repeating writes or native repair',async failAt=>{
 const f=await fixture();await f.planner().install();
 const actual=(await vi.importActual<typeof fs>('node:fs/promises')).rename;let count=0;
 const moves=vi.mocked(fs.rename).mockClear().mockImplementation(async(from,to)=>{await actual(from,to);if(++count===failAt)throw Error('TEST_ONLY_LOST_RENAME_ACK')});
 expect((await f.planner().rollback()).pending?.operation).toBe('rollback');
 expect((await f.planner().rollback()).rolledBack).toBe(false);
 expect(moves).toHaveBeenCalledTimes(failAt);
 expect(mock.native.mock.calls.filter(x=>x[0]==='restore')).toHaveLength(0);
 expect(await f.inventory(f.backupInstallation)).toBeDefined();
});
it('can roll back after the original download and source feed disappeared',async()=>{
 const f=await fixture();await f.planner().install();
 await fs.rm(f.paths.sourcePackage,{recursive:true});await fs.rm(f.feed,{recursive:true});
 expect((await f.planner().rollback()).rolledBack).toBe(true);expect(f.getState()).toEqual(f.oldState);
});
it('rejects another installation, overlapping backup and unbound native options at construction',async()=>{
 const f=await fixture();
 f.options.squirrel!.backupInstallation=f.paths.profileRoot;expect(()=>f.planner()).toThrow('BINDING_MISMATCH');
 f.options.squirrel!.backupInstallation=f.backupInstallation;f.options.packageRoot=f.newRoot;
 expect(()=>f.planner()).toThrow('INSTALLATION_BINDING_MISMATCH');
});

it('connects the real native-menu preparation to an authenticated installed Squirrel target',async()=>{
 const f=await fixture();
 const current={applicationData:f.request.applicationData,rootUserData:f.request.rootUserData,packageRoot:f.oldRoot,version:'2.1.0'};
 expect(await prepareNativeMaintenanceLaunch(f.requestFile,f.trust,current)).toMatchObject({version:f.options.manifest.version,action:'prepare'});
 expect(mock.native).not.toHaveBeenCalled();
});
it('accepts a rollback request selected from the actual new Squirrel app-version directory',async()=>{
 const f=await fixture();await f.planner().install();
 await fs.writeFile(f.requestFile,JSON.stringify({...f.request,action:'rollback'}));
 const current={applicationData:f.request.applicationData,rootUserData:f.request.rootUserData,packageRoot:f.newRoot,version:f.options.manifest.version};
 expect(await prepareNativeMaintenanceLaunch(f.requestFile,f.trust,current)).toMatchObject({action:'rollback'});
});
it('rejects a detected Squirrel installation when a selected signed request omits the native contract',async()=>{
 const f=await fixture();
 delete f.request.options.squirrel;delete f.request.options.image.squirrel;f.resign();
 await fs.writeFile(f.requestFile,JSON.stringify(f.request));
 const current={applicationData:f.request.applicationData,rootUserData:f.request.rootUserData,packageRoot:f.oldRoot,version:'2.1.0'};
 await expect(prepareNativeMaintenanceLaunch(f.requestFile,f.trust,current)).rejects.toThrow('DISTRIBUTION_MISMATCH');
 expect(mock.native).not.toHaveBeenCalled();
});

it('binds NuGet prerelease spelling and optional fourth zero without aliasing different numeric versions',async()=>{
 const f=await fixture(),s=f.options.image.squirrel!;
 expect(()=>bindSquirrelVersions({...s,version:'3.0.0.0-alpha1'},f.options.manifest)).not.toThrow();
 expect(()=>bindSquirrelVersions({...s,version:'30.0.0-alpha1'},f.options.manifest)).toThrow('VERSION_BINDING_MISMATCH');
});
