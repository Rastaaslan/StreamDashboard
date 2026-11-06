import {constants} from 'node:fs';
import {copyFile,lstat,mkdir,open,realpath,rename} from 'node:fs/promises';
import {basename,dirname,isAbsolute,join,resolve,sep} from 'node:path';
import {createDurableDesktopUpgradePlanner} from './streamcockpit-upgrade.js';
import {createUpgradeReadbackReconciler,verifyUpgradeReadbackFiles,
  type UpgradeReadbackExpectation,type UpgradeReadbackIdentity,type UpgradeReadbackFile} from './streamcockpit-upgrade-readback.js';
import type {RestartSafety} from './restart-safety.js';
import {validateUpgradeManifest,type UpgradeAdapters,type UpgradeJournal,type UpgradeManifest} from '../../../packages/core/src/streamcockpit-upgrade.js';

type ApplyOperation='install'|'rollback';
type Preparation=Pick<UpgradeAdapters,'stage'|'verify'|'backup'|'migrate'>;
export interface DirectoryUpgradeOptions {
  manifest:UpgradeManifest;
  journalDirectory:string;
  packageRoot:string;profileRoot:string;
  preparedPackage:string;preparedProfile:string;
  backupPackage:string;backupProfile:string;
  target:UpgradeReadbackExpectation;rollback:UpgradeReadbackExpectation;
  /** Caller must hold the real runtime/service exclusion, including other processes.
   * A stopped HTTP listener or the upgrade-journal mutex alone is NOT sufficient. */
  runtimeStopped:()=>Promise<boolean>;
  /** Independent signer/version attestation for packageRoot; never a self-reported JSON. */
  attestInstalled:()=>Promise<UpgradeReadbackIdentity|undefined>;
  now?:()=>number;
}
const failure=(code:string)=>new Error('SC3_DIRECTORY_UPGRADE_'+code);
const comparable=(value:string)=>value.toLowerCase();
function root(value:string):string{
  if(typeof value!=='string'||!isAbsolute(value)||! /^[A-Za-z]:[\\/]/.test(value)||
    value.slice(2).includes(':')||value.includes('\0'))throw failure('ROOT_INVALID');
  const result=resolve(value);
  if(dirname(result)===result||/[. ]$/.test(result))throw failure('ROOT_INVALID');
  return result;
}
const overlaps=(a:string,b:string)=>comparable(a)===comparable(b)||
  comparable(a).startsWith(comparable(b)+sep)||comparable(b).startsWith(comparable(a)+sep);
async function directory(value:string){
  const stat=await lstat(value);
  if(!stat.isDirectory()||stat.isSymbolicLink()||comparable(await realpath(value))!==comparable(value))
    throw failure('ROOT_UNTRUSTED');
  return stat;
}
async function absent(value:string){
  try{await lstat(value)}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error}
  throw failure('RECOVERY_FILES_EXIST');
}
function safeEntry(name:string){
  if(typeof name!=='string'||name.length>512||/[\\:\x00-\x1f]/.test(name)||isAbsolute(name)||
    name.split('/').some(part=>!part||part==='.'||part==='..'||/[. ]$/.test(part)||
      /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part)))throw failure('ENTRY_INVALID');
}
function preserveDurableJournals(before:UpgradeReadbackFile[],after:UpgradeReadbackFile[]){
  const names=['streamcockpit-automod-action-intents.sqlite','streamcockpit-prediction-intents.sqlite','streamcockpit-moments.sqlite'];
  const journalEntries=(files:UpgradeReadbackFile[])=>{
    for(const file of files){
      const name=file.path.split('/').at(-1)!.toLowerCase();
      if(names.some(base=>['-wal','-shm','-journal'].some(suffix=>name===base+suffix)))
        throw failure('DURABLE_JOURNAL_TRANSFORM_UNQUALIFIED');
    }
    return files.filter(file=>names.includes(file.path.split('/').at(-1)!.toLowerCase()))
      .map(({path,bytes,sha256})=>({path,bytes,sha256})).sort((a,b)=>a.path.localeCompare(b.path));
  };
  // This directory adapter cannot infer whether a journal-format migration or
  // a missing receipt is safe. Preserve exact fences; use a separately reviewed
  // migration path for transformations, never silently approve an empty ledger.
  if(JSON.stringify(journalEntries(before))!==JSON.stringify(journalEntries(after)))
    throw failure('DURABLE_JOURNAL_TRANSFORM_UNQUALIFIED');
}
async function exact(folder:string,files:UpgradeReadbackFile[]){
  if(!await verifyUpgradeReadbackFiles(folder,files))throw failure('INVENTORY_CHANGED');
}
async function detachedCopy(source:string,destination:string,files:UpgradeReadbackFile[]){
  await exact(source,files);
  await directory(dirname(destination));await absent(destination);
  await mkdir(destination,{mode:0o700});
  for(const entry of files){
    safeEntry(entry.path);
    const from=join(source,...entry.path.split('/')),to=join(destination,...entry.path.split('/'));
    await mkdir(dirname(to),{recursive:true,mode:0o700});
    await directory(dirname(to));
    const stat=await lstat(from);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)throw failure('SOURCE_UNTRUSTED');
    await copyFile(from,to,constants.COPYFILE_EXCL);
    const handle=await open(to,'r+');try{await handle.sync()}finally{await handle.close()}
  }
  // Both the source snapshot and the candidate must still match pinned bytes.
  await exact(source,files);await exact(destination,files);
}

/** Concrete filesystem install/rollback for an explicitly provisioned, stopped
 * Windows directory deployment. It does NOT replace Squirrel's registration,
 * services, shortcuts or Android PackageInstaller and is NOT enabled by updater.
 *
 * Callers provide independently verified release preparation, complete immutable
 * backup inventories and real service exclusion. Construction performs no I/O.
 * Each operation keeps one previous app/data tree by rename, never overwrites or
 * deletes it. Two tree swaps are NOT atomic together: a partial apply retains
 * the durable pending intent and requires supervised recovery, never a retry.
 */
export function createWindowsDirectoryUpgradePlanner(input:DirectoryUpgradeOptions,
  preparation:Preparation,dashboard:{assessRestartSafety():Promise<RestartSafety>}){
  if(process.platform!=='win32')throw failure('WINDOWS_REQUIRED');
  const {runtimeStopped,attestInstalled,now}=input;
  if(typeof runtimeStopped!=='function'||typeof attestInstalled!=='function')throw failure('AUTHORITY_REQUIRED');
  const manifest=structuredClone(input.manifest),target=structuredClone(input.target),rollback=structuredClone(input.rollback);
  validateUpgradeManifest(manifest);
  if(!['desktop','agent'].includes(manifest.target))throw failure('WINDOWS_REQUIRED');
  const roots={journalDirectory:root(input.journalDirectory),packageRoot:root(input.packageRoot),profileRoot:root(input.profileRoot),
    preparedPackage:root(input.preparedPackage),preparedProfile:root(input.preparedProfile),
    backupPackage:root(input.backupPackage),backupProfile:root(input.backupProfile)};
  const values=Object.values(roots);
  for(let i=0;i<values.length;i++)for(let j=i+1;j<values.length;j++)
    if(overlaps(values[i]!,values[j]!))throw failure('ROOTS_OVERLAP');
  for(const expected of [target,rollback])for(const entries of [expected.packageFiles,expected.profileFiles])
    for(const file of entries)safeEntry(file.path);
  const readback=createUpgradeReadbackReconciler({manifest,target,rollback,
    packageRoot:roots.packageRoot,profileRoot:roots.profileRoot,attestInstalled,now});
  preserveDurableJournals(rollback.profileFiles,target.profileFiles);
  const requireStopped=async()=>{
    if(await runtimeStopped()!==true)throw failure('RUNTIME_NOT_STOPPED');
  };
  const requireManifest=(value:UpgradeManifest)=>{
    if(JSON.stringify(value)!==JSON.stringify(manifest))throw failure('CONTRACT_CHANGED');
  };
  const paths=(operation:ApplyOperation)=>[roots.packageRoot,roots.profileRoot].map(active=>({
    active,candidate:join(dirname(active),'.'+basename(active)+'.sc3-'+manifest.id+'-'+operation+'-candidate'),
    previous:join(dirname(active),'.'+basename(active)+'.sc3-'+manifest.id+'-'+operation+'-previous'),
  }));
  // Generated recovery locations must not alias any explicit source or journal.
  const generated=(['install','rollback']as const).flatMap(operation=>paths(operation).flatMap(p=>[p.candidate,p.previous]));
  for(let i=0;i<generated.length;i++){
    for(const value of values)if(overlaps(generated[i]!,value))throw failure('RECOVERY_PATH_OVERLAP');
    for(let j=i+1;j<generated.length;j++)if(overlaps(generated[i]!,generated[j]!))throw failure('RECOVERY_PATH_OVERLAP');
  }
  const apply=async(operation:ApplyOperation,journal:UpgradeJournal,key:string)=>{
    requireManifest(journal.manifest);
    if(key!==manifest.id+':'+operation||journal.pending?.operation!==operation||journal.pending.key!==key||
      journal.staged!==roots.preparedPackage||journal.migration!==roots.preparedProfile||
      journal.backup!==roots.backupPackage||journal.rolledBack||
      (operation==='install'&&journal.installed)||(operation==='rollback'&&!journal.installed))
      throw failure('INTENT_OR_RECEIPTS_MISMATCH');
    await requireStopped();
    // The source is a PINNED full snapshot, not a hash of whatever happens to exist.
    const current=operation==='install'?rollback:target,next=operation==='install'?target:rollback;
    const sources=operation==='install'?[roots.preparedPackage,roots.preparedProfile]:[roots.backupPackage,roots.backupProfile];
    const plans=paths(operation),entries=[next.packageFiles,next.profileFiles];
    const initial=await Promise.all(plans.map(p=>directory(p.active)));
    await exact(roots.packageRoot,current.packageFiles);await exact(roots.profileRoot,current.profileFiles);
    // Original immutable backups must still exist for either direction.
    await exact(roots.backupPackage,rollback.packageFiles);await exact(roots.backupProfile,rollback.profileFiles);
    for(const p of plans){await absent(p.candidate);await absent(p.previous)}
    for(let i=0;i<plans.length;i++)await detachedCopy(sources[i]!,plans[i]!.candidate,entries[i]!);
    await requireStopped();
    await exact(roots.packageRoot,current.packageFiles);await exact(roots.profileRoot,current.profileFiles);
    for(let i=0;i<plans.length;i++){
      const p=plans[i]!,stat=await directory(p.active),before=initial[i]!;
      if(stat.dev!==before.dev||stat.ino!==before.ino)throw failure('ACTIVE_ROOT_CHANGED');
      await requireStopped();await absent(p.previous);
      await rename(p.active,p.previous);
      // Never roll back automatically if a rename/acknowledgement is uncertain.
      await requireStopped();await absent(p.active);
      await rename(p.candidate,p.active);
    }
    await requireStopped();
    const receipt=await readback(operation,key);
    if(!receipt)throw failure('APPLIED_RESULT_UNCONFIRMED');
    return receipt;
  };
  return createDurableDesktopUpgradePlanner(roots.journalDirectory,{
    stage:async(value,artifact,key)=>{requireManifest(value);return preparation.stage(value,artifact,key)},
    verify:async(value,staged)=>{requireManifest(value);return staged===roots.preparedPackage&&await preparation.verify(value,staged)===true},
    backup:async(value,key)=>{requireManifest(value);return preparation.backup(value,key)},
    migrate:async(value,backup,key)=>{requireManifest(value);return preparation.migrate(value,backup,key)},
    install:(journal,key)=>apply('install',journal,key),rollback:(journal,key)=>apply('rollback',journal,key),
    reconcile:async(operation,key)=>{
      // Lost acknowledgement: observe only. A partial tree is never replayable.
      try{await requireStopped();return await readback(operation,key)}catch{return undefined}
    },
  },dashboard);
}
