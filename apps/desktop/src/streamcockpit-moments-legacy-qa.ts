import {createHash} from 'node:crypto';
import {lstat,readFile,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {MomentsPipeline} from '../../server/src/streamcockpit-moments.js';
import {MomentsSqliteStorage} from '../../server/src/streamcockpit-moments-sqlite.js';
import {migrateLegacyMomentsToSqlite} from '../../server/src/streamcockpit-moments-legacy-migration.js';

/** F09 -> F10 detached opt-in Windows QA. Reuses the existing F09 canonical
 * EXCLUSIVE legacy converter; no fork of its checksummed JSON/SQLite contract.
 * Only a verified sc3-upgrade-qa-* temporary workspace is permitted upstream.
 */
export const LEGACY_MOMENTS='streamcockpit-moments.json';
export const SQLITE_MOMENTS='streamcockpit-moments.sqlite';
export const ARCHIVED_LEGACY_MOMENTS=LEGACY_MOMENTS+'.pre-sqlite.json';
type InventoryEntry={path:string;bytes:number;sha256:string};
export interface LegacyMomentsQaEvidence{
  sourceSha256:string;sqliteSha256:string;requestCount:number;sessionCount:number;
}
const sha256=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const fail=(code:string):never=>{throw Error('QA_CHECKPOINT_'+code)};
const conflictNames=[
  SQLITE_MOMENTS,SQLITE_MOMENTS+'-journal',SQLITE_MOMENTS+'-wal',SQLITE_MOMENTS+'-shm',
  ARCHIVED_LEGACY_MOMENTS,
  LEGACY_MOMENTS+'.writer.lock',LEGACY_MOMENTS+'.lock',LEGACY_MOMENTS+'-journal',
];
export function assertLegacyMomentsInventory(entries:readonly InventoryEntry[]):InventoryEntry{
  const legacy=entries.find(entry=>entry.path===LEGACY_MOMENTS);
  if(!legacy)return fail('MOMENTS_LEGACY_NOT_IN_BACKUP');
  if(conflictNames.some(name=>entries.some(entry=>entry.path===name)))fail('MOMENTS_LEGACY_CONFLICT');
  return legacy;
}

/** Detect a changed, replaced, removed, linked, locked or unreadable active
 * legacy file. This is NOT an inter-process writer lock; the real installer
 * still requires full shutdown/quiescence and transaction-level ownership.
 */
export async function verifyActiveLegacyMoments(root:string,expected:InventoryEntry){
  const file=join(root,'active',LEGACY_MOMENTS);
  for(const name of conflictNames){
    try{await lstat(join(root,'active',name));fail('MOMENTS_LEGACY_CONFLICT')}
    catch(error){
      if((error as NodeJS.ErrnoException).code!=='ENOENT')fail('MOMENTS_LEGACY_CONFLICT');
    }
  }
  try{
    const before=await lstat(file);
    if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||
      before.size!==expected.bytes)fail('MOMENTS_LEGACY_SOURCE_CHANGED');
    if((await realpath(file)).toLowerCase()!==file.toLowerCase())
      fail('MOMENTS_LEGACY_SOURCE_CHANGED');
    const bytes=await readFile(file),after=await lstat(file);
    if(after.ino!==before.ino||after.size!==before.size||
      after.mtimeMs!==before.mtimeMs||bytes.length!==expected.bytes||
      sha256(bytes)!==expected.sha256)fail('MOMENTS_LEGACY_SOURCE_CHANGED');
  }catch{fail('MOMENTS_LEGACY_SOURCE_CHANGED')}
}

/** Convert only verified copied bytes. Canonical F09 converter validates full
 * payload, claims the writer lock and SQLite target exclusively, archives old
 * bytes, verifies SQLite integrity and releases only on successful promotion.
 */
export async function convertLegacyMomentsInPending(
  pending:string,expected:InventoryEntry,
):Promise<LegacyMomentsQaEvidence>{
  const legacy=join(pending,LEGACY_MOMENTS),bytes=await readFile(legacy);
  if(bytes.length!==expected.bytes||sha256(bytes)!==expected.sha256)
    fail('MOMENTS_LEGACY_COPY_CHANGED');
  const sqlite=join(pending,SQLITE_MOMENTS);
  // Only the canonical one-way converter is authorized to create F09 SQLite.
  const result=await migrateLegacyMomentsToSqlite(sqlite,legacy);
  if(result.archive!==join(pending,ARCHIVED_LEGACY_MOMENTS)||
    result.sha256!==expected.sha256||result.bytes!==expected.bytes)
    fail('MOMENTS_LEGACY_ARCHIVE_MISMATCH');
  if(!(await readFile(result.archive)).equals(bytes))fail('MOMENTS_LEGACY_ARCHIVE_MISMATCH');
  const store=new MomentsSqliteStorage(sqlite);
  if(await store.read()!==bytes.toString('utf8'))fail('MOMENTS_LEGACY_SQLITE_MISMATCH');
  const sessions=await new MomentsPipeline(store).listObservedSessions();
  if(!sessions)fail('MOMENTS_LEGACY_SQLITE_MISMATCH');
  const payload=JSON.parse(JSON.parse(bytes.toString('utf8')).payload) as {requests:unknown[]};
  // Canonical validation was performed by F09; count the same validated input.
  const requestCount=payload.requests.length,sessionCount=sessions?.length??0;
  if(requestCount>10000)fail('MOMENTS_LEGACY_TOO_MANY_REQUESTS');
  const sqliteSha256=sha256(await readFile(sqlite));
  return {sourceSha256:expected.sha256,sqliteSha256,requestCount,sessionCount};
}
