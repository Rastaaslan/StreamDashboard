import {createHash} from 'node:crypto';
import {lstat,open,readFile,realpath,rename} from 'node:fs/promises';
import {basename,dirname,isAbsolute,join,resolve,sep} from 'node:path';
import {createAuthenticatedWindowsUpgradePreparation,createSignedWindowsDirectoryUpgradePlanner,
 type SignedDirectoryUpgradeOptions} from './streamcockpit-upgrade-signed-preparation.js';
import {copyVerifiedUpgradeTree,createWindowsDirectoryUpgradePlanner} from './streamcockpit-upgrade-directory.js';
import {createDurableDesktopUpgradePlanner} from './streamcockpit-upgrade.js';
import {createUpgradeReadbackReconciler,snapshotUpgradeReadbackFiles,verifyUpgradeReadbackFiles,
 type UpgradeReadbackFile} from './streamcockpit-upgrade-readback.js';
import {nativeSquirrelState,validateSquirrelNativeState,type SquirrelNativeState} from './streamcockpit-squirrel-native.js';
import {bindSquirrelVersions,squirrelFailure,squirrelRelease,squirrelReleaseLine} from './streamcockpit-squirrel-contract.js';
import type {RestartSafety} from './restart-safety.js';
import type {UpgradeJournal,UpgradeManifest} from '../../../packages/core/src/streamcockpit-upgrade.js';

const hash=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const pathKey=(p:string)=>resolve(p).toLowerCase();
const pathSame=(a:string,b:string)=>pathKey(a)===pathKey(b);
const overlaps=(a:string,b:string)=>pathSame(a,b)||pathKey(a).startsWith(pathKey(b)+sep)||pathKey(b).startsWith(pathKey(a)+sep);
const local=(p:unknown):p is string=>typeof p==='string'&&isAbsolute(p)&&/^[A-Za-z]:[\\/]/.test(p)&&
 !p.slice(2).includes(':')&&!/[\x00-\x1f]/.test(p)&&!/[. ]$/.test(p);
async function exact(root:string,files:UpgradeReadbackFile[]){
 if(!await verifyUpgradeReadbackFiles(root,files))throw squirrelFailure('INVENTORY_CHANGED');
}
async function absent(path:string){
 try{await lstat(path)}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return;throw e}
 throw squirrelFailure('RECOVERY_FILES_EXIST');
}
interface NativeSnapshot {binding:string;files:UpgradeReadbackFile[];state:SquirrelNativeState}
/** The SAME committed journal and exclusion as portable maintenance. Native
 * Squirrel installs a single authenticated FULL package via its .NET API.
 * A complete installation tree, registration and shortcut snapshot permits
 * explicit rollback without asking Squirrel to downgrade or reinstall. */
export function createSignedWindowsSquirrelUpgradePlanner(input:SignedDirectoryUpgradeOptions,
 dashboard:{assessRestartSafety():Promise<RestartSafety>}){
 const detached={...input,manifest:structuredClone(input.manifest),image:structuredClone(input.image),
  target:structuredClone(input.target),rollback:structuredClone(input.rollback),
  squirrel:structuredClone(input.squirrel)};
 const {options:o,preparation}=createAuthenticatedWindowsUpgradePreparation(detached);
 // Reuse existing root, data-journal and migration validation, without its apply adapter.
 createWindowsDirectoryUpgradePlanner(o,preparation,dashboard);
 const s=squirrelRelease(o.image.squirrel);bindSquirrelVersions(s,o.manifest);
 if(!o.squirrel||Object.keys(o.squirrel).sort().join('|')!=='backupInstallation|sourceFeed'||
  !local(o.squirrel.sourceFeed)||!local(o.squirrel.backupInstallation))throw squirrelFailure('PATHS_INVALID');
 const installationRoot=dirname(resolve(o.packageRoot)),feed=resolve(o.squirrel.sourceFeed),
  backupInstallation=resolve(o.squirrel.backupInstallation),preparedFeed=join(o.journalDirectory,'squirrel-feed-'+o.manifest.id);
 const oldRoot=join(installationRoot,'app-'+s.fromVersion),newRoot=join(installationRoot,'app-'+s.version);
 if(basename(installationRoot).toLowerCase()!==s.packageId.toLowerCase()||!pathSame(o.packageRoot,oldRoot)||
  !pathSame(o.backupPackage,join(backupInstallation,'app-'+s.fromVersion)))throw squirrelFailure('INSTALLATION_BINDING_MISMATCH');
 const external=[o.journalDirectory,o.profileRoot,o.preparedPackage,o.preparedProfile,o.backupProfile,o.sourcePackage,feed,backupInstallation];
 for(const p of external)if(overlaps(p,installationRoot))throw squirrelFailure('ROOTS_OVERLAP');
 for(const p of external.slice(0,-2))if(overlaps(p,feed)||overlaps(p,backupInstallation))throw squirrelFailure('ROOTS_OVERLAP');
 if(overlaps(feed,backupInstallation))throw squirrelFailure('ROOTS_OVERLAP');
 const candidate=(active:string,tag:string)=>join(dirname(active),'.'+basename(active)+'.sc3-'+o.manifest.id+'-squirrel-'+tag+'-candidate');
 const previous=(active:string,tag:string)=>join(dirname(active),'.'+basename(active)+'.sc3-'+o.manifest.id+'-squirrel-'+tag+'-previous');
 const recovery=[candidate(installationRoot,'rollback'),previous(installationRoot,'rollback'),
  ...(['install','rollback']as const).flatMap(tag=>[candidate(o.profileRoot,tag),previous(o.profileRoot,tag)])];
 for(let i=0;i<recovery.length;i++){
  for(const p of [installationRoot,...external])if(overlaps(recovery[i]!,p))throw squirrelFailure('RECOVERY_ROOTS_OVERLAP');
  for(const p of recovery.slice(i+1))if(overlaps(recovery[i]!,p))throw squirrelFailure('RECOVERY_ROOTS_OVERLAP');
 }
 const binding=hash(JSON.stringify({manifest:o.manifest,image:o.image,rollback:o.rollback,root:installationRoot,
  profile:o.profileRoot,backupInstallation}));
 const record=(which:'old'|'new')=>join(o.journalDirectory,'squirrel-'+o.manifest.id+'-'+which+'.json');
 const stopped=async()=>{if(await o.runtimeStopped()!==true)throw squirrelFailure('RUNTIME_NOT_STOPPED')};
 const contract=(manifest:UpgradeManifest,key:string,operation:string)=>{
  if(!same(manifest,o.manifest)||key!==o.manifest.id+':'+operation)throw squirrelFailure('CONTRACT_CHANGED');
 };
 const writeRecord=async(which:'old'|'new',snapshot:NativeSnapshot)=>{
  const payload=JSON.stringify(snapshot),encoded=JSON.stringify({snapshot,sha256:hash(payload)}),file=record(which);
  const handle=await open(file,'wx',0o600);
  try{await handle.writeFile(encoded,'utf8');await handle.sync()}finally{await handle.close()}
  if(await readFile(file,'utf8')!==encoded)throw squirrelFailure('SNAPSHOT_UNCONFIRMED');
 };
 const readRecord=async(which:'old'|'new'):Promise<NativeSnapshot>=>{
  const file=record(which),stat=await lstat(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>2*1024**2||
   !pathSame(await realpath(file),file))throw squirrelFailure('SNAPSHOT_INVALID');
  const raw=await readFile(file,'utf8'),value=JSON.parse(raw),after=await lstat(file);
  if(after.ino!==stat.ino||after.size!==stat.size||after.mtimeMs!==stat.mtimeMs||
   Object.keys(value).sort().join('|')!=='sha256|snapshot'||value.sha256!==hash(JSON.stringify(value.snapshot))||
   Object.keys(value.snapshot).sort().join('|')!=='binding|files|state'||value.snapshot.binding!==binding||
   !Array.isArray(value.snapshot.files))throw squirrelFailure('SNAPSHOT_INVALID');
  validateSquirrelNativeState(value.snapshot.state,installationRoot);
  return value.snapshot;
 };
 const native=(action:'read'|'apply'|'restore',state?:SquirrelNativeState)=>
  nativeSquirrelState(action,installationRoot,preparedFeed,s,o.trust.windowsSigner,state,o.preparedPackage);
 const nativeVersion=(state:SquirrelNativeState)=>state.registry.find(r=>r.name==='DisplayVersion')?.value;
 const checkUpdater=async()=>{
  // Full-root verifier would reject other files; explicitly pin just this file.
  const b=await readFile(join(installationRoot,'Update.exe'));
  if(b.length!==s.updater.bytes||hash(b)!==s.updater.sha256)throw squirrelFailure('UPDATER_CHANGED');
 };
 const feedFiles:UpgradeReadbackFile[]=[{path:s.package.path,bytes:s.package.bytes,sha256:s.package.sha256},
  {path:'SquirrelApi.exe',...s.updater},
  {path:'RELEASES',bytes:Buffer.byteLength(squirrelReleaseLine(s)),sha256:hash(squirrelReleaseLine(s))}];
 const verifyFeed=async()=>{
  await exact(preparedFeed,feedFiles);
  const b=await readFile(join(preparedFeed,s.package.path));
  if(createHash('sha1').update(b).digest('hex')!==s.package.sha1)throw squirrelFailure('PACKAGE_CHANGED');
 };
 const readbacks={
  install:createUpgradeReadbackReconciler({...o,packageRoot:newRoot}),
  rollback:createUpgradeReadbackReconciler({...o,packageRoot:oldRoot}),
 };
 const readback=async(operation:'install'|'rollback',key:string)=>{
  await stopped();
  const old=await readRecord('old'),expected=operation==='install'?await readRecord('new'):old;
  await exact(backupInstallation,old.files);await exact(o.backupProfile,o.rollback.profileFiles);
  await exact(installationRoot,expected.files);
  const state=await native('read');
  if(nativeVersion(state)!==(operation==='install'?s.version:s.fromVersion)||!same(state,expected.state))return undefined;
  await stopped();await exact(installationRoot,expected.files);
  return readbacks[operation](operation,key);
 };
 const backup=async(manifest:UpgradeManifest,key:string)=>{
  contract(manifest,key,'backup');await stopped();await verifyFeed();await absent(record('old'));
  await exact(oldRoot,o.rollback.packageFiles);await exact(o.profileRoot,o.rollback.profileFiles);
  await checkUpdater();
  const state=await native('read');
  if(nativeVersion(state)!==s.fromVersion)throw squirrelFailure('REGISTERED_VERSION_CHANGED');
  const files=await snapshotUpgradeReadbackFiles(installationRoot);
  await copyVerifiedUpgradeTree(installationRoot,backupInstallation,files);
  await copyVerifiedUpgradeTree(o.profileRoot,o.backupProfile,o.rollback.profileFiles);
  await stopped();await exact(installationRoot,files);await exact(o.profileRoot,o.rollback.profileFiles);
  if(!same(state,await native('read')))throw squirrelFailure('NATIVE_STATE_CHANGED');
  await writeRecord('old',{binding,files,state});return {reference:o.backupPackage};
 };
 const intent=(journal:UpgradeJournal,key:string,operation:'install'|'rollback')=>{
  contract(journal.manifest,key,operation);
  if(journal.pending?.operation!==operation||journal.pending.key!==key||journal.staged!==o.preparedPackage||
   journal.backup!==o.backupPackage||journal.migration!==o.preparedProfile||journal.rolledBack||
   (operation==='install'?journal.installed:!journal.installed))throw squirrelFailure('INTENT_MISMATCH');
 };
 const prepareProfile=async(operation:'install'|'rollback')=>{
  const current=operation==='install'?o.rollback:o.target,next=operation==='install'?o.target:o.rollback;
  await exact(o.profileRoot,current.profileFiles);
  await copyVerifiedUpgradeTree(operation==='install'?o.preparedProfile:o.backupProfile,
   candidate(o.profileRoot,operation),next.profileFiles);
  await absent(previous(o.profileRoot,operation));
 };
 const swapProfile=async(operation:'install'|'rollback')=>{
  const current=operation==='install'?o.rollback:o.target;
  await stopped();await exact(o.profileRoot,current.profileFiles);
  await rename(o.profileRoot,previous(o.profileRoot,operation));
  await stopped();await absent(o.profileRoot);await rename(candidate(o.profileRoot,operation),o.profileRoot);
 };
 return createDurableDesktopUpgradePlanner(o.journalDirectory,{
  stage:async(manifest,artifact,key)=>{
   contract(manifest,key,'stage');
   const receipt=await preparation.stage(manifest,artifact,key);
   await stopped();
   // The feed is constructed from one signed full-package hash, never a URL/remote RELEASES.
   const b=await readFile(join(feed,s.package.path));
   if(b.length!==s.package.bytes||hash(b)!==s.package.sha256||
    createHash('sha1').update(b).digest('hex')!==s.package.sha1)throw squirrelFailure('PACKAGE_CHANGED');
   await checkUpdater();
   const updater=await readFile(join(installationRoot,'Update.exe'));
   if(updater.length!==s.updater.bytes||hash(updater)!==s.updater.sha256)throw squirrelFailure('UPDATER_CHANGED');
   await absent(preparedFeed);
   const {mkdir}=await import('node:fs/promises');await mkdir(preparedFeed,{mode:0o700});
   for(const entry of feedFiles){
    const handle=await open(join(preparedFeed,entry.path),'wx',0o600);
    try{await handle.writeFile(entry.path==='RELEASES'?Buffer.from(squirrelReleaseLine(s)):entry.path==='SquirrelApi.exe'?updater:b);await handle.sync()}
    finally{await handle.close()}
   }
   await verifyFeed();await stopped();return receipt;
  },
  verify:async(manifest,staged)=>{
   const verified=await preparation.verify(manifest,staged);
   if(!verified)return false;await verifyFeed();return true;
  },
  backup,migrate:preparation.migrate,
  install:async(journal,key)=>{
   intent(journal,key,'install');await stopped();await verifyFeed();
   const old=await readRecord('old');
   await exact(backupInstallation,old.files);await exact(installationRoot,old.files);
   await exact(o.backupProfile,o.rollback.profileFiles);await exact(o.preparedPackage,o.image.packageFiles);
   if(!same(await native('read'),old.state))throw squirrelFailure('NATIVE_STATE_CHANGED');
   await absent(record('new'));await prepareProfile('install');await stopped();
   await native('apply'); // One native API call; a failure retains the committed pending intent.
   await stopped();await exact(newRoot,o.target.packageFiles);
   await swapProfile('install');await stopped();
   const state=await native('read');
   if(nativeVersion(state)!==s.version)throw squirrelFailure('NATIVE_RESULT_UNCONFIRMED');
   const files=await snapshotUpgradeReadbackFiles(installationRoot);
   await exact(installationRoot,files);
   await writeRecord('new',{binding,files,state});
   const receipt=await readback('install',key);
   if(!receipt)throw squirrelFailure('NATIVE_RESULT_UNCONFIRMED');return receipt;
  },
  rollback:async(journal,key)=>{
   intent(journal,key,'rollback');await stopped();
   // Never replace later app/data, shortcut or registration changes.
   if(!await readback('install',o.manifest.id+':install'))throw squirrelFailure('CURRENT_INSTALLATION_CHANGED');
   const old=await readRecord('old');
   await copyVerifiedUpgradeTree(backupInstallation,candidate(installationRoot,'rollback'),old.files);
   await absent(previous(installationRoot,'rollback'));await prepareProfile('rollback');await stopped();
   await rename(installationRoot,previous(installationRoot,'rollback'));
   await stopped();await absent(installationRoot);await rename(candidate(installationRoot,'rollback'),installationRoot);
   await swapProfile('rollback');await stopped();
   await native('restore',old.state);
   const receipt=await readback('rollback',key);
   if(!receipt)throw squirrelFailure('ROLLBACK_UNCONFIRMED');return receipt;
  },
  reconcile:async(operation,key)=>{
   try{
    contract(o.manifest,key,operation);await stopped();
    if(operation==='install'||operation==='rollback')return await readback(operation,key);
    if(operation==='stage'){await verifyFeed();return await preparation.reconcile(operation,key)}
    if(operation==='backup'){
     const old=await readRecord('old');await exact(backupInstallation,old.files);await exact(installationRoot,old.files);
     await exact(o.backupProfile,o.rollback.profileFiles);await exact(o.profileRoot,o.rollback.profileFiles);
     if(!same(await native('read'),old.state))return undefined;
     return {reference:o.backupPackage};
    }
    if(operation==='migrate')return await preparation.reconcile(operation,key);
    return undefined;
   }catch{return undefined}
  },
 },dashboard);
}
export function createSignedWindowsUpgradePlanner(input:SignedDirectoryUpgradeOptions,
 dashboard:{assessRestartSafety():Promise<RestartSafety>}){
 return input.image?.squirrel||input.squirrel?createSignedWindowsSquirrelUpgradePlanner(input,dashboard):
  createSignedWindowsDirectoryUpgradePlanner(input,dashboard);
}

/** Native exclusion covers every Squirrel version, its stable launcher and updater. */
export function maintenanceInstallationRoot(o:Pick<SignedDirectoryUpgradeOptions,'packageRoot'|'image'>):string{
 return o.image.squirrel?dirname(resolve(o.packageRoot)):o.packageRoot;
}
