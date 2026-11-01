import {afterEach,describe,expect,it} from 'vitest';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {WindowsSqliteReceiptJournal} from '../apps/agent/src/windows-sqlite-receipts.js';

const folders:string[]=[];
async function fixture() {
  const folder=await mkdtemp(path.join(tmpdir(),'sc3-agent-win-db-'));
  folders.push(folder);
  return path.join(folder,'receipts.json');
}
afterEach(async()=>{for(const folder of folders.splice(0))await rm(folder,{recursive:true,force:true})});
const reservation=(id='cmd_1')=>({commandId:id,result:'uncertain' as const,
  reason:'PRE_EXECUTION_RESERVED',observedAt:1000});
const confirmed=(id='cmd_1')=>({commandId:id,result:'confirmed' as const,
  reason:'OBS_STATE_VERIFIED',observedAt:1001});

describe.skipIf(process.platform!=='win32')('F00 Windows SQLite command durability — no OBS',()=>{
  it('persists a reservation then confirmation across restarts, never replays IDs',async()=>{
    const file=await fixture(),store=await WindowsSqliteReceiptJournal.open(file);
    expect(store.hasUncertain()).toBe(false);
    expect(store.find('cmd_1')).toBeUndefined();
    await store.record(reservation());
    expect(store.hasUncertain()).toBe(true);
    expect(store.find('cmd_1')?.result).toBe('uncertain');
    store.close();
    const next=await WindowsSqliteReceiptJournal.open(file);
    expect(next.hasUncertain()).toBe(true);
    expect(next.find('cmd_1')?.reason).toBe('PRE_EXECUTION_RESERVED');
    await expect(next.record(reservation())).rejects.toThrow('DUPLICATE');
    await next.confirmReservation(confirmed());
    expect(next.hasUncertain()).toBe(false);
    next.close();
    const third=await WindowsSqliteReceiptJournal.open(file);
    expect(third.find('cmd_1')).toMatchObject(confirmed());
    await expect(third.record(reservation())).rejects.toThrow('DUPLICATE');
    third.close();
    await expect(readFile(file,'utf8')).rejects.toMatchObject({code:'ENOENT'});
  });
  it('uses EXTRA synchronous rollback journal and monotonic epochs',async()=>{
    const file=await fixture(),store=await WindowsSqliteReceiptJournal.open(file);
    const db=new DatabaseSync(file+'.sqlite',{readOnly:true});
    const mode=db.prepare('PRAGMA journal_mode').get() as {journal_mode:string};
    expect(mode.journal_mode.toLowerCase()).toBe('delete');
    db.close();
    expect(store.claimEpoch()).toBe(1_000_000);
    expect(store.claimEpoch()).toBe(2_000_000);
    store.close();
    const next=await WindowsSqliteReceiptJournal.open(file);
    expect(next.claimEpoch()).toBe(3_000_000);
    next.close();
  });
  it('rejects confirmation without reservation or with a reversed clock',async()=>{
    const file=await fixture(),store=await WindowsSqliteReceiptJournal.open(file);
    await expect(store.confirmReservation(confirmed())).rejects.toThrow('RESERVATION_REQUIRED');
    await store.record(reservation());
    await expect(store.confirmReservation({...confirmed(),observedAt:999})).rejects.toThrow('RESERVATION_REQUIRED');
    expect(store.find('cmd_1')).toMatchObject(reservation());
    await store.confirmReservation(confirmed());
    await expect(store.confirmReservation(confirmed())).rejects.toThrow('RESERVATION_REQUIRED');
    store.close();
  });
  it('keeps uncertain reservations after a real subprocess exits with an uncommitted transaction',async()=>{
    const file=await fixture(),store=await WindowsSqliteReceiptJournal.open(file);
    await store.record(reservation('reserved_before_crash'));
    store.close();
    const script="const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.argv[1]);db.exec('BEGIN IMMEDIATE');db.prepare('INSERT INTO sc3_receipts(command_id,result,observed_at,reason) VALUES(?,?,?,?)').run('uncommitted','confirmed',1001,'OBS_STATE_VERIFIED');process.exit(73);";
    const child=spawnSync(process.execPath,['-e',script,file+'.sqlite'],{timeout:10000,stdio:'ignore'});
    expect(child.error).toBeUndefined();
    expect(child.status).toBe(73);
    const again=await WindowsSqliteReceiptJournal.open(file);
    expect(again.find('reserved_before_crash')?.result).toBe('uncertain');
    expect(again.find('uncommitted')).toBeUndefined();
    expect(again.hasUncertain()).toBe(true);
    again.close();
  },15000);
  it('refuses legacy JSON or legacy epoch, preserving the bytes for operator recovery',async()=>{
    for(const name of ['legacy-json','legacy-epoch']){
      const file=await fixture(),target=name==='legacy-json'?file:file+'.epoch';
      await writeFile(target,name,'utf8');
      await expect(WindowsSqliteReceiptJournal.open(file))
        .rejects.toThrow('WINDOWS_RECEIPTS_LEGACY_RECONCILIATION_REQUIRED');
      expect(await readFile(target,'utf8')).toBe(name);
    }
  });
  it('refuses a corrupt SQLite file without falling back to a fresh journal',async()=>{
    const file=await fixture();
    await writeFile(file+'.sqlite','corrupt-not-sqlite','utf8');
    await expect(WindowsSqliteReceiptJournal.open(file)).rejects.toThrow();
    expect(await readFile(file+'.sqlite','utf8')).toBe('corrupt-not-sqlite');
  });
  it('refuses a missing receipt table or a missing epoch without reinitialising history',async()=>{
    for(const change of ['DROP TABLE sc3_receipts','DELETE FROM sc3_epoch']){
      const file=await fixture(),store=await WindowsSqliteReceiptJournal.open(file);
      await store.record(reservation());
      expect(store.claimEpoch()).toBe(1_000_000);
      store.close();
      const db=new DatabaseSync(file+'.sqlite');
      db.exec(change);
      db.close();
      await expect(WindowsSqliteReceiptJournal.open(file)).rejects.toThrow();
      // A refused reopen must never invent an empty usable authority epoch.
    }
  });
  it('requires unambiguous IDs, numeric time and bounded reasons before accepting data',async()=>{
    const file=await fixture(),store=await WindowsSqliteReceiptJournal.open(file);
    for(const value of [
      {...reservation(),commandId:'bad space'},
      {...reservation(),observedAt:Number.NaN},
      {...reservation(),observedAt:Number.POSITIVE_INFINITY},
      {...reservation(),reason:'x'.repeat(257)},
    ])await expect(store.record(value)).rejects.toThrow('INVALID_RECEIPT');
    expect(store.hasUncertain()).toBe(false);
    store.close();
  });
});
