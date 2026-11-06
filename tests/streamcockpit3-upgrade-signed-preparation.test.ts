import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import * as fs from 'node:fs/promises';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {dirname,join,relative,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {createSignedWindowsDirectoryUpgradePlanner,directoryReleaseImageHash,directoryReleaseSigningPayload,
  type SignedDirectoryUpgradeOptions} from '../apps/desktop/src/streamcockpit-upgrade-signed-preparation.js';
import type {UpgradeReadbackFile,UpgradeReadbackIdentity} from '../apps/desktop/src/streamcockpit-upgrade-readback.js';
import {AutoModActionIntentSqlite} from '../apps/server/src/streamcockpit-automod-action-intent-sqlite.js';
import {PredictionIntentSqlite} from '../apps/server/src/streamcockpit-prediction-intent-sqlite.js';
import {MomentsSqliteStorage} from '../apps/server/src/streamcockpit-moments-sqlite.js';
import {SqliteUpgradeJournal} from '../apps/desktop/src/streamcockpit-upgrade-journal.js';
import {startWithRuntimeUpgradeOwnership} from '../apps/desktop/src/streamcockpit-runtime-ownership.js';
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
