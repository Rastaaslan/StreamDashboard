import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {MomentsPipeline} from '../../server/src/streamcockpit-moments.js';
import {migrateLegacyMomentsToSqlite} from '../../server/src/streamcockpit-moments-legacy-migration.js';
import {verifyUpgradeReadbackFiles,type UpgradeReadbackFile} from './streamcockpit-upgrade-readback.js';

/** An explicit, publisher-bound format conversion, not an arbitrary migration
 * callback. Only the canonical F09 converter may transform a detached copy.
 * The whole-profile schema and every other file, including uncertain F02/F05/F08
 * receipts, must remain unchanged. No startup/profile discovery or retry here. */
export interface MomentsUpgradeMigration {
  kind:'moments-json-to-sqlite-v1';
  directory:'root'|'config';
}
const failure=()=>new Error('SC3_UPGRADE_MOMENTS_MIGRATION_UNVERIFIED');
const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
export function momentsUpgradeMigration(value:unknown):MomentsUpgradeMigration {
  if(!value||typeof value!=='object'||Array.isArray(value)||
    Object.keys(value).sort().join(',')!=='directory,kind')throw failure();
  const item=value as MomentsUpgradeMigration;
  if(item.kind!=='moments-json-to-sqlite-v1'||!['root','config'].includes(item.directory))throw failure();
  return {kind:item.kind,directory:item.directory};
}
export function momentsUpgradePaths(value:MomentsUpgradeMigration){
  const migration=momentsUpgradeMigration(value),prefix=migration.directory==='config'?'config/':'';
  const legacy=prefix+'streamcockpit-moments.json',sqlite=prefix+'streamcockpit-moments.sqlite';
  return {legacy,sqlite,archive:legacy+'.pre-sqlite.json'};
}
const same=(a:UpgradeReadbackFile|undefined,b:UpgradeReadbackFile|undefined)=>
  Boolean(a&&b&&a.path===b.path&&a.bytes===b.bytes&&a.sha256===b.sha256);
function inventoryMap(files:UpgradeReadbackFile[]){
  if(!Array.isArray(files)||!files.length||files.length>2048)throw failure();
  const map=new Map<string,UpgradeReadbackFile>();
  for(const f of files){
    if(!f||typeof f.path!=='string'||map.has(f.path.toLowerCase())||
      !Number.isSafeInteger(f.bytes)||f.bytes<0||!(/^[a-f0-9]{64}$/).test(f.sha256))throw failure();
    map.set(f.path.toLowerCase(),f);
  }
  return map;
}
/** Exact permissible delta: one legacy JSON becomes its byte-identical archive
 * plus one new SQLite file. This never permits editing another journal/file. */
export function validateMomentsUpgradeInventories(before:UpgradeReadbackFile[],after:UpgradeReadbackFile[],
  migration:MomentsUpgradeMigration){
  const names=momentsUpgradePaths(migration),old=inventoryMap(before),next=inventoryMap(after);
  const source=old.get(names.legacy),archive=next.get(names.archive),sqlite=next.get(names.sqlite);
  if(!source||source.path!==names.legacy||source.bytes<1||source.bytes>16*1024*1024||
    old.has(names.sqlite)||old.has(names.archive)||next.has(names.legacy)||
    !archive||archive.path!==names.archive||archive.bytes!==source.bytes||archive.sha256!==source.sha256||
    !sqlite||sqlite.path!==names.sqlite||sqlite.bytes<1||sqlite.bytes>32*1024*1024||
    next.size!==old.size+1)throw failure();
  const forbidden=[names.legacy+'.writer.lock',names.legacy+'.lock',names.legacy+'-journal',
    names.sqlite+'-journal',names.sqlite+'-wal',names.sqlite+'-shm'];
  if(forbidden.some(path=>old.has(path)||next.has(path)))throw failure();
  for(const [path,file] of old)if(path!==names.legacy&&!same(file,next.get(path)))throw failure();
  for(const path of next.keys())if(path!==names.sqlite&&path!==names.archive&&!old.has(path))throw failure();
  return names;
}
async function exact(root:string,files:UpgradeReadbackFile[]){
  if(!await verifyUpgradeReadbackFiles(root,files))throw failure();
}
async function validatedLegacy(root:string,file:UpgradeReadbackFile){
  const bytes=await readFile(join(root,...file.path.split('/')));
  if(bytes.length!==file.bytes||sha(bytes)!==file.sha256)throw failure();
  const raw=bytes.toString('utf8');
  if(!Buffer.from(raw,'utf8').equals(bytes)||JSON.stringify(JSON.parse(raw))!==raw)throw failure();
  // Reuse F09 canonical envelope/schema/duplicate/uncertain-receipt validation.
  await new MomentsPipeline({read:async()=>raw,compareAndSwap:async()=>{throw failure()}}).listObservedSessions();
  return bytes;
}
/** Read-only semantic proof in addition to file hashes. A caller cannot bless
 * an empty/new journal just by declaring its hash as the target inventory. */
export async function verifyMomentsUpgrade(backupRoot:string,migratedRoot:string,
  before:UpgradeReadbackFile[],after:UpgradeReadbackFile[],migration:MomentsUpgradeMigration):Promise<void>{
  const names=validateMomentsUpgradeInventories(before,after,migration);
  await exact(backupRoot,before);await exact(migratedRoot,after);
  const source=before.find(f=>f.path===names.legacy)!;
  const bytes=await validatedLegacy(backupRoot,source);
  if(!(await readFile(join(migratedRoot,...names.archive.split('/')))).equals(bytes))throw failure();
  const db=new DatabaseSync(join(migratedRoot,...names.sqlite.split('/')),{readOnly:true});
  try{
    const mode=db.prepare('PRAGMA journal_mode').get() as {journal_mode:string};
    const check=db.prepare('PRAGMA integrity_check').all() as {integrity_check:string}[];
    const schema=db.prepare("SELECT name,type FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();
    const rows=db.prepare('SELECT id,payload FROM moments_journal').all() as {id:number;payload:string}[];
    if(mode.journal_mode!=='delete'||check.length!==1||check[0]!.integrity_check!=='ok'||
      JSON.stringify(schema)!==JSON.stringify([{name:'moments_journal',type:'table'}])||
      rows.length!==1||rows[0]!.id!==1||rows[0]!.payload!==bytes.toString('utf8'))throw failure();
  }finally{db.close()}
  await exact(backupRoot,before);await exact(migratedRoot,after);
}
/** Operate on an already-copied, verified preparation directory only. The
 * canonical converter keeps original JSON bytes as an archive and leaves any
 * incomplete conversion blocked. Its implementation is reused, never forked. */
export async function prepareMomentsUpgrade(backupRoot:string,preparedRoot:string,
  before:UpgradeReadbackFile[],after:UpgradeReadbackFile[],migration:MomentsUpgradeMigration):Promise<void>{
  const names=validateMomentsUpgradeInventories(before,after,migration);
  await exact(backupRoot,before);await exact(preparedRoot,before);
  const source=before.find(f=>f.path===names.legacy)!;
  await validatedLegacy(backupRoot,source);
  const result=await migrateLegacyMomentsToSqlite(join(preparedRoot,...names.sqlite.split('/')),
    join(preparedRoot,...names.legacy.split('/')));
  if(result.sha256!==source.sha256||result.bytes!==source.bytes||
    result.archive!==join(preparedRoot,...names.archive.split('/')))throw failure();
  await verifyMomentsUpgrade(backupRoot,preparedRoot,before,after,migration);
}
