import {afterEach,describe,expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {mkdtemp,mkdir,readFile,readdir,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {checkpointQaProfile,migrateQaProfileCopy,restoreQaProfile}
  from '../apps/desktop/src/streamcockpit-upgrade-qa-checkpoint.js';
import {MomentsSqliteStorage} from '../apps/server/src/streamcockpit-moments-sqlite.js';
import {MomentsPipeline} from '../apps/server/src/streamcockpit-moments.js';
import {PredictionIntentSqlite} from '../apps/server/src/streamcockpit-prediction-intent-sqlite.js';
import {AutoModActionIntentSqlite} from '../apps/server/src/streamcockpit-automod-action-intent-sqlite.js';
import {HostDurableWriterQuiescence} from '../apps/server/src/streamcockpit-durable-writer-quiescence.js';
import {runQuiescedQaUpgrade} from '../apps/desktop/src/streamcockpit-upgrade-qa-quiescence.js';

const dirs:string[]=[];
afterEach(async()=>{for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true})});
const steps=[{from:1,to:2,apply:(copy:any)=>({...copy,schemaVersion:2,qaMigration:true})}];
const requests=[
  {sessionId:'live_1',instant:1000,source:'manual',correlationId:'manual_1',title:'Réaction',status:'observed'},
  {sessionId:'live_1',instant:1100,source:'twitch',correlationId:'clip_1',sourceEventId:'evt_1',
    title:'Clip simple',status:'uncertain',clip:{provider:'twitch',reference:'opaque_1'}},
  {sessionId:'live_2',instant:1200,source:'streamlabs',correlationId:'alert_1',sourceEventId:'alert_evt_1',
    title:'Alerte',status:'observed'},
] as const;
function envelope(items:unknown= requests):string{
  const payload=JSON.stringify({schemaVersion:1,requests:items});
  return JSON.stringify({payload,sha256:createHash('sha256').update(payload).digest('hex')});
}
async function fixture(raw=envelope()){
  const root=await mkdtemp(join(tmpdir(),'sc3-upgrade-qa-'));dirs.push(root);
  const active=join(root,'active');await mkdir(join(active,'configuration'),{recursive:true});
  await writeFile(join(active,'configuration','settings.json'),JSON.stringify({schemaVersion:1,associations:{android:'synthetic'},profiles:{fixe:'master'},unrecognized:{keep:true}}));
  await writeFile(join(active,'streamcockpit-moments.json'),raw);
  return {root,active,raw,legacy:join(active,'streamcockpit-moments.json')};
}
const migrated=(root:string)=>join(root,'migrated');
const notPromoted=async(root:string)=>{
  await expect(stat(migrated(root))).rejects.toMatchObject({code:'ENOENT'});
  expect((await readdir(root)).some(f=>f.startsWith('migrated-pending-'))).toBe(false);
};

describe('F09/F10 explicit legacy moments migration on an isolated Windows QA copy',()=>{
  it('migrates validated legacy receipts into actual SQLite, preserves all three sources, counts, statuses and unknown settings',async()=>{
    const f=await fixture();
    const automod=new AutoModActionIntentSqlite(join(f.active,'streamcockpit-automod-action-intents.sqlite'));
    const prediction=new PredictionIntentSqlite(join(f.active,'streamcockpit-prediction-intents.sqlite'));
    expect(automod.reserve('42','held_1','12','ALLOW')).toBe(true);
    expect(prediction.reserve('42')).toBe(true);
    const before=await checkpointQaProfile(f.root);
    const result=await migrateQaProfileCopy(f.root,2,steps,{migrateLegacyMoments:true});
    expect(result).toMatchObject({kind:'SC3_UPGRADE_QA_MIGRATION',fromVersion:1,toVersion:2,
      legacyMoments:{sourceSha256:createHash('sha256').update(f.raw).digest('hex'),requestCount:3,sessionCount:2}});
    expect(await readFile(f.legacy,'utf8')).toBe(f.raw);
    expect(await readFile(join(f.root,'backup','files','streamcockpit-moments.json'),'utf8')).toBe(f.raw);
    expect(await readFile(join(migrated(f.root),'streamcockpit-moments.json.pre-sqlite.json'),'utf8')).toBe(f.raw);
    await expect(stat(join(migrated(f.root),'streamcockpit-moments.json'))).rejects.toMatchObject({code:'ENOENT'});
    const file=join(migrated(f.root),'streamcockpit-moments.sqlite');
    expect(await new MomentsSqliteStorage(file).read()).toBe(f.raw);
    const sessions=await new MomentsPipeline(new MomentsSqliteStorage(file)).listObservedSessions();
    expect(sessions?.map(s=>[s.sessionId,s.markerCount])).toEqual([['live_2',1],['live_1',2]]);
    const exported=await new MomentsPipeline(new MomentsSqliteStorage(file)).export('live_1');
    expect(exported.markers.map(m=>[m.correlationId,m.status,m.clip?.reference??null])).toEqual([
      ['manual_1','observed',null],['clip_1','uncertain','opaque_1']]);
    expect(new AutoModActionIntentSqlite(join(migrated(f.root),'streamcockpit-automod-action-intents.sqlite'))
      .isBlocked('42','held_1')).toBe(true);
    expect(new PredictionIntentSqlite(join(migrated(f.root),'streamcockpit-prediction-intents.sqlite'))
      .isBlocked('42')).toBe(true);
    const settings=JSON.parse(await readFile(join(migrated(f.root),'configuration','settings.json'),'utf8'));
    expect(settings).toMatchObject({schemaVersion:2,qaMigration:true,unrecognized:{keep:true}});
    expect((await restoreQaProfile(f.root)).entries).toEqual(before.entries);
    expect(await readFile(join(f.root,'restored','streamcockpit-moments.json'),'utf8')).toBe(f.raw);
    await expect(migrateQaProfileCopy(f.root,2,steps,{migrateLegacyMoments:true}))
      .rejects.toThrow('MIGRATED_ALREADY_EXISTS');
  });

  it('integrates legacy conversion into the F10 three-writer maintenance + checkpoint + independent recovery',async()=>{
    const f=await fixture(),gate=new HostDurableWriterQuiescence();
    const f02=gate.protect('automod',new AutoModActionIntentSqlite(
      join(f.active,'streamcockpit-automod-action-intents.sqlite')));
    const f08=gate.protect('prediction',new PredictionIntentSqlite(
      join(f.active,'streamcockpit-prediction-intents.sqlite')));
    const f09=gate.protect('moments',new MomentsSqliteStorage(
      join(f.active,'streamcockpit-moments.sqlite')));
    expect(f02.reserve('42','held_1','12','ALLOW')).toBe(true);
    expect(f08.reserve('42')).toBe(true);
    const outcome=await runQuiescedQaUpgrade(f.root,2,steps,gate,{migrateLegacyMoments:true});
    expect(outcome.migration.legacyMoments).toMatchObject({requestCount:3,sessionCount:2});
    expect(outcome.checkpoint.entries).toEqual(outcome.recovery.entries);
    expect(await new MomentsSqliteStorage(
      join(migrated(f.root),'streamcockpit-moments.sqlite')).read()).toBe(f.raw);
    expect(await readFile(join(f.root,'restored','streamcockpit-moments.json'),'utf8')).toBe(f.raw);
    expect(gate.status).toMatchObject({phase:'active',active:0});
    // A pre-migration runtime backed by the old JSON must keep failing closed
    // until the real installer transaction and writer ownership are qualified.
    await expect(f09.read()).rejects.toThrow('MOMENTS_LEGACY_MIGRATION_REQUIRED');
  });

  it('converts an empty but valid checksummed legacy timeline without inventing an event',async()=>{
    const f=await fixture(envelope([]));await checkpointQaProfile(f.root);
    const report=await migrateQaProfileCopy(f.root,2,steps,{migrateLegacyMoments:true});
    expect(report.legacyMoments).toMatchObject({requestCount:0,sessionCount:0});
    expect(await new MomentsSqliteStorage(join(migrated(f.root),'streamcockpit-moments.sqlite')).read()).toBe(f.raw);
    expect(await new MomentsPipeline(new MomentsSqliteStorage(
      join(migrated(f.root),'streamcockpit-moments.sqlite'))).listObservedSessions()).toEqual([]);
  });

  it('never silently converts a legacy journal unless an explicit opt-in is supplied',async()=>{
    const f=await fixture();await checkpointQaProfile(f.root);
    const result=await migrateQaProfileCopy(f.root,2,steps);
    expect(result).not.toHaveProperty('legacyMoments');
    expect(await readFile(join(migrated(f.root),'streamcockpit-moments.json'),'utf8')).toBe(f.raw);
    await expect(new MomentsSqliteStorage(join(migrated(f.root),'streamcockpit-moments.sqlite')).read())
      .rejects.toThrow('MOMENTS_LEGACY_MIGRATION_REQUIRED');
  });

  it.each([
    ['checksum',envelope().replace('sha256','not-sha256')],
    ['duplicate JSON envelope key',envelope().replace('{"payload":','{"payload":"shadow","payload":')],
    ['noncanonical trailing JSON',envelope()+' '],
    ['invalid schema',JSON.stringify({schemaVersion:1,requests:[]})],
    ['duplicate correlation',envelope([requests[0],requests[0]])],
    ['credential-bearing event',envelope([{...requests[0],title:'Bearer SECRET'}])],
  ])('rejects %s without publishing migrated files, modifying legacy or checkpoint',async(_kind,raw)=>{
    const f=await fixture(raw);await checkpointQaProfile(f.root);
    await expect(migrateQaProfileCopy(f.root,2,steps,{migrateLegacyMoments:true}))
      .rejects.toThrow();
    await notPromoted(f.root);
    expect(await readFile(f.legacy,'utf8')).toBe(raw);
    expect(await readFile(join(f.root,'backup','files','streamcockpit-moments.json'),'utf8')).toBe(raw);
  });

  it('refuses mixed legacy + SQLite state rather than overwriting either journal',async()=>{
    const f=await fixture();
    const sqlite=join(f.active,'streamcockpit-moments.sqlite');
    // The adapter's legacy guard intentionally prevents initializing it in this state.
    // A conflicting file must be treated as unknown, even if its bytes are opaque.
    await writeFile(sqlite,Buffer.from('FOREIGN_SQLITE_DATA'));
    await checkpointQaProfile(f.root);
    await expect(migrateQaProfileCopy(f.root,2,steps,{migrateLegacyMoments:true}))
      .rejects.toThrow('MOMENTS_LEGACY_CONFLICT');
    await notPromoted(f.root);
    expect(await readFile(sqlite,'utf8')).toBe('FOREIGN_SQLITE_DATA');
  });

  it('refuses an active legacy event committed DURING a detached migration before promoting stale SQLite',async()=>{
    const f=await fixture();await checkpointQaProfile(f.root);
    const changed=envelope([...requests,{...requests[0],correlationId:'manual_late',instant:1400}]);
    let entered=false;
    await expect(migrateQaProfileCopy(f.root,2,[{from:1,to:2,apply:(state:any)=>{
      entered=true;
      // Synchronous simulated competing producer in the isolated QA fixture.
      writeFileSync(f.legacy,changed);
      return {...state,schemaVersion:2};
    }}],{migrateLegacyMoments:true})).rejects.toThrow('MOMENTS_LEGACY_SOURCE_CHANGED');
    expect(entered).toBe(true);
    await notPromoted(f.root);
    expect(await readFile(f.legacy,'utf8')).toBe(changed);
    expect(await readFile(join(f.root,'backup','files','streamcockpit-moments.json'),'utf8')).toBe(f.raw);
  });
  it('refuses an active legacy journal changed BEFORE migration begins',async()=>{
    const g=await fixture();await checkpointQaProfile(g.root);
    const changed=envelope([...requests,{...requests[0],correlationId:'manual_late',instant:1400}]);
    await writeFile(g.legacy,changed);
    await expect(migrateQaProfileCopy(g.root,2,steps,{migrateLegacyMoments:true}))
      .rejects.toThrow('MOMENTS_LEGACY_SOURCE_CHANGED');
    await notPromoted(g.root);
    expect(await readFile(g.legacy,'utf8')).toBe(changed);
  });

  it('refuses migration if the source legacy journal is absent or a sidecar was captured',async()=>{
    const f=await fixture();await checkpointQaProfile(f.root);await rm(f.legacy);
    await expect(migrateQaProfileCopy(f.root,2,steps,{migrateLegacyMoments:true}))
      .rejects.toThrow('MOMENTS_LEGACY_SOURCE_CHANGED');
    await notPromoted(f.root);
    const g=await fixture();
    await writeFile(g.legacy+'-journal','synthetic-uncertain');
    await checkpointQaProfile(g.root);
    await expect(migrateQaProfileCopy(g.root,2,steps,{migrateLegacyMoments:true}))
      .rejects.toThrow('MOMENTS_LEGACY_CONFLICT');
    await notPromoted(g.root);
  });
});
