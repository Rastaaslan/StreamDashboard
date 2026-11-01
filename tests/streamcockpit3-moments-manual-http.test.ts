import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import express, { type Request } from 'express';
import { expect, it } from 'vitest';
import { RemoteAuth } from '../apps/server/src/remote-auth.js';
import { MomentsPipeline } from '../apps/server/src/streamcockpit-moments.js';
import { MomentsSqliteStorage } from '../apps/server/src/streamcockpit-moments-sqlite.js';
import { createMomentsManualRouter } from '../apps/server/src/streamcockpit-moments-manual-router.js';
import { isRemoteApiAllowed, requiredDevicePermissions } from '../apps/server/src/remote-api-policy.js';

const requestId = 'b467019c-3fbb-4ccb-a499-3c459d5ad173';
async function fixture(run: (f: {
  url: string; auth: RemoteAuth; id: string; credential: string; pipeline: MomentsPipeline;
  setSession: (id: string | undefined) => void;
  setHost: (value: boolean) => void;
  setTime: (value: number) => void;
  setWriter: (writer: ((input: {sessionId: string; correlationId: string; title: string; instant: number}) => ReturnType<MomentsPipeline['recordHostManual']>) | undefined) => void;
}) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'sc3-manual-http-'));
  const pipeline = new MomentsPipeline(new MomentsSqliteStorage(join(dir, 'journal.sqlite')));
  const auth = new RemoteAuth();
  const pairing = auth.createPairing(undefined, false, ['observe', 'clips']);
  const paired = auth.pair(pairing.id, pairing.code, 'Android test');
  let session: string | undefined = 'session_1', host = true, time = 1_800_000_000_000;
  let writer: ((input: { sessionId: string; correlationId: string; title: string; instant: number }) => ReturnType<MomentsPipeline['recordHostManual']>) | undefined;
  const app = express();
  app.use(express.json({ limit: '4kb' }));
  app.use('/api/v1/streamcockpit-moments/manual/add', createMomentsManualRouter({
    authorize(request: Request) {
      const credential = request.headers.authorization?.match(/^Device (\S+)$/)?.[1];
      const id = credential ? auth.authenticate(credential) : null;
      return host && id && auth.permits(id, ['observe', 'clips']) ? id : undefined;
    },
    activeSessionId: async () => session,
    recordManual: input => (writer ?? (value => pipeline.recordHostManual(value)))(input),
    now: () => time,
  }));
  const server = createServer(app);
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/streamcockpit-moments/manual/add`;
    await run({ url, auth, id: paired.deviceId, credential: paired.credential, pipeline,
      setSession: id => {session = id;}, setHost: value => {host = value;},
      setTime: value => {time = value;}, setWriter: value => {writer = value;},
    });
  } finally {
    if (server.listening) {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
    await rm(dir, {recursive: true, force: true});
  }
}
function call(url: string, credential: string, body: unknown = {requestId,title:'Premier repère'}, method = 'POST') {
  return fetch(url, { method, headers: { Authorization: 'Device ' + credential, 'Content-Type': 'application/json' },
    body: method === 'POST' ? JSON.stringify(body) : undefined });
}

it('F09 authorizes only explicit clipped paired manual writes, no guessed live or provider action', () => fixture(async f => {
  expect(isRemoteApiAllowed('POST', '/v1/streamcockpit-moments/manual/add')).toBe(true);
  expect(requiredDevicePermissions('POST', '/v1/streamcockpit-moments/manual/add', {})).toEqual(['observe', 'clips']);
  expect(isRemoteApiAllowed('PUT', '/v1/streamcockpit-moments/manual/add')).toBe(false);
  expect((await call(f.url, f.credential, undefined, 'GET')).status).toBe(405);
  f.setSession(undefined);
  expect((await call(f.url, f.credential)).status).toBe(409);
  expect(await f.pipeline.listObservedSessions()).toBeUndefined();
  f.setSession('session_1');
  f.setHost(false);
  expect((await call(f.url, f.credential)).status).toBe(403);
  f.setHost(true);
  expect((await call(f.url, 'bad-token')).status).toBe(403);
  f.auth.setPermissions(f.id, ['observe']);
  expect((await call(f.url, f.credential)).status).toBe(403);
  f.auth.setPermissions(f.id, ['observe', 'clips']);
  for (const invalid of [null,{}, {requestId:'wrong',title:'Ok'}, {requestId,title:'http://bad.test'}, {requestId,title:'ok',sessionId:'spoof'}])
    expect((await call(f.url, f.credential, invalid)).status).toBe(400);
  expect(await f.pipeline.listObservedSessions()).toBeUndefined();
  const source = readFileSync('apps/server/src/index.ts', 'utf8');
  expect(source).toContain("app.use('/api/v1/streamcockpit-moments/manual/add'");
  expect(source).toContain('obs.state.streamingKnown !== true');
  expect(source).toContain('findTrackedDraft()');
}));

it('F09 persists a manual marker on Windows and replays exact request without second moment or time drift', () => fixture(async f => {
  const first = await call(f.url, f.credential);
  expect(first.status).toBe(201);
  expect(first.headers.get('cache-control')).toBe('no-store');
  const receipt = await first.json();
  expect(receipt).toMatchObject({kind:'streamcockpit-manual-marker', outcome:'created',
    sessionId:'session_1', instant:1800000000000, sequence:1, source:'manual',status:'observed'});
  expect(receipt.correlationId).toMatch(/^[0-9a-f]{64}$/);
  f.setTime(1_800_000_900_000);
  const again = await call(f.url, f.credential);
  expect(again.status).toBe(200);
  expect((await again.json()).correlationId).toBe(receipt.correlationId);
  expect((await f.pipeline.exportObserved('session_1'))?.markers).toMatchObject([
    {title:'Premier repère', instant:1800000000000, source:'manual',status:'observed'},
  ]);
  expect((await call(f.url, f.credential, {requestId,title:'Autre texte'})).status).toBe(409);
  f.setSession('session_2');
  expect((await call(f.url, f.credential)).status).toBe(409);
  expect((await f.pipeline.listObservedSessions())?.length).toBe(1);
}));

it('F09 returns no private receipt after revocation during commit, but never pretends write was rolled back', () => fixture(async f => {
  let release!: () => void, started!: () => void;
  const began = new Promise<void>(resolve => {started = resolve;});
  const gate = new Promise<void>(resolve => {release = resolve;});
  f.setWriter(async input => {
    await f.pipeline.recordHostManual(input);
    started();
    await gate;
    return {moment:(await f.pipeline.exportObserved(input.sessionId))!.markers[0], outcome:'created'};
  });
  const pending = call(f.url, f.credential);
  await began;
  f.auth.revoke(f.id);release();
  const response = await pending;
  expect(response.status).toBe(403);
  expect(await response.text()).not.toContain('Premier repère');
  expect((await f.pipeline.exportObserved('session_1'))?.markers).toHaveLength(1);
}));

it('F09 fails closed after uncertain SQLite result; never reruns or echoes backend secrets', () => fixture(async f => {
  let writes = 0;
  f.setWriter(async () => { writes++;throw new Error('Bearer SUPER_SECRET'); });
  const response = await call(f.url, f.credential);
  expect(response.status).toBe(503);
  const text = await response.text();
  expect(text).toContain('MOMENTS_WRITE_UNCERTAIN');
  expect(text).not.toContain('SUPER_SECRET');
  expect(writes).toBe(1);
  expect(await f.pipeline.listObservedSessions()).toBeUndefined();
}));
