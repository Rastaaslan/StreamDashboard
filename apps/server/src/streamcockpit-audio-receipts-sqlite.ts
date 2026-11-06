import {createHash} from 'node:crypto';
import {lstatSync,realpathSync,openSync,closeSync} from 'node:fs';
import {dirname,isAbsolute,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {audioReceiptId,validateAudioChange,validateAudioReceipt,validateAudioReceiptContext,validateAudioReceiptRecord,
  type AudioReceipt,type AudioReceiptContext,type AudioReceiptJournal,type AudioReceiptRecord} from './streamcockpit-audio-receipts.js';
import type {ObsAudioChange} from '../../../integrations/obs/src/client.js';
const APP=0x53434635;
const SQL='CREATE TABLE audio_receipts (sequence INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, actor TEXT NOT NULL, authority TEXT NOT NULL, payload TEXT NOT NULL, sha256 TEXT NOT NULL)';
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const fail=()=>new Error('AUDIO_RECEIPT_STORE_UNAVAILABLE');
const canonical=(p:string)=>process.platform==='win32'?p.toLowerCase():p;
/** Append-only intent and one-way completion. Never prunes an unknown attempt,
 * auto-migrates foreign files, retries OBS, or treats a missing receipt as success.
 * Full history is paged by monotonic sequence (100 rows), without time expiry. */
export class AudioReceiptSqlite implements AudioReceiptJournal {
  private readonly file:string;
  private poisoned=false;
  constructor(file:string){
    if(!isAbsolute(file)||file.includes('\0')||!file.endsWith('.sqlite')||
      (process.platform==='win32'&&(!/^[A-Za-z]:[\\/]/.test(file)||file.slice(2).includes(':'))))throw fail();
    this.file=resolve(file);
  }
  private open(write:boolean):DatabaseSync|undefined{
    if(write&&this.poisoned)throw fail();
    let db:DatabaseSync|undefined;
    try{
      const parent=dirname(this.file),dir=lstatSync(parent);
      if(!dir.isDirectory()||dir.isSymbolicLink()||canonical(realpathSync(parent))!==canonical(parent))throw fail();
      let existing=true;
      try{const s=lstatSync(this.file);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||
        s.size>64*1024*1024||canonical(realpathSync(this.file))!==canonical(this.file))throw fail()}
      catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;existing=false}
      if(!existing&&!write)return undefined;
      for(const suffix of ['-wal','-shm']){
        try{lstatSync(this.file+suffix);throw fail()}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e}
      }
      if(!existing){const fd=openSync(this.file,'wx',0o600);closeSync(fd)}
      db=new DatabaseSync(this.file,{readOnly:!write});db.exec('PRAGMA busy_timeout=0');
      if(existing){
        const id=db.prepare('PRAGMA application_id').get() as {application_id:number};
        const version=db.prepare('PRAGMA user_version').get() as {user_version:number};
        const mode=db.prepare('PRAGMA journal_mode').get() as {journal_mode:string};
        const schema=db.prepare("SELECT sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all() as {sql:string}[];
        const check=db.prepare('PRAGMA quick_check').get() as {quick_check:string};
        if(id.application_id!==APP||version.user_version!==1||mode.journal_mode!=='delete'||
          schema.length!==1||schema[0]!.sql!==SQL||check.quick_check!=='ok')throw fail();
      }
      if(write){
        db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=EXTRA');
        if((db.prepare('PRAGMA synchronous').get() as {synchronous:number}).synchronous!==3)throw fail();
        if(!existing)db.exec('BEGIN IMMEDIATE; '+SQL+'; PRAGMA application_id='+APP+'; PRAGMA user_version=1; COMMIT');
      }
      return db;
    }catch{try{db?.close()}catch{/* uncertain initialization remains intact */}if(write)this.poisoned=true;throw fail()}
  }
  private decode(row:unknown):AudioReceiptRecord|undefined{
    if(!row)return undefined;
    const r=row as {id:string;actor:string;authority:string;payload:string;sha256:string};
    try{
      if(typeof r.payload!=='string'||Buffer.byteLength(r.payload)>16384||hash(r.payload)!==r.sha256)throw fail();
      const value=JSON.parse(r.payload) as AudioReceiptRecord;validateAudioReceiptRecord(value);
      if(value.id!==r.id||hash(value.context.actor)!==r.actor||hash(value.context.authority)!==r.authority||
        JSON.stringify(value)!==r.payload)throw fail();
      return value;
    }catch{throw fail()}
  }
  read(id:string,actor:string,authority:string):AudioReceiptRecord|undefined{
    if(!audioReceiptId(id)||!actor||!authority)throw fail();
    const db=this.open(false);if(!db)return undefined;
    try{return this.decode(db.prepare('SELECT * FROM audio_receipts WHERE id=? AND actor=? AND authority=?').get(id,hash(actor),hash(authority)))}
    finally{db.close()}
  }
  history(actor:string,authority:string,before=Number.MAX_SAFE_INTEGER){
    if(!actor||!authority||!Number.isSafeInteger(before)||before<1)throw fail();
    const db=this.open(false);if(!db)return [];
    try{return db.prepare('SELECT * FROM audio_receipts WHERE actor=? AND authority=? AND sequence<? ORDER BY sequence DESC LIMIT 100')
      .all(hash(actor),hash(authority),before).map(row=>({sequence:(row as {sequence:number}).sequence,record:this.decode(row)!}))}
    finally{db.close()}
  }
  reserve(id:string,context:AudioReceiptContext,change:ObsAudioChange):boolean{
    if(!audioReceiptId(id))throw fail();validateAudioReceiptContext(context);validateAudioChange(change);
    const value:AudioReceiptRecord={id,context:structuredClone(context),change:structuredClone(change),createdAt:Date.now()};
    const db=this.open(true)!;let transaction=false;
    try{
      db.exec('BEGIN IMMEDIATE');transaction=true;
      if(db.prepare('SELECT 1 FROM audio_receipts WHERE id=?').get(id)){db.exec('ROLLBACK');transaction=false;return false}
      if((db.prepare('SELECT COUNT(*) AS n FROM audio_receipts').get() as {n:number}).n>=10000)throw fail();
      const payload=JSON.stringify(value);
      db.prepare('INSERT INTO audio_receipts(id,actor,authority,payload,sha256) VALUES(?,?,?,?,?)')
        .run(id,hash(context.actor),hash(context.authority),payload,hash(payload));
      db.exec('COMMIT');transaction=false;
      if(JSON.stringify(this.decode(db.prepare('SELECT * FROM audio_receipts WHERE id=?').get(id)))!==payload)throw fail();
      return true;
    }catch{this.poisoned=true;if(transaction)try{db.exec('ROLLBACK')}catch{/* no reset */}throw fail()}
    finally{db.close()}
  }
  complete(id:string,context:AudioReceiptContext,receipt:AudioReceipt):void{
    validateAudioReceiptContext(context);validateAudioReceipt(receipt);
    if(receipt.confirmationId!==id)throw fail();
    const db=this.open(true)!;let transaction=false;
    try{
      db.exec('BEGIN IMMEDIATE');transaction=true;
      const value=this.decode(db.prepare('SELECT * FROM audio_receipts WHERE id=?').get(id));
      if(!value||JSON.stringify(value.context)!==JSON.stringify(context)||
        JSON.stringify(value.change)!==JSON.stringify(receipt.change))throw fail();
      if(value.receipt){
        if(JSON.stringify(value.receipt)!==JSON.stringify(receipt))throw fail();
        db.exec('ROLLBACK');transaction=false;return;
      }
      value.receipt=structuredClone(receipt);const payload=JSON.stringify(value);
      db.prepare('UPDATE audio_receipts SET payload=?,sha256=? WHERE id=?').run(payload,hash(payload),id);
      db.exec('COMMIT');transaction=false;
      if(JSON.stringify(this.decode(db.prepare('SELECT * FROM audio_receipts WHERE id=?').get(id)))!==payload)throw fail();
    }catch{this.poisoned=true;if(transaction)try{db.exec('ROLLBACK')}catch{/* leave uncertain */}throw fail()}
    finally{db.close()}
  }
}
