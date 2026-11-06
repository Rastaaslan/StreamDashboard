import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import * as fs from 'node:fs/promises';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {dirname,join,relative,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {createSignedWindowsDirectoryUpgradePlanner,directoryReleaseImageHash,directoryReleaseSigningPayload,
  type SignedDirectoryUpgradeOptions} from '../apps/desktop/src/streamcockpit-upgrade-signed-preparation.js';
import type {UpgradeReadbackFile,UpgradeReadbackIdentity} from '../apps/desktop/src/streamcockpit-upgrade-readback.js';
import {AutoModActionIntentSqlite} from '../apps/server/src/streamcockpit-automod-action-intent-sqlite.js';
import {PredictionIntentSqlite} from '../apps/server/src/streamcockpit-prediction-intent-sqlite.js';
import {MomentsSqliteStorage} from '../apps/server/src/streamcockpit-moments-sqlite.js';
import {SqliteUpgradeJournal} from '../apps/desktop/src/streamcockpit-upgrade-journal.js';
import {startWithRuntimeUpgradeOwnership,runtimeUpgradeDirectory} from '../apps/desktop/src/streamcockpit-runtime-ownership.js';
import {runExternalWindowsMaintenance,type ExternalMaintenanceDependencies} from '../apps/desktop/src/streamcockpit-external-maintenance.js';
import type {UpgradeManifest} from '../packages/core/src/streamcockpit-upgrade.js';

vi.mock('node:fs/promises',async original=>{const actual=await original<typeof import('node:fs/promises')>();
 return {...actual,copyFile:vi.fn(actual.copyFile)};});
beforeEach(async()=>{const actual=await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
 vi.mocked(fs.copyFile).mockReset().mockImplementation(actual.copyFile);});
const roots:string[]=[];
afterEach(async()=>{vi.restoreAllMocks();for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true});});
const onWindows=process.platform==='win32'?it:it.skip;
// EPHEMERAL TEST-ONLY publisher keys: never saved, shipped, trusted in production,
// used as an Authenticode certificate, or presented as a production signature.
const keys=generateKeyPairSync('ed25519');
const publicKeyPem=keys.publicKey.export({format:'pem',type:'spki'}).toString();
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
async function inventory(root:string):Promise<UpgradeReadbackFile[]>{
 const found:UpgradeReadbackFile[]=[];
 const visit=async(folder:string)=>{for(const entry of await fs.readdir(folder,{withFileTypes:true})){
  const file=join(folder,entry.name);if(entry.isDirectory())await visit(file);
  else {const bytes=await fs.readFile(file);found.push({path:relative(root,file).split(sep).join('/'),bytes:bytes.length,sha256:hash(bytes)});}
 }};await visit(root);return found.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
}
async function fixture(){
 const root=await fs.mkdtemp(join(tmpdir(),'sc3-signed-prep-'));roots.push(root);
 const paths={journalDirectory:join(root,'journal'),packageRoot:join(root,'app'),profileRoot:join(root,'data'),
  sourcePackage:join(root,'source'),preparedPackage:join(root,'stage'),preparedProfile:join(root,'prepared-data'),
  backupPackage:join(root,'backup-app'),backupProfile:join(root,'backup-data')};
 for(const folder of [paths.journalDirectory,paths.packageRoot,paths.profileRoot,paths.sourcePackage])await fs.mkdir(folder);
 const write=async(root:string,file:string,data:string)=>{const full=join(root,...file.split('/'));await fs.mkdir(dirname(full),{recursive:true});await fs.writeFile(full,data);};
 for(const [folder,tag] of [[paths.packageRoot,'OLD'],[paths.sourcePackage,'NEW']]){
  await write(folder,'StreamCockpit.exe',tag+'_SYNTHETIC_NOT_EXECUTABLE');await write(folder,'resources/app.asar',tag+'_SYNTHETIC_ASAR');
 }
 await write(paths.profileRoot,'config/dashboard.json',JSON.stringify({schemaVersion:6,associations:{phone:'synthetic'},profiles:{fixe:'master'},unknown:{keep:true}}));
 new AutoModActionIntentSqlite(join(paths.profileRoot,'streamcockpit-automod-action-intents.sqlite')).reserve('42','held','12','ALLOW');
 new PredictionIntentSqlite(join(paths.profileRoot,'streamcockpit-prediction-intents.sqlite')).reserve('42');
 await new MomentsSqliteStorage(join(paths.profileRoot,'streamcockpit-moments.sqlite')).compareAndSwap(null,'synthetic preserved marker');
 const identity=(version:string)=>({version,revision:(version==='3.0.0'?'b':'c').repeat(40),applicationId:'fixture.windows',signer:'A'.repeat(40)});
 const profileFiles=await inventory(paths.profileRoot);
 const target={identity:identity('3.0.0'),packageFiles:await inventory(paths.sourcePackage),profileFiles};
 const rollback={identity:identity('2.1.0'),packageFiles:await inventory(paths.packageRoot),profileFiles:structuredClone(profileFiles)};
 const image={identity:target.identity,packageFiles:target.packageFiles};
 const manifest:UpgradeManifest={id:'signed-preparation-fixture',version:'3.0.0',fromVersion:'2.1.0',target:'desktop',
  source:'https://example.test/synthetic-only',sha256:directoryReleaseImageHash(image),signature:{keyId:'TEST_ONLY',value:'pending-test-signature'},schema:{from:6,to:6}};
 const signFixture=()=>{manifest.sha256=directoryReleaseImageHash(image);manifest.signature.value=sign(null,directoryReleaseSigningPayload(manifest,image),keys.privateKey).toString('base64');};
 signFixture();
 const stopped=vi.fn(async()=>true),safe=vi.fn(async()=>({safe:true}));
 const attestInstalled=vi.fn(async():Promise<UpgradeReadbackIdentity|undefined>=>{
  const bytes=await fs.readFile(join(paths.packageRoot,'StreamCockpit.exe'),'utf8');
  return {...identity(bytes.startsWith('NEW')?'3.0.0':'2.1.0'),observedAt:Date.now()};
 });
 const options:SignedDirectoryUpgradeOptions={...paths,manifest,image,target,rollback,runtimeStopped:stopped,attestInstalled,
  trust:{keyId:'TEST_ONLY',publicKeyPem,applicationId:'fixture.windows',windowsSigner:'A'.repeat(40),sourceOrigin:'https://example.test'}};
 const make=()=>createSignedWindowsDirectoryUpgradePlanner(options,{assessRestartSafety:safe});
 return {root,paths,options,make,write,stopped,safe,attestInstalled,signFixture};
}
async function receipts(folder:string){
 expect(new AutoModActionIntentSqlite(join(folder,'streamcockpit-automod-action-intents.sqlite')).isBlocked('42','held')).toBe(true);
 expect(new PredictionIntentSqlite(join(folder,'streamcockpit-prediction-intents.sqlite')).isBlocked('42')).toBe(true);
 expect(await new MomentsSqliteStorage(join(folder,'streamcockpit-moments.sqlite')).read()).toBe('synthetic preserved marker');
}
onWindows('runs real signed stage/verify/backup/schema-preserving preparation/install/rollback, not injected preparation receipts',async()=>{
 const f=await fixture(),p=f.make();await p.register(f.options.manifest,f.paths.sourcePackage);
 expect((await p.prepare()).phase).toBe('verified');
 await expect(fs.stat(f.paths.backupPackage)).rejects.toMatchObject({code:'ENOENT'});
 expect((await p.install()).phase).toBe('installed');
 expect(await inventory(f.paths.packageRoot)).toEqual(f.options.target.packageFiles);
 expect(await inventory(f.paths.profileRoot)).toEqual(f.options.rollback.profileFiles);await receipts(f.paths.profileRoot);
 expect(await inventory(f.paths.backupPackage)).toEqual(f.options.rollback.packageFiles);
 expect((await f.make().rollback()).phase).toBe('rolledBack');await receipts(f.paths.profileRoot);
 expect(await inventory(f.paths.packageRoot)).toEqual(f.options.rollback.packageFiles);
});
onWindows.each(['signature','wrong-key','key-id','origin','app-id','signer','revision','file-hash','from-version','target','extra-field']as const)
 ('rejects untrusted %s before touching the source, profile or coordinator',async change=>{
 const f=await fixture();const o=f.options;
 if(change==='signature')o.manifest.signature.value='A'.repeat(86)+'==';
 if(change==='wrong-key')o.trust.publicKeyPem=generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'}).toString();
 if(change==='key-id')o.manifest.signature.keyId='NOT_PINNED';
 if(change==='origin')o.trust.sourceOrigin='https://other.test';
 if(change==='app-id')o.trust.applicationId='other.application';
 if(change==='signer')o.trust.windowsSigner='B'.repeat(40);
 if(change==='revision')o.image.identity.revision='d'.repeat(40);
 if(change==='file-hash')o.image.packageFiles[0].sha256='e'.repeat(64);
 if(change==='from-version')o.manifest.fromVersion='2.0.0';
 if(change==='target')o.manifest.target='agent';
 if(change==='extra-field')(o.manifest as unknown as Record<string,unknown>).unsignedExtra=true;
 expect(()=>f.make()).toThrow();expect(await fs.readdir(f.paths.journalDirectory)).toEqual([]);
 expect(await inventory(f.paths.profileRoot)).toEqual(o.rollback.profileFiles);expect(fs.copyFile).not.toHaveBeenCalled();
});
onWindows.each(['source','staged','profile']as const)('refuses altered %s bytes with no active file replacement',async changed=>{
 const f=await fixture(),p=f.make();await p.register(f.options.manifest,f.paths.sourcePackage);
 if(changed==='staged')await p.prepare();
 const root=changed==='source'?f.paths.sourcePackage:changed==='staged'?f.paths.preparedPackage:f.paths.profileRoot;
 await f.write(root,changed==='profile'?'config/dashboard.json':'resources/app.asar','tampered');
 const profile=await inventory(f.paths.profileRoot),result=await p.install();
 expect(result.installed).toBe(false);expect(await inventory(f.paths.packageRoot)).toEqual(f.options.rollback.packageFiles);
 expect(await inventory(f.paths.profileRoot)).toEqual(profile);await receipts(f.paths.profileRoot);
});
onWindows.each(['schema','profile','target-not-signed','overlap']as const)('denies unsupported %s instead of pretending to migrate or authenticate',async change=>{
 const f=await fixture();
 if(change==='schema'){f.options.manifest.schema.to=7;f.signFixture();}
 if(change==='profile'){f.options.target.profileFiles=structuredClone(f.options.target.profileFiles);f.options.target.profileFiles[0].sha256='f'.repeat(64);}
 if(change==='target-not-signed'){f.options.target=structuredClone(f.options.target);f.options.target.identity.revision='d'.repeat(40);}
 if(change==='overlap')f.options.sourcePackage=f.paths.packageRoot;
 expect(()=>f.make()).toThrow();expect(fs.copyFile).not.toHaveBeenCalled();
});
onWindows.each(['live','runtime-active','source-substitution']as const)('does not stage or back up when %s',async state=>{
 const f=await fixture(),p=f.make();await p.register(f.options.manifest,state==='source-substitution'?f.paths.packageRoot:f.paths.sourcePackage);
 if(state==='live')f.safe.mockResolvedValue({safe:false});if(state==='runtime-active')f.stopped.mockResolvedValue(false);
 expect((await p.install()).installed).toBe(false);expect(fs.copyFile).not.toHaveBeenCalled();
 expect(await inventory(f.paths.profileRoot)).toEqual(f.options.rollback.profileFiles);
});
onWindows.each(['stage','backup','migrate']as const)('retains %s intent after lost copy acknowledgement without retry or destructive cleanup',async operation=>{
 const f=await fixture(),p=f.make();await p.register(f.options.manifest,f.paths.sourcePackage);
 const actual=await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
 const target=operation==='stage'?f.paths.preparedPackage:operation==='backup'?f.paths.backupProfile:f.paths.preparedProfile;
 let failed=false;
 vi.mocked(fs.copyFile).mockImplementation(async(from,to,flags)=>{await actual.copyFile(from,to,flags);
  if(!failed&&String(to).startsWith(target+sep)){failed=true;throw Error('lost copy ACK: TEST_ONLY_PRIVATE');}});
 const result=await p.install();expect(result.pending?.operation).toBe(operation);expect(JSON.stringify(result)).not.toContain('TEST_ONLY_PRIVATE');
 const count=vi.mocked(fs.copyFile).mock.calls.length;
 expect((await f.make().install()).pending?.operation).toBe(operation);expect(fs.copyFile).toHaveBeenCalledTimes(count);
 expect(await inventory(f.paths.packageRoot)).toEqual(f.options.rollback.packageFiles);await receipts(f.paths.profileRoot);
});
onWindows('freezes trust and manifests before awaits and preserves the existing shared runtime exclusion',async()=>{
 const f=await fixture(),p=f.make();await p.register(f.options.manifest,f.paths.sourcePackage);
 const runtime=await startWithRuntimeUpgradeOwnership(f.paths.journalDirectory,'2.1.0',async()=>({stop:async()=>undefined}));
 try{await expect(p.install()).rejects.toThrow('BUSY');expect(fs.copyFile).not.toHaveBeenCalled();}
 finally{await runtime.stop();}
 f.options.trust.publicKeyPem='changed';f.options.manifest.signature.value='changed';
 expect((await p.install()).installed).toBe(true);
 expect(await new SqliteUpgradeJournal(f.paths.journalDirectory).exclusive(async()=>true)).toBe(true);
});
onWindows('does not mistake publisher authentication for native installed-identity proof',async()=>{
 const f=await fixture();f.attestInstalled.mockResolvedValue(undefined);const p=f.make();await p.register(f.options.manifest,f.paths.sourcePackage);
 const result=await p.install();expect(result.installed).toBe(false);expect(result.pending?.operation).toBe('install');
 expect((await f.make().install()).pending?.operation).toBe('install');await receipts(f.paths.profileRoot);
});

async function externalFixture(){
 const f=await fixture();
 const applicationData=join(f.root,'appdata');
 await fs.mkdir(applicationData);
 const rootUserData=f.paths.profileRoot;
 const coordinator=runtimeUpgradeDirectory(applicationData,rootUserData);
 await fs.mkdir(coordinator,{recursive:true});
 f.options.journalDirectory=coordinator;
 const observation=()=>({authority:'fixe-independent' as const,session:'independent-fixture-session',observedAt:Date.now(),
   obs:'idle' as const,twitch:'offline' as const});
 const observeOffline=vi.fn(async()=>observation());
 const verifyNativeSigner=vi.fn(async(path:string)=>({status:'valid' as const,
   signer:f.options.trust.windowsSigner,path,observedAt:Date.now()}));
 const authorize=vi.fn(async()=>true);
 const noOtherWriters=vi.fn(async()=>true);
 const assessRestartSafety=vi.fn(async()=>({safe:true}));
 const deps:ExternalMaintenanceDependencies={observeOffline,verifyNativeSigner,authorize,noOtherWriters,assessRestartSafety};
 const run=(action:'prepare'|'install'|'rollback')=>runExternalWindowsMaintenance(
  {action,applicationData,rootUserData,options:f.options},deps);
 return {...f,applicationData,rootUserData,coordinator,deps,run,observeOffline,verifyNativeSigner,authorize,noOtherWriters,assessRestartSafety};
}
onWindows('F10 external maintenance coordinates genuine temporary SQLite/files and preserves all three receipts through explicit prepare-install-rollback',async()=>{
 const f=await externalFixture();
 const before=await inventory(f.paths.profileRoot);
 const verified=await f.run('prepare');
 expect(verified).toMatchObject({phase:'verified',installed:false,pending:false});
 expect(f.authorize).not.toHaveBeenCalled();
 expect(await inventory(f.paths.packageRoot)).toEqual(f.options.rollback.packageFiles);
 const installed=await f.run('install');
 expect(installed).toMatchObject({phase:'installed',installed:true,pending:false});
 expect(await inventory(f.paths.packageRoot)).toEqual(f.options.target.packageFiles);
 expect(await inventory(f.paths.profileRoot)).toEqual(before);await receipts(f.paths.profileRoot);
 const restored=await f.run('rollback');
 expect(restored).toMatchObject({phase:'rolledBack',installed:true,rolledBack:true,pending:false});
 expect(await inventory(f.paths.packageRoot)).toEqual(f.options.rollback.packageFiles);
 expect(await inventory(f.paths.profileRoot)).toEqual(before);await receipts(f.paths.profileRoot);
 expect(f.authorize).toHaveBeenCalledTimes(2);
 expect(f.verifyNativeSigner).toHaveBeenCalledTimes(3);
});
onWindows.each(['offline-unknown','stale-observation','missing-native','wrong-native','active-writers','live','no-consent','wrong-coordinator'] as const)
 ('F10 external executor refuses %s before application replacement',async issue=>{
 const f=await externalFixture();
 if(issue==='offline-unknown')f.observeOffline.mockResolvedValue({authority:'fixe-independent',session:'x',observedAt:Date.now(),obs:'unknown',twitch:'offline'} as never);
 if(issue==='stale-observation')f.observeOffline.mockResolvedValue({authority:'fixe-independent',session:'x',observedAt:Date.now()-6000,obs:'idle',twitch:'offline'});
 if(issue==='missing-native')f.verifyNativeSigner.mockResolvedValue(undefined as never);
 if(issue==='wrong-native')f.verifyNativeSigner.mockImplementation(async path=>({status:'valid' as const,signer:'F'.repeat(40),path,observedAt:Date.now()}));
 if(issue==='active-writers')f.noOtherWriters.mockResolvedValue(false);
 if(issue==='live')f.assessRestartSafety.mockResolvedValue({safe:false});
 if(issue==='no-consent')f.authorize.mockResolvedValue(false);
 if(issue==='wrong-coordinator')f.options.journalDirectory=join(f.root,'other-journal');
 const before=await inventory(f.paths.profileRoot);
 await expect(f.run('install')).rejects.toThrow();
 expect(await inventory(f.paths.packageRoot)).toEqual(f.options.rollback.packageFiles);
 expect(await inventory(f.paths.profileRoot)).toEqual(before);await receipts(f.paths.profileRoot);
 expect(fs.copyFile).not.toHaveBeenCalled();
});
onWindows('F10 external maintenance refuses when real Desktop runtime owns the same SQLite coordinator even if stopped-check lies',async()=>{
 const f=await externalFixture();
 const runtime=await startWithRuntimeUpgradeOwnership(f.coordinator,'2.1.0',async()=>({stop:async()=>undefined}));
 try{await expect(f.run('install')).rejects.toThrow('BUSY');
  expect(fs.copyFile).not.toHaveBeenCalled();
  expect(await inventory(f.paths.packageRoot)).toEqual(f.options.rollback.packageFiles);
 }finally{await runtime.stop()}
});
onWindows('F10 external executor retains uncertain signed-copy intent and does not replay the incomplete stage',async()=>{
 const f=await externalFixture();
 const actual=await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
 let lost=false;
 vi.mocked(fs.copyFile).mockImplementation(async(from,to,flags)=>{
  await actual.copyFile(from,to,flags);
  if(!lost&&String(to).startsWith(f.paths.preparedPackage+sep)){lost=true;throw Error('lost staged ACK - PRIVATE_FIXTURE')}
 });
 const first=await f.run('install');
 expect(first).toMatchObject({pending:true,installed:false});
 const copies=vi.mocked(fs.copyFile).mock.calls.length;
 const second=await f.run('install');
 expect(second).toMatchObject({pending:true,installed:false});
 expect(vi.mocked(fs.copyFile)).toHaveBeenCalledTimes(copies);
 expect(await inventory(f.paths.packageRoot)).toEqual(f.options.rollback.packageFiles);await receipts(f.paths.profileRoot);
});

onWindows('F10 external TEST-ONLY child processes use the same durable coordinator across prepare/install/rollback without touching an installed profile',async()=>{
 const f=await externalFixture();
 const config=join(f.root,'qa-external.json');
 const script=join(process.cwd(),'tests/fixtures/streamcockpit3-external-maintenance-process.ts');
 const baseline=await inventory(f.paths.profileRoot);
 const command=(action:'prepare'|'install'|'rollback')=>{
  // These bytes are temporary; no production key, installation, host or provider.
  const child=spawnSync(process.execPath,['--import','tsx',script,action,config],{
   cwd:process.cwd(),encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:1024*1024
  });
  expect(child.error).toBeUndefined();
  expect(child.status,child.stderr).toBe(0);
  return JSON.parse(child.stdout.trim()) as {phase:string;pending:boolean;installed:boolean;rolledBack:boolean};
 };
 for(const action of ['prepare','install','rollback'] as const){
  await fs.writeFile(config,JSON.stringify({
   action,applicationData:f.applicationData,rootUserData:f.rootUserData,options:f.options
  }));
  const result=command(action);
  expect(result.pending).toBe(false);
  expect(result.phase).toBe(action==='prepare'?'verified':action==='install'?'installed':'rolledBack');
  expect(await inventory(f.paths.profileRoot)).toEqual(baseline);
  await receipts(f.paths.profileRoot);
 }
 expect(await inventory(f.paths.packageRoot)).toEqual(f.options.rollback.packageFiles);
 const store=new SqliteUpgradeJournal(f.coordinator);
 expect((await store.exclusive(()=>store.read()))?.phase).toBe('rolledBack');
},45000);

onWindows('F10 external rollback verifies original signed backup even if new release source is no longer available',async()=>{
 const f=await externalFixture();
 expect((await f.run('install')).installed).toBe(true);
 await fs.rm(f.paths.sourcePackage,{recursive:true,force:true});
 const restored=await f.run('rollback');
 expect(restored).toMatchObject({phase:'rolledBack',pending:false,rolledBack:true});
 expect(await inventory(f.paths.packageRoot)).toEqual(f.options.rollback.packageFiles);
 await receipts(f.paths.profileRoot);
 expect(f.verifyNativeSigner.mock.calls.at(-1)?.[0]).toBe(join(f.paths.backupPackage,'StreamCockpit.exe'));
});
onWindows('F10 external rollback refuses missing native trust on OLD backup instead of erasing post-upgrade image',async()=>{
 const f=await externalFixture();
 expect((await f.run('install')).installed).toBe(true);
 f.verifyNativeSigner.mockResolvedValue(undefined as never);
 const current=await inventory(f.paths.packageRoot);
 await expect(f.run('rollback')).rejects.toThrow('NATIVE_SIGNER_UNVERIFIED');
 expect(await inventory(f.paths.packageRoot)).toEqual(current);
 await receipts(f.paths.profileRoot);
});

onWindows('F10 external maintenance authenticates publisher before any operator consent request',async()=>{
 const f=await externalFixture();
 f.options.manifest.signature.value='A'.repeat(86)+'==';
 await expect(f.run('install')).rejects.toThrow('SIGNATURE_INVALID');
 expect(f.authorize).not.toHaveBeenCalled();
 expect(fs.copyFile).not.toHaveBeenCalled();
 expect(await inventory(f.paths.packageRoot)).toEqual(f.options.rollback.packageFiles);
 await receipts(f.paths.profileRoot);
});

onWindows('F10 missing injected signer now invokes real Windows trust and refuses unsigned source BEFORE journal registration',async()=>{
 const f=await externalFixture();delete f.deps.verifyNativeSigner;
 await expect(f.run('install')).rejects.toThrow('NATIVE_SIGNER_UNVERIFIED');
 expect(await fs.readdir(f.coordinator)).toEqual([]);expect(fs.copyFile).not.toHaveBeenCalled();
 expect(await inventory(f.paths.packageRoot)).toEqual(f.options.rollback.packageFiles);
},25000);
onWindows.each(['hash','version'])('F10 refuses a native %s inconsistent with the publisher-bound source',async field=>{
 const f=await externalFixture();
 f.verifyNativeSigner.mockImplementation(async path=>({status:'valid' as const,signer:f.options.trust.windowsSigner,
  path,observedAt:Date.now(),...(field==='hash'?{sha256:'f'.repeat(64)}:{version:'9.9.9'})}));
 await expect(f.run('install')).rejects.toThrow(field==='hash'?'SIGNED_SOURCE_CHANGED':'NATIVE_VERSION_MISMATCH');
 expect(fs.copyFile).not.toHaveBeenCalled();expect(await fs.readdir(f.coordinator)).toEqual([]);
});
onWindows('F10 native wiring replaces injectable trust/readback with the native adapter and verifies complete installed bytes (OS response simulated)',async()=>{
 const f=await externalFixture();
 const native=await import('../apps/desktop/src/streamcockpit-windows-authenticode.js');
 const {runNativeWindowsMaintenance}=await import('../apps/desktop/src/streamcockpit-native-maintenance.js');
 const verify=vi.spyOn(native,'inspectWindowsAuthenticode').mockImplementation(async path=>{
  const bytes=await fs.readFile(path);
  return {status:'valid',signer:f.options.trust.windowsSigner,path,observedAt:Date.now(),
   sha256:hash(bytes),version:bytes.toString().startsWith('NEW')?'3.0.0':'2.1.0'};
 });
 // These old injected attesters must NOT be used by the concrete native entry.
 f.attestInstalled.mockResolvedValue(undefined);f.verifyNativeSigner.mockResolvedValue(undefined as never);
 const run=(action:'prepare'|'install'|'rollback')=>runNativeWindowsMaintenance(
  {action,applicationData:f.applicationData,rootUserData:f.rootUserData,options:f.options},f.deps);
 expect(await run('prepare')).toMatchObject({phase:'verified',installed:false});
 expect(await run('install')).toMatchObject({phase:'installed',pending:false});
 expect(await inventory(f.paths.packageRoot)).toEqual(f.options.target.packageFiles);
 expect(await run('rollback')).toMatchObject({phase:'rolledBack',pending:false});
 expect(await inventory(f.paths.packageRoot)).toEqual(f.options.rollback.packageFiles);await receipts(f.paths.profileRoot);
 expect(verify).toHaveBeenCalled();expect(f.attestInstalled).not.toHaveBeenCalled();expect(f.verifyNativeSigner).not.toHaveBeenCalled();
});
