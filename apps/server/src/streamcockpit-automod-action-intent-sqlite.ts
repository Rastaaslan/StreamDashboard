import {lstatSync,realpathSync} from 'node:fs';
import {basename,dirname,isAbsolute,join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import type {HeldDecision} from '../../../integrations/twitch/src/streamcockpit-automod-action.js';

// One-way FIXE-owned barrier: ANY attempt can have reached Twitch. Never
// automatically delete or age-out a key, including on a provider 204/error.
// Synchronous=EXTRA is a software barrier, not an electrical durability proof.
const APP_ID=0x53434632; // SCF2, distinct from F08/F09 journals
const TABLE_SQL="CREATE TABLE automod_action_intents (broadcaster_id TEXT NOT NULL, message_id TEXT NOT NULL, user_id TEXT NOT NULL, decision TEXT NOT NULL CHECK(decision IN ('ALLOW','DENY')), created_at INTEGER NOT NULL, PRIMARY KEY (broadcaster_id, message_id))";
const validBroadcaster=(id:string)=>typeof id==='string'&&/^\d{1,30}$/.test(id);
const validMessage=(id:string)=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(id);
const fail=()=>new Error('AUTOMOD_ACTION_FENCE_UNAVAILABLE');

export interface AutoModActionAttemptFence{
  isBlocked(broadcasterId:string,messageId:string):boolean;
  reserve(broadcasterId:string,messageId:string,userId:string,decision:HeldDecision):boolean;
}

export class AutoModActionIntentSqlite implements AutoModActionAttemptFence{
  constructor(private readonly file:string){
    if(!isAbsolute(file)||!file.toLowerCase().endsWith('.sqlite')||
      (process.platform==='win32'&&(!/^[A-Za-z]:[\\/]/.test(file)||file.slice(2).includes(':'))))
      throw fail();
  }

  private open(writable:boolean):DatabaseSync|null{
    let db:DatabaseSync|undefined;
    try{
      const parent=realpathSync(dirname(this.file));
      if(process.platform==='win32'&&
        (parent.startsWith('\\\\')||parent.startsWith('//')))throw fail();
      const path=join(parent,basename(this.file));
      let stat:ReturnType<typeof lstatSync>|null=null;
      try{stat=lstatSync(path)}
      catch(error){
        if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
      }
      if(stat&&(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||
        realpathSync(path).toLowerCase()!==path.toLowerCase()))throw fail();
      if(!stat&&!writable)return null;
      db=new DatabaseSync(path,{readOnly:!writable});
      db.exec('PRAGMA busy_timeout=0');
      if(stat){
        // Validate unknown/corrupt journals BEFORE modifying ANY pragma or row.
        const app=db.prepare('PRAGMA application_id').get() as {application_id?:number};
        const version=db.prepare('PRAGMA user_version').get() as {user_version?:number};
        const table=db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='automod_action_intents'").get() as {sql?:string}|undefined;
        const others=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as {name:string}[];
        const mode=db.prepare('PRAGMA journal_mode').get() as {journal_mode?:string};
        if(app.application_id!==APP_ID||version.user_version!==1||table?.sql!==TABLE_SQL||
          others.length!==1||others[0].name!=='automod_action_intents'||
          mode.journal_mode?.toLowerCase()!=='delete')throw fail();
        const quick=db.prepare('PRAGMA quick_check').get() as {quick_check?:string};
        if(quick.quick_check!=='ok')throw fail();
      }
      if(writable){
        db.exec('PRAGMA journal_mode=DELETE');
        db.exec('PRAGMA synchronous=EXTRA');
        const mode=db.prepare('PRAGMA journal_mode').get() as {journal_mode?:string};
        const sync=db.prepare('PRAGMA synchronous').get() as {synchronous?:number};
        if(mode.journal_mode?.toLowerCase()!=='delete'||sync.synchronous!==3)throw fail();
        if(!stat){
          // An interrupted first initialization leaves a foreign/unknown DB;
          // it cannot be silently reset on the next run.
          let transaction=false;
          try{
            db.exec('BEGIN IMMEDIATE');transaction=true;
            db.exec(TABLE_SQL);
            db.exec('PRAGMA application_id='+APP_ID);
            db.exec('PRAGMA user_version=1');
            db.exec('COMMIT');transaction=false;
          }catch(error){
            if(transaction){try{db.exec('ROLLBACK')}catch{/* blocked on next open */}}
            throw error;
          }
        }
      }
      return db;
    }catch{
      db?.close();
      throw fail();
    }
  }

  isBlocked(broadcasterId:string,messageId:string):boolean{
    if(!validBroadcaster(broadcasterId)||!validMessage(messageId))throw fail();
    const db=this.open(false);
    if(!db)return false;
    try{
      return Boolean(db.prepare('SELECT 1 FROM automod_action_intents WHERE broadcaster_id=? AND message_id=?')
        .get(broadcasterId,messageId));
    }catch{throw fail()}
    finally{db.close()}
  }

  reserve(broadcasterId:string,messageId:string,userId:string,decision:HeldDecision):boolean{
    if(!validBroadcaster(broadcasterId)||!validBroadcaster(userId)||
      !validMessage(messageId)||!['ALLOW','DENY'].includes(decision))throw fail();
    const db=this.open(true)!;
    let transaction=false;
    try{
      db.exec('BEGIN IMMEDIATE');transaction=true;
      if(db.prepare('SELECT 1 FROM automod_action_intents WHERE broadcaster_id=? AND message_id=?')
        .get(broadcasterId,messageId)){
        db.exec('ROLLBACK');transaction=false;
        return false;
      }
      db.prepare('INSERT INTO automod_action_intents(broadcaster_id,message_id,user_id,decision,created_at) VALUES(?,?,?,?,?)')
        .run(broadcasterId,messageId,userId,decision,Date.now());
      db.exec('COMMIT');transaction=false;
      return true;
    }catch{
      if(transaction){try{db.exec('ROLLBACK')}catch{/* uncertain COMMIT: fail closed */}}
      throw fail();
    }finally{db.close()}
  }
}
