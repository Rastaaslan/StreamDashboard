import {createHash,randomUUID} from 'node:crypto';
import {copyFile,lstat,mkdir,open,readFile,readdir,realpath,rename,rm,writeFile} from 'node:fs/promises';
import {basename,dirname,isAbsolute,join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {migrateUpgradeData,type UpgradeData,type UpgradeMigration} from '../../../packages/core/src/streamcockpit-upgrade.js';
import {assertLegacyMomentsInventory,verifyActiveLegacyMoments,convertLegacyMomentsInPending,
  LEGACY_MOMENTS,SQLITE_MOMENTS,ARCHIVED_LEGACY_MOMENTS} from './streamcockpit-moments-legacy-qa.js';

/** F10 filesystem QA evidence. NEVER a production installer or a profile restore.
 * The caller must create a fresh DIRECT child of OS temp named sc3-upgrade-qa-*.
 * No executable, configuration or user data outside this sandbox is modified.
 * Windows NTFS power-loss directory durability and installer replacement remain untested.
 */
const limitFiles=1000,limitBytes=64*1024*1024;
type Entry={path:string;bytes:number;sha256:string};
export interface QaCheckpointReport {
  schemaVersion:1;kind:'SC3_UPGRADE_QA_CHECKPOINT';source:'active';
  entries:Entry[];totalBytes:number;createdAt:string;
}
const hash=(buffer:Buffer)=>createHash('sha256').update(buffer).digest('hex');
const fail=(what:string):never=>{throw new Error('QA_CHECKPOINT_'+what)};
const checkedRelative=(value:string)=>{
  if(!value||value.includes('\0')||isAbsolute(value)||
    value.split('/').some(part=>!part||part==='.'||part==='..'||part.includes('\\')||part.includes(':')))
    fail('UNSAFE_ENTRY');
  return value;
};
async function sandbox(value:string) {
  const root=resolve(value),temp=resolve(tmpdir());
  if(dirname(root)!==temp||!basename(root).startsWith('sc3-upgrade-qa-')||
    basename(root).length>120)fail('NOT_ISOLATED_TEMP_WORKSPACE');
  const status=await lstat(root);
  if(!status.isDirectory()||status.isSymbolicLink()||await realpath(root)!==root)
    fail('UNTRUSTED_WORKSPACE');
  return root;
}
async function list(root:string):Promise<{files:Entry[];totalBytes:number}> {
  const files:Entry[]=[];
  let totalBytes=0;
  const visit=async(current:string,part:string):Promise<void>=>{
    const status=await lstat(current);
    if(status.isSymbolicLink())fail('SYMLINK_FORBIDDEN');
    if(status.isDirectory()){
      for(const name of (await readdir(current)).sort()){
        if(name==='.'||name==='..'||name.includes('/')||name.includes('\\')||name.includes(':'))fail('UNSAFE_ENTRY');
        await visit(join(current,name),part?part+'/'+name:name);
      }
    }else if(status.isFile()){
      if(files.length>=limitFiles||status.size>limitBytes||totalBytes+status.size>limitBytes)
        fail('SIZE_LIMIT');
      const bytes=await readFile(current);
      if(bytes.length!==status.size)fail('SOURCE_CHANGED');
      files.push({path:checkedRelative(part),bytes:bytes.length,sha256:hash(bytes)});
      totalBytes+=bytes.length;
    }else fail('NON_REGULAR_FILE');
  };
  await visit(root,'');
  if(!files.length)fail('NO_FILES');
  return {files:files.sort((a,b)=>a.path.localeCompare(b.path)),totalBytes};
}
async function copyVerified(from:string,to:string,entries:Entry[]){
  for(const entry of entries) {
    const rel=checkedRelative(entry.path);
    const source=join(from,...rel.split('/')),dest=join(to,...rel.split('/'));
    const stat=await lstat(source);
    if(!stat.isFile()||stat.isSymbolicLink())fail('SYMLINK_FORBIDDEN');
    await mkdir(dirname(dest),{recursive:true,mode:0o700});
    await copyFile(source,dest);
    const output=await readFile(dest);
    if(output.length!==entry.bytes||hash(output)!==entry.sha256)fail('COPY_MISMATCH');
    const handle=await open(dest,'r+');
    try{await handle.sync()}finally{await handle.close()}
  }
}
/** Immutable checkpoint in workspace/backup, with source reread after copy. */
export async function checkpointQaProfile(workspace:string):Promise<QaCheckpointReport>{
  const root=await sandbox(workspace);
  const source=join(root,'active'),destination=join(root,'backup');
  const sourceStatus=await lstat(source);
  if(!sourceStatus.isDirectory()||sourceStatus.isSymbolicLink())fail('SOURCE_NOT_DIRECTORY');
  try{await lstat(destination);fail('BACKUP_ALREADY_EXISTS')}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
  const before=await list(source);
  const stage=join(root,'backup-pending-'+randomUUID());
  await mkdir(stage,{mode:0o700});
  try{
    const files=join(stage,'files');
    await mkdir(files,{mode:0o700});
    await copyVerified(source,files,before.files);
    const after=await list(source);
    if(JSON.stringify(before)!==JSON.stringify(after))fail('SOURCE_CHANGED');
    const report:QaCheckpointReport={schemaVersion:1,kind:'SC3_UPGRADE_QA_CHECKPOINT',
      source:'active',entries:before.files,totalBytes:before.totalBytes,createdAt:new Date().toISOString()};
    const manifest=join(stage,'manifest.json');
    await writeFile(manifest,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
    const handle=await open(manifest,'r+');
    try{await handle.sync()}finally{await handle.close()}
    await rename(stage,destination);
    return structuredClone(report);
  }catch(error){await rm(stage,{recursive:true,force:true});throw error}
}
/** Verify a complete immutable snapshot before any restore or migration copy. */
async function verifiedBackup(root:string):Promise<{report:QaCheckpointReport;folder:string}>{
  const backup=join(root,'backup');
  const status=await lstat(backup);
  if(!status.isDirectory()||status.isSymbolicLink())fail('BACKUP_UNTRUSTED');
  const report=JSON.parse(await readFile(join(backup,'manifest.json'),'utf8')) as QaCheckpointReport;
  if(report.schemaVersion!==1||report.kind!=='SC3_UPGRADE_QA_CHECKPOINT'||report.source!=='active'||
    !Array.isArray(report.entries)||!report.entries.length||report.entries.length>limitFiles||
    !Number.isSafeInteger(report.totalBytes)||report.totalBytes<0||report.totalBytes>limitBytes)
    fail('MANIFEST_INVALID');
  const paths=new Set<string>();let summed=0;
  for(const entry of report.entries){
    if(!entry||typeof entry.path!=='string'||typeof entry.sha256!=='string'||!/^[a-f0-9]{64}$/.test(entry.sha256)||
      !Number.isSafeInteger(entry.bytes)||entry.bytes<0||paths.has(entry.path))fail('MANIFEST_INVALID');
    checkedRelative(entry.path);paths.add(entry.path);summed+=entry.bytes;
  }
  if(summed!==report.totalBytes)fail('MANIFEST_INVALID');
  const folder=join(backup,'files');
  const actual=await list(folder);
  if(JSON.stringify(actual.files)!==JSON.stringify(report.entries)||actual.totalBytes!==report.totalBytes)
    fail('BACKUP_TAMPERED');
  return {report,folder};
}
// F02/F08 one-way Twitch intents and F09 receipts must never be rolled back
// to an older SQLite snapshot. These are the three canonical FIXE dataDir
// journals, not arbitrary user filenames. Comparison is QA only: a production
// installer still needs an exclusive writer pause and durable rollback ledger.
const DURABLE_JOURNALS=[
  {name:'streamcockpit-automod-action-intents.sqlite',failure:'AUTOMOD_FENCE_CHANGED'},
  {name:'streamcockpit-prediction-intents.sqlite',failure:'PREDICTION_FENCE_CHANGED'},
  {name:'streamcockpit-moments.sqlite',failure:'MOMENTS_JOURNAL_CHANGED'},
] as const;
async function requireCurrentDurableJournals(root:string,report:QaCheckpointReport){
  const liveRoot=join(root,'active');
  try{
    const directory=await lstat(liveRoot);
    if(!directory.isDirectory()||directory.isSymbolicLink()||await realpath(liveRoot)!==liveRoot)
      fail('DURABLE_JOURNAL_UNAVAILABLE');
  }catch{fail('DURABLE_JOURNAL_UNAVAILABLE')}
  for(const journal of DURABLE_JOURNALS){
    const file=join(liveRoot,journal.name);
    const expected=report.entries.find(entry=>entry.path===journal.name);
    // Standalone SQLite main-file copies are unsafe when an unfinished or WAL
    // transaction may hold newer rows. Refuse any live or backed-up sidecar.
    for(const suffix of ['-journal','-wal','-shm']){
      const sidecar=journal.name+suffix;
      if(report.entries.some(entry=>entry.path===sidecar))fail('DURABLE_SIDECAR_PRESENT');
      try{await lstat(join(liveRoot,sidecar));fail('DURABLE_SIDECAR_PRESENT')}
      catch(error){
        if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
      }
    }
    let before:Awaited<ReturnType<typeof lstat>>|undefined;
    try{before=await lstat(file)}
    catch(error){
      if((error as NodeJS.ErrnoException).code!=='ENOENT')fail(journal.failure);
    }
    if(!before){
      if(expected)fail(journal.failure);
      continue;
    }
    if(expected===undefined)throw new Error('QA_CHECKPOINT_'+journal.failure);
    if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||
      before.size>limitBytes)fail(journal.failure);
    try{
      const bytes=await readFile(file),after=await lstat(file);
      if(!after.isFile()||after.isSymbolicLink()||after.nlink!==1||
        after.ino!==before.ino||after.mtimeMs!==before.mtimeMs||
        after.size!==before.size||bytes.length!==expected.bytes||
        hash(bytes)!==expected.sha256)fail(journal.failure);
    }catch{fail(journal.failure)}
  }
}

/** Restore immutable checkpoint ONLY to a new workspace/restored directory.
 * Never replace active or existing data; verify every backed-up byte first.
 */
export async function restoreQaProfile(workspace:string):Promise<QaCheckpointReport>{
  const root=await sandbox(workspace),restored=join(root,'restored');
  try{await lstat(restored);fail('RESTORE_ALREADY_EXISTS')}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
  const {report,folder}=await verifiedBackup(root);
  await requireCurrentDurableJournals(root,report);
  const pending=join(root,'restored-pending-'+randomUUID());
  await mkdir(pending,{mode:0o700});
  try{
    await copyVerified(folder,pending,report.entries);
    const verified=await list(pending);
    if(JSON.stringify(verified.files)!==JSON.stringify(report.entries))fail('RESTORE_MISMATCH');
    await requireCurrentDurableJournals(root,report);
    await rename(pending,restored);
    return structuredClone(report);
  }catch(error){await rm(pending,{recursive:true,force:true});throw error}
}

/** QA-only end-to-end backup -> detached versioned migration. No installer, no
 * writes to active/restored profiles. The caller owns the synthetic workspace.
 * Reuses the same complete hash-verified backup as explicit QA rollback.
 */
export async function migrateQaProfileCopy(workspace:string,toVersion:number,migrations:UpgradeMigration[],
  options:{migrateLegacyMoments?:true}={}){
  const root=await sandbox(workspace),destination=join(root,'migrated');
  try{await lstat(destination);fail('MIGRATED_ALREADY_EXISTS')}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
  const {report,folder}=await verifiedBackup(root);
  await requireCurrentDurableJournals(root,report);
  // This is explicit opt-in, never a side effect of an ordinary settings migration.
  // The active legacy journal MUST still match the immutable backed-up revision.
  const legacy=options.migrateLegacyMoments===true?assertLegacyMomentsInventory(report.entries):undefined;
  if(legacy)await verifyActiveLegacyMoments(root,legacy);
  const setting='configuration/settings.json';
  if(!report.entries.some(entry=>entry.path===setting))fail('SETTINGS_NOT_IN_BACKUP');
  const pending=join(root,'migrated-pending-'+randomUUID());
  await mkdir(pending,{mode:0o700});
  try{
    await copyVerified(folder,pending,report.entries);
    const settingsPath=join(pending,'configuration','settings.json');
    const data=JSON.parse(await readFile(settingsPath,'utf8')) as UpgradeData;
    const fromVersion=data.schemaVersion;
    const updated=migrateUpgradeData(data,toVersion,migrations);
    const output=Buffer.from(JSON.stringify(updated),'utf8');
    const temp=settingsPath+'.new';
    await writeFile(temp,output,{flag:'wx',mode:0o600});
    const handle=await open(temp,'r+');
    try{await handle.sync()}finally{await handle.close()}
    await rename(temp,settingsPath);
    const legacyMoments=legacy?await convertLegacyMomentsInPending(pending,legacy):undefined;
    const actual=await list(pending),earlier=new Map(report.entries.map(entry=>[entry.path,entry]));
    // Legacy->SQLite adds exactly one explicit archived JSON sidecar inside
    // the detached migrated profile. The backup and restored original are intact.
    if(actual.files.length!==report.entries.length+(legacyMoments?1:0))
      fail('MIGRATED_FILE_SET_CHANGED');
    for(const entry of actual.files){
      const original=earlier.get(entry.path);
      if(entry.path===SQLITE_MOMENTS&&legacyMoments){
        if(original||entry.sha256!==legacyMoments.sqliteSha256)fail('MIGRATED_DATA_CHANGED');
      }else if(entry.path===ARCHIVED_LEGACY_MOMENTS&&legacyMoments){
        if(original||!legacy||entry.bytes!==legacy.bytes||entry.sha256!==legacy.sha256)
          fail('MIGRATED_DATA_CHANGED');
      }else if(!original||(entry.path!==setting &&
        (entry.bytes!==original.bytes||entry.sha256!==original.sha256))){
        fail('MIGRATED_DATA_CHANGED');
      }
    }
    if(legacyMoments&&(actual.files.some(entry=>entry.path===LEGACY_MOMENTS)||
      !actual.files.some(entry=>entry.path===SQLITE_MOMENTS)||
      !actual.files.some(entry=>entry.path===ARCHIVED_LEGACY_MOMENTS)))
      fail('MIGRATED_FILE_SET_CHANGED');
    const migrated=actual.files.find(entry=>entry.path===setting)!;
    if(migrated.sha256!==hash(output))fail('MIGRATED_VERIFY_FAILED');
    await requireCurrentDurableJournals(root,report);
    if(legacy)await verifyActiveLegacyMoments(root,legacy);
    await rename(pending,destination);
    return {schemaVersion:1 as const,kind:'SC3_UPGRADE_QA_MIGRATION' as const,
      fromVersion,toVersion,oldHash:earlier.get(setting)!.sha256,newHash:migrated.sha256,
      ...(legacyMoments?{legacyMoments}: {})};
  }catch(error){await rm(pending,{recursive:true,force:true});throw error}
}
