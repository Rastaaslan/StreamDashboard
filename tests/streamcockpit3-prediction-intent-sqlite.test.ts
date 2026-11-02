import { expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AdvancedTwitchError } from '../integrations/twitch/src/streamcockpit-advanced.js';
import type { PredictionCreateTwitch } from '../integrations/twitch/src/streamcockpit-prediction-create.js';
import type { TwitchActor } from '../apps/server/src/streamcockpit-twitch-service.js';
import { PredictionIntentSqlite, type PredictionCreationFence } from '../apps/server/src/streamcockpit-prediction-intent-sqlite.js';
import { StreamcockpitPredictionCreateService } from '../apps/server/src/streamcockpit-twitch-prediction-create-service.js';

const actor = { id:'paired-1', canRead:true, canInteract:true } as TwitchActor;
const draft = { title:'Which boss?', outcomes:['A','B'], predictionWindow:60 };
const epoch = '8:23';
async function withTemp(fn:(file:string)=>Promise<void>) {
  const folder = await mkdtemp(join(tmpdir(),'sc3-prediction-intent-'));
  try { await fn(join(folder,'prediction-intents.sqlite')); }
  finally { await rm(folder,{force:true,recursive:true}); }
}
function service(fence: PredictionCreationFence, behavior:'confirmed'|'uncertain'|'prepost'='confirmed') {
  const writes = vi.fn();
  const api = {
    preflight: async () => ({ broadcasterId:'123', fingerprint:'fixed', validUntil:Date.now()+40_000 }),
    createConfirmed: async (_draft:unknown,_id:string,_fingerprint:string,beforeSend:()=>Promise<void>) => {
      if (behavior==='prepost') throw new AdvancedTwitchError('forbidden');
      await beforeSend();
      writes();
      if (behavior==='uncertain') throw new AdvancedTwitchError('uncertain');
      return { status:'confirmed' as const,predictionId:'observed-1' };
    },
  } as unknown as PredictionCreateTwitch;
  return { svc:new StreamcockpitPredictionCreateService(api,Date.now,fence),writes };
}

it('F08 SQLite intent uses durable blocking across recreated host services, without auto POST replay',()=>withTemp(async file=>{
  const first=service(new PredictionIntentSqlite(file));
  const preview=await first.svc.preview(actor,draft,epoch);
  const receipt=await first.svc.confirm(actor,preview.confirmationId,true,epoch,async()=>{});
  expect(receipt).toMatchObject({status:'confirmed',predictionId:'observed-1'});
  expect(first.writes).toHaveBeenCalledTimes(1);
  const afterRestart=service(new PredictionIntentSqlite(file));
  await expect(afterRestart.svc.preview(actor,draft,epoch)).rejects.toMatchObject({code:'precondition'});
  expect(afterRestart.writes).not.toHaveBeenCalled();
}));

it('F08 uncertain POST stays blocked after restart, while known pre-POST refusal releases intent',()=>withTemp(async file=>{
  const unsure=service(new PredictionIntentSqlite(file),'uncertain');
  const preview=await unsure.svc.preview(actor,draft,epoch);
  await expect(unsure.svc.confirm(actor,preview.confirmationId,true,epoch,async()=>{}))
    .rejects.toMatchObject({code:'uncertain'});
  expect(unsure.writes).toHaveBeenCalledTimes(1);
  await expect(service(new PredictionIntentSqlite(file)).svc.preview(actor,draft,epoch))
    .rejects.toMatchObject({code:'precondition'});
  // Explicitly separate DB: cannot release an uncertain result.
  const secondFile=file.replace('.sqlite','-prepost.sqlite');
  const prepost=service(new PredictionIntentSqlite(secondFile),'prepost');
  const safe=await prepost.svc.preview(actor,draft,epoch);
  await expect(prepost.svc.confirm(actor,safe.confirmationId,true,epoch,async()=>{}))
    .rejects.toMatchObject({code:'forbidden'});
  const recovered=service(new PredictionIntentSqlite(secondFile));
  expect((await recovered.svc.preview(actor,draft,epoch)).confirmationId).toMatch(/[0-9a-f-]{36}/i);
  expect(prepost.writes).not.toHaveBeenCalled();
}));

it('F08 two independent journal owners cannot reserve the same channel, and explicit safe release works',()=>withTemp(async file=>{
  const first=new PredictionIntentSqlite(file), second=new PredictionIntentSqlite(file);
  expect(first.isBlocked('123')).toBe(false);
  expect(first.reserve('123')).toBe(true);
  expect(second.reserve('123')).toBe(false);
  expect(second.isBlocked('123')).toBe(true);
  first.releaseBeforePost('123');
  expect(second.isBlocked('123')).toBe(false);
  expect(second.reserve('123')).toBe(true);
}));

it('F08 rejects unknown or corrupt journal, forbids treating it as an empty barrier',()=>withTemp(async file=>{
  await writeFile(file,Buffer.from('unknown-file-content'));
  const journal=new PredictionIntentSqlite(file);
  expect(()=>journal.isBlocked('123')).toThrow();
  expect(()=>journal.reserve('123')).toThrow();
}));

it('F08 does not rewrite unknown SQLite journal mode or application identity',()=>withTemp(async file=>{
  const foreign = new DatabaseSync(file);
  try {
    foreign.exec('PRAGMA journal_mode=WAL');
    foreign.exec('CREATE TABLE prediction_intents(broadcaster_id TEXT PRIMARY KEY)');
  } finally { foreign.close(); }
  const fence = new PredictionIntentSqlite(file);
  expect(()=>fence.reserve('123')).toThrow('PREDICTION_FENCE_FORMAT_UNKNOWN');
  const check = new DatabaseSync(file, {readOnly:true});
  try {
    expect((check.prepare('PRAGMA application_id').get() as {application_id:number}).application_id).toBe(0);
    expect((check.prepare('PRAGMA journal_mode').get() as {journal_mode:string}).journal_mode).toBe('wal');
  } finally { check.close(); }
}));

it('F08 failed persistence refuses BEFORE provider POST, even after independent restart',()=>withTemp(async file=>{
  const broken:PredictionCreationFence={
    isBlocked:()=>false, reserve:()=>{throw Error('flush uncertain');},
    releaseBeforePost:()=>{throw Error('must not release');},
  };
  const first=service(broken);
  const preview=await first.svc.preview(actor,draft,epoch);
  await expect(first.svc.confirm(actor,preview.confirmationId,true,epoch,async()=>{}))
    .rejects.toMatchObject({code:'unavailable'});
  expect(first.writes).not.toHaveBeenCalled();
  // No file written, but the unknown result does not trigger an automatic retry.
  expect(new PredictionIntentSqlite(file).isBlocked('123')).toBe(false);
  await expect(first.svc.preview(actor,draft,epoch)).rejects.toMatchObject({code:'precondition'});
}));
