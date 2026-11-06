import {afterEach,describe,expect,it} from 'vitest';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {HostDurableWriterQuiescence} from '../apps/server/src/streamcockpit-durable-writer-quiescence.js';
import {AutoModActionIntentSqlite} from '../apps/server/src/streamcockpit-automod-action-intent-sqlite.js';
import {PredictionIntentSqlite} from '../apps/server/src/streamcockpit-prediction-intent-sqlite.js';
import {MomentsSqliteStorage} from '../apps/server/src/streamcockpit-moments-sqlite.js';
import {checkpointQaProfile,migrateQaProfileCopy,restoreQaProfile} from '../apps/desktop/src/streamcockpit-upgrade-qa-checkpoint.js';
import {runQuiescedQaUpgrade} from '../apps/desktop/src/streamcockpit-upgrade-qa-quiescence.js';

const dirs:string[]=[];
afterEach(async()=>{for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true})});
async function fixture(){
  const root=await mkdtemp(join(tmpdir(),'sc3-upgrade-qa-'));dirs.push(root);
  await mkdir(join(root,'active','configuration'),{recursive:true});
  await writeFile(join(root,'active','configuration','settings.json'),
    JSON.stringify({schemaVersion:1,associations:{android:'synthetic'},profiles:{fixe:'master'},extra:'retain'}));
  return {root,active:join(root,'active')};
}
const migration=[{from:1,to:2,apply:(copy:any)=>({...copy,schemaVersion:2,qaFlag:true})}];
const protectedWriters=(active:string,gate:HostDurableWriterQuiescence)=>({
  f02:gate.protect('automod',new AutoModActionIntentSqlite(join(active,'streamcockpit-automod-action-intents.sqlite'))),
  f08:gate.protect('prediction',new PredictionIntentSqlite(join(active,'streamcockpit-prediction-intents.sqlite'))),
  f09:gate.protect('moments',new MomentsSqliteStorage(join(active,'streamcockpit-moments.sqlite'))),
});

describe('F10: in-process controlled quiescence of the three FIXE SQLite writer interfaces',()=>{
  it('pauses ALL F02/F08/F09 writes and performs real Windows backup, migration and detached recovery',async()=>{
    const f=await fixture(),gate=new HostDurableWriterQuiescence();
    const {f02,f08,f09}=protectedWriters(f.active,gate);
    expect(f02.reserve('42','held-1','12','ALLOW')).toBe(true);
    expect(f08.reserve('42')).toBe(true);
    expect(await f09.compareAndSwap(null,'first durable marker')).toBe(true);
    const result=await gate.withQuiesced(async()=>{
      gate.assertQuiesced();
      expect(gate.status).toMatchObject({phase:'quiesced',active:0,
        coverage:['automod','moments','prediction']});
      expect(()=>f02.reserve('42','held-2','12','DENY')).toThrow('SC3_DURABLE_WRITERS_PAUSED_OR_BLOCKED');
      expect(()=>f08.reserve('43')).toThrow('SC3_DURABLE_WRITERS_PAUSED_OR_BLOCKED');
      expect(()=>f09.compareAndSwap('first durable marker','unexpected')).toThrow('SC3_DURABLE_WRITERS_PAUSED_OR_BLOCKED');
      expect(f02.isBlocked('42','held-1')).toBe(true);
      expect(f08.isBlocked('42')).toBe(true);
      expect(await f09.read()).toBe('first durable marker');
      const backup=await checkpointQaProfile(f.root);
      const migrated=await migrateQaProfileCopy(f.root,2,migration);
      const restored=await restoreQaProfile(f.root);
      return {backup,migrated,restored};
    });
    expect(result.backup.entries).toHaveLength(4);
    expect(result.migrated).toMatchObject({fromVersion:1,toVersion:2});
    expect(result.restored.entries).toEqual(result.backup.entries);
    expect(gate.status.phase).toBe('active');
    for(const stage of ['backup/files','migrated','restored']){
      const place=join(f.root,...stage.split('/'));
      expect(new AutoModActionIntentSqlite(join(place,'streamcockpit-automod-action-intents.sqlite'))
        .isBlocked('42','held-1')).toBe(true);
      expect(new PredictionIntentSqlite(join(place,'streamcockpit-prediction-intents.sqlite'))
        .isBlocked('42')).toBe(true);
      expect(await new MomentsSqliteStorage(join(place,'streamcockpit-moments.sqlite')).read())
        .toBe('first durable marker');
    }
    // Only AFTER quiescence is released can new host receipts be reserved.
    expect(f02.reserve('42','held-2','12','DENY')).toBe(true);
    expect(f08.reserve('43')).toBe(true);
    expect(await f09.compareAndSwap('first durable marker','second marker')).toBe(true);
  });

  it('runs the reviewed three-phase F10 QA workflow under an explicit writer drain',async()=>{
    const f=await fixture(),gate=new HostDurableWriterQuiescence();
    const {f02,f08,f09}=protectedWriters(f.active,gate);
    expect(f02.reserve('42','held-1','12','ALLOW')).toBe(true);
    expect(f08.reserve('42')).toBe(true);
    expect(await f09.compareAndSwap(null,'first marker')).toBe(true);
    const evidence=await runQuiescedQaUpgrade(f.root,2,migration,gate);
    expect(evidence.checkpoint.entries).toHaveLength(4);
    expect(evidence.migration).toMatchObject({fromVersion:1,toVersion:2});
    expect(evidence.recovery.entries).toEqual(evidence.checkpoint.entries);
    const restored=join(f.root,'restored');
    expect(new AutoModActionIntentSqlite(join(restored,'streamcockpit-automod-action-intents.sqlite'))
      .isBlocked('42','held-1')).toBe(true);
    expect(new PredictionIntentSqlite(join(restored,'streamcockpit-prediction-intents.sqlite'))
      .isBlocked('42')).toBe(true);
    expect(await new MomentsSqliteStorage(join(restored,'streamcockpit-moments.sqlite')).read())
      .toBe('first marker');
    expect(gate.status).toMatchObject({phase:'active',active:0});
  });

  it('refuses an incomplete registration, duplicate owner or unreviewed method',async()=>{
    const f=await fixture(),gate=new HostDurableWriterQuiescence();
    const f02=gate.protect('automod',new AutoModActionIntentSqlite(join(f.active,'streamcockpit-automod-action-intents.sqlite')));
    await expect(gate.withQuiesced(()=>true)).rejects.toThrow('SC3_DURABLE_WRITERS_COVERAGE_INCOMPLETE');
    expect(()=>gate.protect('automod',new AutoModActionIntentSqlite(join(f.active,'elsewhere.sqlite'))))
      .toThrow('SC3_DURABLE_WRITERS_REGISTRATION_DENIED');
    expect(()=>Reflect.get(f02,'open')()).toThrow('SC3_DURABLE_WRITERS_UNREVIEWED_METHOD');
    expect(f02.reserve('42','held-1','12','DENY')).toBe(true);
  });

  it('drains an in-flight async journal before entering maintenance; denies new writes immediately',async()=>{
    const f=await fixture(),gate=new HostDurableWriterQuiescence();
    gate.protect('automod',new AutoModActionIntentSqlite(join(f.active,'streamcockpit-automod-action-intents.sqlite')));
    const f08=gate.protect('prediction',new PredictionIntentSqlite(join(f.active,'streamcockpit-prediction-intents.sqlite')));
    let finish!:()=>void;
    const held=new Promise<void>(resolve=>{finish=resolve});
    const f09=gate.protect('moments',{
      read:async()=>null,
      compareAndSwap:async()=>{await held;return true},
    });
    const writer=f09.compareAndSwap();
    let started=false;
    const task=gate.withQuiesced(async()=>{gate.assertQuiesced();started=true;return true});
    await Promise.resolve();
    expect(gate.status).toMatchObject({phase:'draining',active:1});
    expect(started).toBe(false);
    expect(()=>f08.reserve('42')).toThrow('SC3_DURABLE_WRITERS_PAUSED_OR_BLOCKED');
    finish();
    await expect(writer).resolves.toBe(true);
    await expect(task).resolves.toBe(true);
    expect(started).toBe(true);
    expect(f08.reserve('42')).toBe(true);
  });

  it('aborts maintenance when a pending writer fails while draining; never resumes automatically',async()=>{
    const f=await fixture(),gate=new HostDurableWriterQuiescence();
    gate.protect('automod',new AutoModActionIntentSqlite(join(f.active,'streamcockpit-automod-action-intents.sqlite')));
    gate.protect('prediction',new PredictionIntentSqlite(join(f.active,'streamcockpit-prediction-intents.sqlite')));
    let failWriter!:(error:Error)=>void;
    const deferred=new Promise<void>((_,reject)=>{failWriter=reject});
    // The delayed writer simulates an unsettled COMMIT receipt.
    const asyncWriter=gate.protect('moments',{
      read:async()=>null,
      compareAndSwap:async()=>{await deferred;return true},
    });
    const running=asyncWriter.compareAndSwap();
    let entered=false;
    const maintenance=gate.withQuiesced(async()=>{entered=true});
    await Promise.resolve();
    expect(gate.status.phase).toBe('draining');
    failWriter(Error('COMMIT_OUTCOME_UNCERTAIN'));
    await expect(running).rejects.toThrow('COMMIT_OUTCOME_UNCERTAIN');
    await expect(maintenance).rejects.toThrow('SC3_DURABLE_WRITERS_WRITER_OUTCOME_UNCERTAIN');
    expect(entered).toBe(false);
    expect(gate.status).toMatchObject({phase:'blocked',active:0});
  });

  it('does not silently resume after an uncertain writer failure or a failed maintenance operation',async()=>{
    const f=await fixture(),gate=new HostDurableWriterQuiescence();
    const {f02,f08}=protectedWriters(f.active,gate);
    // Failed real reservation is treated as unknown, even if it was pre-COMMIT.
    expect(()=>f08.reserve('not-a-number')).toThrow();
    expect(gate.status.phase).toBe('blocked');
    await expect(gate.withQuiesced(async()=>true)).rejects.toThrow('SC3_DURABLE_WRITERS_MAINTENANCE_UNAVAILABLE');
    expect(()=>f02.reserve('42','held-2','12','ALLOW')).toThrow('SC3_DURABLE_WRITERS_PAUSED_OR_BLOCKED');
    const fresh=new HostDurableWriterQuiescence();
    protectedWriters(f.active,fresh);
    await expect(fresh.withQuiesced(async()=>{throw Error('QA_COPY_UNCERTAIN')}))
      .rejects.toThrow('QA_COPY_UNCERTAIN');
    expect(fresh.status.phase).toBe('blocked');
  });
});
