import {lstatSync, realpathSync} from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import type {AgentReceipt} from '../../../packages/contracts/src/agent-v2.js';

// The Agent on Windows cannot fsync() a directory after renaming its JSON
// journal. SQLite's Windows VFS with rollback journal + synchronous EXTRA is
// the only writer supported by this adapter. Never import a legacy JSON file
// implicitly: it may contain an unresolved OBS command.
const applicationId=0x53433341; // "SC3A" — Agent V2 command journal.
const revisionBlock=1_000_000;
const maxRecords=100_000;
const validId=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,96}$/.test(v);
const outcomes=new Set(['accepted','executed','confirmed','uncertain','refused']);
type ReceiptRow={command_id:unknown;result:unknown;observed_at:unknown;reason:unknown};

function existsStrict(file:string):boolean {
  try {lstatSync(file);return true}
  catch(error) {
    if((error as NodeJS.ErrnoException).code==='ENOENT')return false;
    throw Error('WINDOWS_RECEIPTS_PATH_UNAVAILABLE');
  }
}
function assertReceipt(value:AgentReceipt):void {
  if(!value||!validId(value.commandId)||!outcomes.has(value.result)||
    !Number.isFinite(value.observedAt)||
    (value.reason!==undefined&&(typeof value.reason!=='string'||value.reason.length>256)))
    throw Error('INVALID_RECEIPT');
}
function unpack(row:ReceiptRow):AgentReceipt {
  if(!validId(row.command_id)||typeof row.result!=='string'||!outcomes.has(row.result)||
    typeof row.observed_at!=='number'||!Number.isFinite(row.observed_at)||
    (row.reason!==null&&(typeof row.reason!=='string'||row.reason.length>256)))
    throw Error('WINDOWS_RECEIPTS_CORRUPT');
  return {commandId:row.command_id,result:row.result as AgentReceipt['result'],
    observedAt:row.observed_at,...(row.reason===null?{}:{reason:row.reason as string})};
}

/** Transactional, host-only receipt and authority-epoch store for Windows.
 * No OBS calls, implicit migration, automatic reconciliation or replay.
 * EXTRA sync is a software guarantee; power-loss behavior still needs G3
 * physical testing. The caller owns the separate exclusive authority lock.
 */
export class WindowsSqliteReceiptJournal {
  private readonly rows=new Map<string,AgentReceipt>();
  private closed=false;
  private constructor(private readonly db:DatabaseSync) {}

  static async open(legacyFile:string):Promise<WindowsSqliteReceiptJournal> {
    if(process.platform!=='win32')throw Error('WINDOWS_RECEIPTS_PLATFORM_REQUIRED');
    if(!path.isAbsolute(legacyFile)||!legacyFile.toLowerCase().endsWith('.json'))
      throw Error('WINDOWS_RECEIPTS_PATH_UNAVAILABLE');
    const parent=realpathSync(path.dirname(legacyFile));
    if(parent.startsWith('\\\\'))throw Error('WINDOWS_RECEIPTS_PATH_UNAVAILABLE');
    const canonical=path.join(parent,path.basename(legacyFile));
    if(existsStrict(canonical)||existsStrict(canonical+'.epoch'))
      throw Error('WINDOWS_RECEIPTS_LEGACY_RECONCILIATION_REQUIRED');
    const file=canonical+'.sqlite';
    const existed=existsStrict(file);
    if(existed&&lstatSync(file).isSymbolicLink())
      throw Error('WINDOWS_RECEIPTS_PATH_UNAVAILABLE');
    let db:DatabaseSync|undefined;
    try {
      db=new DatabaseSync(file);
      if(existed) {
        // Do not mutate an unknown or incompletely initialised database.
        const id=db.prepare('PRAGMA application_id').get() as {application_id?:number};
        const version=db.prepare('PRAGMA user_version').get() as {user_version?:number};
        if(id.application_id!==applicationId||version.user_version!==1)
          throw Error('WINDOWS_RECEIPTS_FORMAT_UNQUALIFIED');
        const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('sc3_receipts','sc3_epoch')").all();
        if(tables.length!==2)throw Error('WINDOWS_RECEIPTS_FORMAT_UNQUALIFIED');
      }
      db.exec('PRAGMA journal_mode=DELETE');
      const mode=db.prepare('PRAGMA journal_mode').get() as {journal_mode?:string};
      if(mode.journal_mode?.toLowerCase()!=='delete')throw Error('WINDOWS_RECEIPTS_JOURNAL_UNSAFE');
      db.exec('PRAGMA synchronous=EXTRA');
      db.exec('PRAGMA busy_timeout=0');
      const sync=db.prepare('PRAGMA synchronous').get() as {synchronous?:number};
      if(sync.synchronous!==3)throw Error('WINDOWS_RECEIPTS_SYNC_UNSAFE');
      if(!existed){
        db.exec('PRAGMA application_id='+applicationId);
        db.exec('PRAGMA user_version=1');
      }
      db.exec('CREATE TABLE IF NOT EXISTS sc3_receipts(command_id TEXT PRIMARY KEY, result TEXT NOT NULL, observed_at REAL NOT NULL, reason TEXT)');
      db.exec('CREATE TABLE IF NOT EXISTS sc3_epoch(id INTEGER PRIMARY KEY CHECK(id=1), value INTEGER NOT NULL)');
      if(!existed)db.exec('INSERT INTO sc3_epoch(id,value) VALUES(1,0)');
      else{
        const row=db.prepare('SELECT value FROM sc3_epoch WHERE id=1').get() as {value?:unknown}|undefined;
        if(!row||typeof row.value!=='number'||!Number.isSafeInteger(row.value)||row.value<0)
          throw Error('WINDOWS_AUTHORITY_EPOCH_CORRUPT');
      }
      const integrity=db.prepare('PRAGMA quick_check').get() as {quick_check?:string};
      if(integrity.quick_check!=='ok')throw Error('WINDOWS_RECEIPTS_CORRUPT');
      const store=new WindowsSqliteReceiptJournal(db);
      const rows=db.prepare('SELECT command_id,result,observed_at,reason FROM sc3_receipts').all() as ReceiptRow[];
      if(rows.length>maxRecords)throw Error('WINDOWS_RECEIPTS_FULL');
      for(const row of rows){
        const receipt=unpack(row);
        if(store.rows.has(receipt.commandId))throw Error('WINDOWS_RECEIPTS_CORRUPT');
        store.rows.set(receipt.commandId,receipt);
      }
      return store;
    }catch(error) {
      db?.close();
      throw error;
    }
  }
  find(id:string):AgentReceipt|undefined {
    const row=this.rows.get(id);
    return row?{...row}:undefined;
  }
  hasUncertain():boolean {
    return [...this.rows.values()].some(row=>row.result==='uncertain');
  }
  /** Revision tokens cannot be reused after a clean or unclean restart. */
  claimEpoch():number {
    if(this.closed)throw Error('WINDOWS_RECEIPTS_CLOSED');
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const row=this.db.prepare('SELECT value FROM sc3_epoch WHERE id=1').get() as {value?:unknown}|undefined;
      if(!row||typeof row.value!=='number'||!Number.isSafeInteger(row.value)||row.value<0)
        throw Error('WINDOWS_AUTHORITY_EPOCH_CORRUPT');
      const next=row.value+1;
      if(!Number.isSafeInteger(next)||next*revisionBlock>Number.MAX_SAFE_INTEGER-revisionBlock)
        throw Error('WINDOWS_AUTHORITY_EPOCH_EXHAUSTED');
      this.db.prepare('UPDATE sc3_epoch SET value=? WHERE id=1').run(next);
      this.db.exec('COMMIT');
      return next*revisionBlock;
    }catch(error) {
      try{this.db.exec('ROLLBACK')}catch{}
      throw error;
    }
  }
  async record(receipt:AgentReceipt):Promise<void> {
    await this.persist(receipt,false);
  }
  async confirmReservation(receipt:AgentReceipt):Promise<void> {
    if(receipt.result!=='confirmed')throw Error('CONFIRMED_RECEIPT_REQUIRED');
    await this.persist(receipt,true);
  }
  private async persist(value:AgentReceipt,confirm:boolean):Promise<void> {
    if(this.closed)throw Error('WINDOWS_RECEIPTS_CLOSED');
    const receipt={...value};assertReceipt(receipt);
    let committed=false;
    try{
      this.db.exec('BEGIN IMMEDIATE');
      const row=this.db.prepare('SELECT command_id,result,observed_at,reason FROM sc3_receipts WHERE command_id=?')
        .get(receipt.commandId) as ReceiptRow|undefined;
      const previous=row?unpack(row):undefined;
      if(confirm) {
        if(previous?.result!=='uncertain'||previous.reason!=='PRE_EXECUTION_RESERVED'||
          receipt.observedAt<previous.observedAt)throw Error('RESERVATION_REQUIRED');
        this.db.prepare('UPDATE sc3_receipts SET result=?, observed_at=?, reason=? WHERE command_id=?')
          .run(receipt.result,receipt.observedAt,receipt.reason??null,receipt.commandId);
      }else{
        if(previous)throw Error('DUPLICATE');
        if(this.rows.size>=maxRecords)throw Error('JOURNAL_FULL');
        this.db.prepare('INSERT INTO sc3_receipts(command_id,result,observed_at,reason) VALUES(?,?,?,?)')
          .run(receipt.commandId,receipt.result,receipt.observedAt,receipt.reason??null);
      }
      this.db.exec('COMMIT');
      committed=true;
      this.rows.set(receipt.commandId,receipt);
    }catch(error) {
      if(!committed){try{this.db.exec('ROLLBACK')}catch{}}
      if(error instanceof Error&&['DUPLICATE','RESERVATION_REQUIRED','JOURNAL_FULL'].includes(error.message))
        throw error;
      throw Error('WINDOWS_RECEIPTS_WRITE_UNCERTAIN');
    }
  }
  close():void {
    if(this.closed)return;
    this.closed=true;
    this.db.close();
  }
}
