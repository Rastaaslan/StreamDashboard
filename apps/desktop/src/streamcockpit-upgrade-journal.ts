import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash,randomUUID} from 'node:crypto';
import {closeSync,lstatSync,openSync,realpathSync,type Stats} from 'node:fs';
import {isAbsolute,join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {validateUpgradeManifest,type UpgradeJournal} from '../../../packages/core/src/streamcockpit-upgrade.js';

// The mutex and journal deliberately use DIFFERENT databases. Holding a lock
// transaction must not postpone COMMIT of the planner's write-ahead intent.
const LOCK_ID=0x5343554c,JOURNAL_ID=0x5343554a;
const IDENTITY_SQL='CREATE TABLE upgrade_identity (id INTEGER PRIMARY KEY CHECK(id=1), installation TEXT NOT NULL)';
const JOURNAL_SQL='CREATE TABLE upgrade_journal (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, payload TEXT NOT NULL, sha256 TEXT NOT NULL)';
const LIMIT=1024*1024;
const phases=['downloaded','staged','verified','deferred','installed','rolledBack'];
const operations=['stage','backup','migrate','install','rollback'];
const issue=(code:string)=>new Error('SC3_UPGRADE_STORE_'+code);
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const text=(value:unknown,max=4096):value is string=>typeof value==='string'&&
  value.trim().length>0&&value.length<=max&&!value.includes('\0');
const equalPath=(a:string,b:string)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
const keys=(value:object,required:string[],optional:string[]=[])=>
  required.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>required.includes(key)||optional.includes(key));

function decode(payload:string):UpgradeJournal{
  try{
    if(Buffer.byteLength(payload,'utf8')>LIMIT)throw issue('INVALID_JOURNAL');
    const j=JSON.parse(payload) as UpgradeJournal;
    if(!j||typeof j!=='object'||Array.isArray(j)||JSON.stringify(j)!==payload||
      !keys(j,['manifest','artifact','phase','events','installed','rolledBack'],['pending','staged','backup','migration'])||
      !text(j.artifact)||!phases.includes(j.phase)||typeof j.installed!=='boolean'||typeof j.rolledBack!=='boolean'||
      !Array.isArray(j.events)||!j.events.length||j.events.length>10_000)throw issue('INVALID_JOURNAL');
    validateUpgradeManifest(j.manifest);
    if(!keys(j.manifest,['id','version','fromVersion','source','sha256','signature','schema','target'])||
      !keys(j.manifest.signature,['keyId','value'])||!keys(j.manifest.schema,['from','to']))throw issue('INVALID_JOURNAL');
    for(const [i,event] of j.events.entries())if(!event||!keys(event,['sequence','phase','message'])||
      event.sequence!==i+1||!phases.includes(event.phase)||!text(event.message,1024))throw issue('INVALID_JOURNAL');
    if(j.events.at(-1)!.phase!==j.phase)throw issue('INVALID_JOURNAL');
    for(const name of ['staged','backup','migration'] as const)
      if(Object.hasOwn(j,name)&&!text(j[name]))throw issue('INVALID_JOURNAL');
    if(j.pending&&(!keys(j.pending,['operation','key'])||!operations.includes(j.pending.operation)||
      j.pending.key!==j.manifest.id+':'+j.pending.operation))throw issue('INVALID_JOURNAL');
    if(Object.hasOwn(j,'pending')&&!j.pending)throw issue('INVALID_JOURNAL');
    if((j.installed&&(!j.staged||!j.backup||!j.migration))||(j.rolledBack&&!j.backup)||
      (j.phase==='installed'&&!j.installed)||(j.phase==='rolledBack'&&!j.rolledBack))throw issue('INVALID_JOURNAL');
    return j;
  }catch{throw issue('INVALID_JOURNAL')}
}

function regular(file:string):Stats|undefined{
  try{
    const stat=lstatSync(file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>16*LIMIT||
      !equalPath(realpathSync(file),file))throw issue('PATH_UNAVAILABLE');
    return stat;
  }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw issue('PATH_UNAVAILABLE')}
}
function sameFile(file:string,before:Stats){
  const after=regular(file);
  if(!after||after.ino!==before.ino||after.dev!==before.dev)throw issue('OWNERSHIP_LOST');
}
function directory(root:string):Stats{
  const stat=lstatSync(root);
  if(!stat.isDirectory()||stat.isSymbolicLink()||!equalPath(realpathSync(root),root))throw issue('PATH_UNAVAILABLE');
  return stat;
}
function validateDatabase(db:DatabaseSync,id:number){
  const app=db.prepare('PRAGMA application_id').get() as {application_id?:number};
  const version=db.prepare('PRAGMA user_version').get() as {user_version?:number};
  const mode=db.prepare('PRAGMA journal_mode').get() as {journal_mode?:string};
  const schema=db.prepare("SELECT sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all() as {sql:string}[];
  const expected=id===LOCK_ID?[IDENTITY_SQL]:[IDENTITY_SQL,JOURNAL_SQL];
  if(app.application_id!==id||version.user_version!==1||mode.journal_mode!=='delete'||
    JSON.stringify(schema.map(row=>row.sql))!==JSON.stringify(expected))throw issue('FORMAT_UNAVAILABLE');
  const check=db.prepare('PRAGMA quick_check').get() as {quick_check?:string};
  if(check.quick_check!=='ok')throw issue('FORMAT_UNAVAILABLE');
  const rows=db.prepare('SELECT installation FROM upgrade_identity').all() as {installation:string}[];
  if(rows.length!==1||!/^[a-f0-9-]{36}$/.test(rows[0].installation))throw issue('FORMAT_UNAVAILABLE');
  return rows[0].installation;
}
function openDatabase(file:string,id:number,writable:boolean):{db:DatabaseSync;identity:string}{
  let db:DatabaseSync|undefined;
  try{
    if(!regular(file))throw issue('MISSING_JOURNAL');
    for(const suffix of ['-wal','-shm'])if(regular(file+suffix))throw issue('FORMAT_UNAVAILABLE');
    db=new DatabaseSync(file,{readOnly:!writable});
    db.exec('PRAGMA busy_timeout=0');
    const identity=validateDatabase(db,id);
    if(writable){
      db.exec('PRAGMA synchronous=EXTRA');
      if((db.prepare('PRAGMA synchronous').get() as {synchronous:number}).synchronous!==3)
        throw issue('SYNC_UNAVAILABLE');
    }
    return {db,identity};
  }catch{
    try{db?.close()}catch{/* never reuse an uncertain connection */}
    throw issue('DATABASE_UNAVAILABLE');
  }
}
function initialize(file:string,id:number,identity:string){
  // No overwrite, migration, stale-lock expiry or deletion of partial files.
  const fd=openSync(file,'wx',0o600);closeSync(fd);
  const db=new DatabaseSync(file);
  try{
    db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=EXTRA; PRAGMA busy_timeout=0; BEGIN IMMEDIATE');
    db.exec(IDENTITY_SQL);
    db.prepare('INSERT INTO upgrade_identity(id,installation) VALUES(1,?)').run(identity);
    if(id===JOURNAL_ID){
      db.exec(JOURNAL_SQL);
      // A virgin store is an explicit singleton, NOT a missing row. Losing
      // previously recorded history must never make registration look new.
      db.prepare('INSERT INTO upgrade_journal(id,revision,payload,sha256) VALUES(1,0,?,?)').run('null',hash('null'));
    }
    db.exec('PRAGMA application_id='+id+'; PRAGMA user_version=1; COMMIT');
  }catch{
    try{db.exec('ROLLBACK')}catch{/* incomplete initialization stays blocked */}
    throw issue('INITIALIZATION_UNCERTAIN');
  }finally{db.close()}
}

type Lease={active:boolean;poisoned:boolean;identity:string;rootStat:Stats;lockStat:Stats;journalStat:Stats};
/** Explicit filesystem adapter for UpgradePlanner. Never resolves a user profile,
 * starts an installer, controls OBS or pauses other durable service writers.
 * A SQLite OS lock excludes participating processes and disappears on process
 * exit; committed intents remain in the separate journal for read-only recovery.
 * Caller provisions one private directory shared by ALL updaters for an install,
 * OUTSIDE application-version directories and profile rollback snapshots. These
 * coordination files must never be restored to an earlier revision by rollback.
 * This cooperative lock does not stop unregistered producers or services; real
 * installer quiescence, receipt verification and power-loss tests remain separate.
 */
export class SqliteUpgradeJournal{
  private readonly root:string;
  private readonly lockFile:string;
  private readonly journalFile:string;
  private readonly context=new AsyncLocalStorage<Lease>();
  private busy=false;
  constructor(root:string){
    if(typeof root!=='string'||!isAbsolute(root)||root.includes('\0')||
      (process.platform==='win32'&&(!/^[A-Za-z]:[\\/]/.test(root)||root.slice(2).includes(':'))))
      throw issue('PATH_UNAVAILABLE');
    this.root=resolve(root);
    this.lockFile=join(this.root,'streamcockpit-upgrade-lock.sqlite');
    this.journalFile=join(this.root,'streamcockpit-upgrade-journal.sqlite');
  }
  private owned():Lease{
    const lease=this.context.getStore();
    if(!lease?.active||lease.poisoned)throw issue('EXCLUSIVE_REQUIRED');
    const root=directory(this.root);
    if(root.ino!==lease.rootStat.ino||root.dev!==lease.rootStat.dev)throw issue('OWNERSHIP_LOST');
    sameFile(this.lockFile,lease.lockStat);sameFile(this.journalFile,lease.journalStat);
    return lease;
  }
  async exclusive<T>(work:()=>Promise<T>):Promise<T>{
    if(this.busy)throw issue('BUSY');
    this.busy=true;
    let db:DatabaseSync|undefined,locked=false,lease:Lease|undefined;
    try{
      const rootStat=directory(this.root);
      const fresh=!regular(this.lockFile);
      if(fresh){
        if(regular(this.journalFile))throw issue('COORDINATOR_MISSING');
        initialize(this.lockFile,LOCK_ID,randomUUID());
      }
      const mutex=openDatabase(this.lockFile,LOCK_ID,true);db=mutex.db;
      try{db.exec('BEGIN IMMEDIATE');locked=true}catch{throw issue('BUSY')}
      if(fresh)initialize(this.journalFile,JOURNAL_ID,mutex.identity);
      const journal=openDatabase(this.journalFile,JOURNAL_ID,false);
      try{if(journal.identity!==mutex.identity)throw issue('IDENTITY_MISMATCH')}finally{journal.db.close()}
      lease={active:true,poisoned:false,identity:mutex.identity,rootStat,
        lockStat:regular(this.lockFile)!,journalStat:regular(this.journalFile)!};
      return await this.context.run(lease,async()=>{
        const result=await work();
        this.owned();
        return result;
      });
    }finally{
      if(lease)lease.active=false;
      try{if(locked)db!.exec('ROLLBACK')}finally{try{db?.close()}finally{this.busy=false}}
    }
  }
  private row(db:DatabaseSync):{revision:number;journal:UpgradeJournal}|undefined{
    const rows=db.prepare('SELECT id,revision,payload,sha256 FROM upgrade_journal').all() as
      {id:number;revision:number;payload:string;sha256:string}[];
    const row=rows[0];
    if(rows.length!==1||!row||row.id!==1||!Number.isSafeInteger(row.revision)||row.revision<0||
      typeof row.payload!=='string'||hash(row.payload)!==row.sha256)throw issue('INVALID_JOURNAL');
    if(row.revision===0){
      if(row.payload!=='null')throw issue('INVALID_JOURNAL');
      return undefined;
    }
    return {revision:row.revision,journal:decode(row.payload)};
  }
  async read():Promise<UpgradeJournal|undefined>{
    const lease=this.owned(),opened=openDatabase(this.journalFile,JOURNAL_ID,false);
    try{
      if(opened.identity!==lease.identity)throw issue('IDENTITY_MISMATCH');
      return this.row(opened.db)?.journal;
    }finally{opened.db.close()}
  }
  async write(value:UpgradeJournal):Promise<void>{
    const lease=this.owned();
    const journal=decode(JSON.stringify(value)),payload=JSON.stringify(journal);
    const opened=openDatabase(this.journalFile,JOURNAL_ID,true),db=opened.db;
    let transaction=false;
    try{
      if(opened.identity!==lease.identity)throw issue('IDENTITY_MISMATCH');
      db.exec('BEGIN IMMEDIATE');transaction=true;
      const previous=this.row(db);
      if(previous){
        const old=previous.journal;
        if(JSON.stringify(old.manifest)!==JSON.stringify(journal.manifest)||old.artifact!==journal.artifact||
          (old.installed&&!journal.installed)||(old.rolledBack&&!journal.rolledBack)||
          old.events.some((event,i)=>JSON.stringify(event)!==JSON.stringify(journal.events[i]))||
          (['staged','backup','migration']as const).some(key=>old[key]!==undefined&&old[key]!==journal[key]))
          throw issue('HISTORY_REWRITE_DENIED');
      }else if(journal.phase!=='downloaded'||journal.events.length!==1||journal.pending||journal.installed||
        journal.rolledBack||journal.staged||journal.backup||journal.migration)throw issue('INITIAL_STATE_INVALID');
      const revision=(previous?.revision??0)+1;
      if(!Number.isSafeInteger(revision))throw issue('REVISION_EXHAUSTED');
      db.prepare('INSERT INTO upgrade_journal(id,revision,payload,sha256) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,sha256=excluded.sha256')
        .run(revision,payload,hash(payload));
      db.exec('COMMIT');transaction=false;
      const confirmed=this.row(db);
      if(confirmed?.revision!==revision||JSON.stringify(confirmed.journal)!==payload)throw issue('WRITE_UNCERTAIN');
      this.owned();
    }catch(error){
      lease.poisoned=true;
      if(transaction){try{db.exec('ROLLBACK')}catch{/* commit outcome unknown: no more effects */}}
      if(error instanceof Error&&error.message.startsWith('SC3_UPGRADE_STORE_'))throw error;
      throw issue('WRITE_UNCERTAIN');
    }finally{db.close()}
  }
}
