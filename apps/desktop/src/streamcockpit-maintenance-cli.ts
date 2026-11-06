import {lstat,readFile,realpath,open} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {SqliteUpgradeJournal} from './streamcockpit-upgrade-journal.js';
import {isAbsolute,join,resolve,sep} from 'node:path';
import {createSignedWindowsDirectoryUpgradePlanner,type DirectoryReleaseTrust,type SignedDirectoryUpgradeOptions} from './streamcockpit-upgrade-signed-preparation.js';
import {inspectWindowsAuthenticode,windowsApplicationEntry,windowsVersionMatches} from './streamcockpit-windows-authenticode.js';
import {verifyUpgradeReadbackFiles,snapshotUpgradeReadbackFiles,type UpgradeReadbackFile} from './streamcockpit-upgrade-readback.js';
import {runtimeUpgradeDirectory} from './streamcockpit-runtime-ownership.js';
import {runNativeWindowsMaintenance} from './streamcockpit-native-maintenance.js';
import {createIndependentMaintenanceObserver,inspectWindowsMaintenanceWriters,validateMaintenanceObserverConfiguration,
 type MaintenanceObserverInput as MaintenanceObserverConfiguration} from './streamcockpit-maintenance-observer.js';
import type {ExternalMaintenanceRequest,ExternalMaintenanceResult} from './streamcockpit-external-maintenance.js';

export type PreparedMaintenanceRequest={action:ExternalMaintenanceRequest['action'];applicationData:string;rootUserData:string;
 options:Omit<SignedDirectoryUpgradeOptions,'runtimeStopped'|'attestInstalled'|'trust'|'now'>};
export interface MaintenanceEnvelope {
 schemaVersion:1;request:PreparedMaintenanceRequest;trust:DirectoryReleaseTrust;
 observer:MaintenanceObserverConfiguration;
 /** Supplied by the trusted native UI, not the release or renderer. */
 consent:{action:ExternalMaintenanceRequest['action'];releaseId:string};parentPid:number;
 /** Native UI may bind same-schema data only after its final logs/Chromium exit. */
 captureStoppedProfile?:true;
}
const denied=(code:string):never=>{throw Error('SC3_NATIVE_MAINTENANCE_'+code)};
const local=(p:unknown):p is string=>typeof p==='string'&&isAbsolute(p)&&/^[A-Za-z]:[\\/]/.test(p)&&
 !p.slice(2).includes(':')&&!/[\x00-\x1f]/.test(p);
const samePath=(a:string,b:string)=>resolve(a).toLowerCase()===resolve(b).toLowerCase();
const beneath=(a:string,b:string)=>samePath(a,b)||resolve(a).toLowerCase().startsWith(resolve(b).toLowerCase()+sep);
const exact=(o:unknown,keys:string[])=>o&&typeof o==='object'&&!Array.isArray(o)&&
 Object.keys(o).sort().join('|')===[...keys].sort().join('|');

/** Public policy is loaded independently by the installed native application.
 * Never accept a public key or certificate pin from a selected release file. */
export function validateMaintenanceTrust(value:unknown):DirectoryReleaseTrust {
 const t=value as DirectoryReleaseTrust;
 if(!exact(t,['keyId','publicKeyPem','applicationId','windowsSigner','sourceOrigin'])||
  typeof t.keyId!=='string'||!t.keyId.trim()||t.keyId.length>200||typeof t.publicKeyPem!=='string'||
  t.publicKeyPem.length>8192||!t.publicKeyPem.startsWith('-----BEGIN PUBLIC KEY-----')||
  typeof t.applicationId!=='string'||!/^[A-Za-z][A-Za-z0-9._-]{0,199}$/.test(t.applicationId)||
  typeof t.windowsSigner!=='string'||!/^[A-F0-9]{40}$/.test(t.windowsSigner)||typeof t.sourceOrigin!=='string')denied('TRUST_UNAVAILABLE');
 return structuredClone(t);
}
export function nativeMaintenanceRequest(value:unknown,policy:DirectoryReleaseTrust):ExternalMaintenanceRequest {
 if(process.platform!=='win32')denied('WINDOWS_REQUIRED');
 const r=structuredClone(value) as PreparedMaintenanceRequest;
 if(!exact(r,['action','applicationData','rootUserData','options'])||!['prepare','install','rollback'].includes(r.action)||
  !local(r.applicationData)||!local(r.rootUserData)||!r.options)denied('REQUEST_INVALID');
 const o=r.options,keys=['manifest','image','target','rollback','journalDirectory','packageRoot','profileRoot','preparedPackage',
  'preparedProfile','backupPackage','backupProfile','sourcePackage'];
 if(!exact(o,[...keys,...(Object.hasOwn(o,'profileMigration')?['profileMigration']:[])]))denied('REQUEST_INVALID');
 for(const key of ['journalDirectory','packageRoot','profileRoot','preparedPackage','preparedProfile','backupPackage','backupProfile','sourcePackage'] as const)
  if(!local(o[key]))denied('REQUEST_INVALID');
 if(!samePath(o.profileRoot,r.rootUserData)||!samePath(o.journalDirectory,runtimeUpgradeDirectory(r.applicationData,r.rootUserData)))denied('ROOT_MISMATCH');
 const options:SignedDirectoryUpgradeOptions={...o,trust:validateMaintenanceTrust(policy),
  runtimeStopped:async()=>false,attestInstalled:async()=>undefined};
 // Construction verifies the publisher signature and all existing directory and
 // migration contracts. It does not register an intent or create a backup.
 createSignedWindowsDirectoryUpgradePlanner(options,{assessRestartSafety:async()=>({safe:false})});
 return {...r,options};
}
export async function readPreparedMaintenanceRequest(file:string,policy:DirectoryReleaseTrust):Promise<ExternalMaintenanceRequest> {
 if(!local(file))denied('REQUEST_PATH_INVALID');
 const full=resolve(file),s=await lstat(full);
 if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size<1||s.size>1024*1024||
  !samePath(await realpath(full),full))denied('REQUEST_FILE_UNAVAILABLE');
 const raw=await readFile(full),after=await lstat(full);
 if(after.ino!==s.ino||after.size!==s.size||after.mtimeMs!==s.mtimeMs||raw.length!==s.size)denied('REQUEST_CHANGED');
 return nativeMaintenanceRequest(JSON.parse(raw.toString('utf8')),policy);
}
/** The external helper is carried by the authenticated new image and executes
 * OUTSIDE the directory being replaced. A rollback may use the retained staged
 * image even when the download directory no longer exists. */
export async function verifyMaintenanceCarrier(request:ExternalMaintenanceRequest) {
 const o=request.options,folder=request.action==='rollback'?o.preparedPackage:o.sourcePackage;
 if(beneath(folder,o.packageRoot)||beneath(folder,o.profileRoot)||beneath(o.packageRoot,folder))denied('CARRIER_INSIDE_INSTALLATION');
 const binary=windowsApplicationEntry(o.image.packageFiles),entry='resources/streamcockpit-maintenance.cjs';
 if(o.image.packageFiles.filter(f=>f.path===entry).length!==1)denied('CARRIER_MISSING');
 if(!await verifyUpgradeReadbackFiles(folder,o.image.packageFiles))denied('CARRIER_CHANGED');
 const executable=join(folder,binary.path),signature=await inspectWindowsAuthenticode(executable);
 if(!signature||signature.status!=='valid'||signature.signer!==o.trust.windowsSigner||signature.sha256!==binary.sha256||
  !windowsVersionMatches(signature.version,o.image.identity.version))denied('CARRIER_UNTRUSTED');
 if(!await verifyUpgradeReadbackFiles(folder,o.image.packageFiles))denied('CARRIER_CHANGED');
 return {executable,script:join(folder,entry),directory:folder};
}
const processExists=(pid:number)=>{try{process.kill(pid,0);return true}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')return false;throw error}};
/** Bind the real STOPPED data, including final native logs, rather than a stale
 * pre-quit inventory. The immutable record contains only paths/sizes/hashes and
 * lives beside the existing coordinator, outside the profile and its backup.
 * It is reused for recovery/rollback; never rebaseline after an attempted effect.
 * No new profile copy is created. Actual backup remains the planner's one copy. */
async function bindStoppedProfile(request:ExternalMaintenanceRequest,observe:()=>Promise<unknown>) {
 const o=request.options;
 if(request.action==='prepare')return;
 if(o.profileMigration||o.manifest.schema.from!==o.manifest.schema.to)denied('PROFILE_TRANSFORMATION_REQUIRES_PREPARED_INVENTORY');
 const binding=JSON.stringify({manifest:o.manifest,profile:resolve(o.profileRoot),package:resolve(o.packageRoot)});
 const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
 const file=join(o.journalDirectory,'profile-'+o.manifest.id+'.json');
 const store=new SqliteUpgradeJournal(o.journalDirectory);
 const files=await store.exclusive(async()=>{
  if(!await inspectWindowsMaintenanceWriters(o.packageRoot,o.profileRoot)||!await observe())denied('PROFILE_WRITERS_NOT_STOPPED');
  try{
   const stat=await lstat(file);
   if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>1024*1024||!samePath(await realpath(file),file))denied('PROFILE_SNAPSHOT_INVALID');
   const bytes=await readFile(file,'utf8'),saved=JSON.parse(bytes);
   if(!exact(saved,['binding','files','sha256'])||saved.binding!==binding||!Array.isArray(saved.files)||
    hash(JSON.stringify({binding:saved.binding,files:saved.files}))!==saved.sha256)denied('PROFILE_SNAPSHOT_INVALID');
   // Existing verifier validates shape and current exact bytes before admission.
   if(!await verifyUpgradeReadbackFiles(o.profileRoot,saved.files))denied('PROFILE_CHANGED_SINCE_CAPTURE');
   return saved.files as UpgradeReadbackFile[];
  }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
  const journal=await store.read();
  if(request.action==='rollback'||journal&&(journal.pending||journal.backup||journal.migration||journal.installed||journal.rolledBack))denied('PROFILE_SNAPSHOT_MISSING_AFTER_EFFECT');
  const captured=await snapshotUpgradeReadbackFiles(o.profileRoot);
  if(!captured.length||!await verifyUpgradeReadbackFiles(o.profileRoot,captured)||
   !await inspectWindowsMaintenanceWriters(o.packageRoot,o.profileRoot)||!await observe())denied('PROFILE_CHANGED_DURING_CAPTURE');
  const payload={binding,files:captured},encoded=JSON.stringify({...payload,sha256:hash(JSON.stringify(payload))});
  if(Buffer.byteLength(encoded)>1024*1024)denied('PROFILE_SNAPSHOT_TOO_LARGE');
  const handle=await open(file,'wx',0o600);
  try{await handle.writeFile(encoded,'utf8');await handle.sync()}finally{await handle.close()}
  if(await readFile(file,'utf8')!==encoded)denied('PROFILE_SNAPSHOT_UNCERTAIN');
  return captured;
 });
 o.target.profileFiles=structuredClone(files);o.rollback.profileFiles=structuredClone(files);
}
/** Actual executable entry: concrete OS writer checks, independent OBS/Helix
 * reads, native Authenticode and the SAME planner. No application is killed or
 * restarted; the parent must exit normally after its own explicit confirmation. */
export async function runMaintenanceEnvelope(value:unknown,
 ready:(releaseId:string)=>void=()=>{}):Promise<ExternalMaintenanceResult>{
 const envelope=structuredClone(value) as MaintenanceEnvelope;
 if(!exact(envelope,['schemaVersion','request','trust','observer','consent','parentPid',
   ...(envelope&&Object.hasOwn(envelope,'captureStoppedProfile')?['captureStoppedProfile']:[])])||envelope.schemaVersion!==1||
  (Object.hasOwn(envelope,'captureStoppedProfile')&&envelope.captureStoppedProfile!==true)||
  !Number.isSafeInteger(envelope.parentPid)||envelope.parentPid<0||envelope.parentPid===process.pid||
  !exact(envelope.consent,['action','releaseId']))denied('ENVELOPE_INVALID');
 const request=nativeMaintenanceRequest(envelope.request,envelope.trust),o=request.options;
 if(envelope.consent.action!==request.action||envelope.consent.releaseId!==o.manifest.id)denied('CONSENT_REQUIRED');
 if(beneath(process.execPath,o.packageRoot)||beneath(process.execPath,o.profileRoot))denied('EXECUTOR_INSIDE_INSTALLATION');
 await verifyMaintenanceCarrier(request);
 const observer=await createIndependentMaintenanceObserver(validateMaintenanceObserverConfiguration(envelope.observer));
 try{
  if(!await observer.observe())denied('LIVE_OR_UNKNOWN');
  ready(o.manifest.id);
  const deadline=Date.now()+30000;
  while(envelope.parentPid!==0&&processExists(envelope.parentPid)){
   if(Date.now()>deadline||!await observer.observe())denied('PARENT_NOT_STOPPED');
   await new Promise(r=>setTimeout(r,200));
  }
  if(envelope.captureStoppedProfile)await bindStoppedProfile(request,()=>observer.observe());
  return await runNativeWindowsMaintenance(request,{
   observeOffline:()=>observer.observe(),noOtherWriters:()=>inspectWindowsMaintenanceWriters(o.packageRoot,o.profileRoot),
   authorize:async(action,id)=>action===envelope.consent.action&&id===envelope.consent.releaseId,
   assessRestartSafety:async()=>({safe:Boolean(await observer.observe())}),
  });
 }finally{await observer.close()}
}
/** Bundled as an external plain CJS resource. Credentials use a private stdin
 * pipe, not argv/environment/files. Stdout contains only fixed public results. */
export async function maintenanceMain(){
 const output=(value:unknown)=>{try{process.stdout.write(JSON.stringify(value)+'\n')}catch{/* parent may already have exited */}};
 process.stdout.on('error',()=>{});
 try{
  if(process.argv.slice(2).join(' ')!=='--stdio-v1')denied('COMMAND_INVALID');
  const raw=await new Promise<Buffer>((resolve,reject)=>{
   const chunks:Buffer[]=[];let size=0;const timer=setTimeout(()=>reject(deniedError()),10000);
   const done=()=>clearTimeout(timer),bad=()=>{done();reject(deniedError());process.stdin.destroy()};
   process.stdin.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>2*1024*1024)bad();else chunks.push(chunk)});
   process.stdin.once('error',bad);process.stdin.once('end',()=>{done();resolve(Buffer.concat(chunks))});
  });
  const envelope=JSON.parse(raw.toString('utf8'));raw.fill(0);
  const result=await runMaintenanceEnvelope(envelope,id=>output({kind:'ready',releaseId:id}));
  output({kind:'result',...result});process.exitCode=result.pending||result.phase==='deferred'?2:0;
 }catch{output({kind:'blocked',code:'MAINTENANCE_NOT_CONFIRMED'});process.exitCode=1}
}
function deniedError(){return new Error('SC3_NATIVE_MAINTENANCE_INPUT_UNAVAILABLE')}
