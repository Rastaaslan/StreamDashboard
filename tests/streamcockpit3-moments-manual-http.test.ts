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
  setReader: (reader: ((correlationId: string) => ReturnType<MomentsPipeline['lookupHostManual']>) | undefined) => void;
}) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'sc3-manual-http-'));
  const pipeline = new MomentsPipeline(new MomentsSqliteStorage(join(dir, 'journal.sqlite')));
  const auth = new RemoteAuth();
  const pairing = auth.createPairing(undefined, false, ['observe', 'clips']);
  const paired = auth.pair(pairing.id, pairing.code, 'Android test');
  let session: string | undefined = 'session_1', host = true, time = 1_800_000_000_000;
  let writer: ((input: { sessionId: string; correlationId: string; title: string; instant: number }) => ReturnType<MomentsPipeline['recordHostManual']>) | undefined;
  let reader: ((correlationId: string) => ReturnType<MomentsPipeline['lookupHostManual']>) | undefined;
  const app = express();
  app.use(express.json({ limit: '4kb' }));
  app.use('/api/v1/streamcockpit-moments/manual', createMomentsManualRouter({
    authorize(request: Request) {
      const credential = request.headers.authorization?.match(/^Device (\S+)$/)?.[1];
      const id = credential ? auth.authenticate(credential) : null;
      return host && id && auth.permits(id, ['observe', 'clips']) ? id : undefined;
    },
    activeSessionId: async () => session,
    recordManual: input => (writer ?? (value => pipeline.recordHostManual(value)))(input),
    lookupManual: correlationId => (reader ?? (id => pipeline.lookupHostManual(id)))(correlationId),
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
      setReader: value => {reader = value;},
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
  expect(source).toContain("app.use('/api/v1/streamcockpit-moments/manual'");
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

const statusUrl = (url: string, id = requestId) => url.replace('/manual/add', '/manual/status/' + id);

it('F09 read-only status resolves a committed-but-unacknowledged write without a second POST', () => fixture(async f => {
  expect(isRemoteApiAllowed('GET', '/v1/streamcockpit-moments/manual/status/' + requestId)).toBe(true);
  expect(isRemoteApiAllowed('POST', '/v1/streamcockpit-moments/manual/status/' + requestId)).toBe(false);
  expect(requiredDevicePermissions('GET', '/v1/streamcockpit-moments/manual/status/' + requestId, {})).toEqual(['observe','clips']);
  const absent = await call(statusUrl(f.url), f.credential, undefined, 'GET');
  expect(absent.status).toBe(503);
  expect((await absent.json()).error.code).toBe('MOMENTS_NOT_OBSERVED');
  let writes = 0;
  f.setWriter(async input => {
    writes++;
    await f.pipeline.recordHostManual(input);
    throw new Error('response lost after COMMIT');
  });
  const lost = await call(f.url, f.credential);
  expect(lost.status).toBe(503);
  expect((await lost.json()).error.code).toBe('MOMENTS_WRITE_UNCERTAIN');
  const check = await call(statusUrl(f.url), f.credential, undefined, 'GET');
  expect(check.status).toBe(200);
  expect(check.headers.get('cache-control')).toContain('no-store');
  const result = await check.json();
  expect(result).toEqual({schemaVersion:1,kind:'streamcockpit-manual-marker-status',
    status:'confirmed',sessionId:'session_1',instant:1800000000000,sequence:1,source:'manual'});
  expect(JSON.stringify(result)).not.toContain('Premier repère');
  expect(writes).toBe(1);
  expect((await f.pipeline.exportObserved('session_1'))?.markers).toHaveLength(1);
}));

it('F09 status hides other devices, requires clips and never treats not-found as a safe retry', () => fixture(async f => {
  expect((await call(f.url, f.credential)).status).toBe(201);
  const noMatch = await call(statusUrl(f.url,'9c712f02-0339-419b-820a-8cff8aff94e2'), f.credential, undefined, 'GET');
  expect(noMatch.status).toBe(200);
  expect(await noMatch.json()).toEqual({schemaVersion:1,kind:'streamcockpit-manual-marker-status',status:'not_found_at_read'});
  expect((await call(statusUrl(f.url), 'invalid', undefined, 'GET')).status).toBe(403);
  const second = f.auth.createPairing(undefined, false, ['observe','clips']);
  const device = f.auth.pair(second.id,second.code,'Other Android');
  expect((await (await call(statusUrl(f.url),device.credential,undefined,'GET')).json()).status).toBe('not_found_at_read');
  f.auth.setPermissions(f.id, ['observe']);
  expect((await call(statusUrl(f.url),f.credential,undefined,'GET')).status).toBe(403);
  f.auth.revoke(f.id);
  expect((await call(statusUrl(f.url),f.credential,undefined,'GET')).status).toBe(403);
  expect((await call(statusUrl(f.url,'malformed'),device.credential,undefined,'GET')).status).toBe(400);
  expect((await call(statusUrl(f.url),device.credential,{},'POST')).status).toBe(405);
}));

it('F09 status rechecks authorization after disk read and suppresses revoked receipts', () => fixture(async f => {
  expect((await call(f.url, f.credential)).status).toBe(201);
  let started!: () => void, release!: () => void;
  const began = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  f.setReader(async correlationId => {
    const result = await f.pipeline.lookupHostManual(correlationId);
    started(); await gate; return result;
  });
  const pending = call(statusUrl(f.url), f.credential, undefined, 'GET');
  await began;
  f.auth.revoke(f.id);release();
  const response = await pending;
  expect(response.status).toBe(403);
  const body = await response.text();
  expect(body).not.toContain('session_1');
  expect(body).not.toContain('1800000000000');
}));

it('F09 status prioritizes revocation even after a failed or unreadable journal', () => fixture(async f => {
  let started!: () => void, release!: () => void;
  const began = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  f.setReader(async () => { started(); await gate; throw new Error('secret from disk'); });
  const pending = call(statusUrl(f.url), f.credential, undefined, 'GET');
  await began;
  f.auth.revoke(f.id);release();
  const response = await pending;
  expect(response.status).toBe(403);
  expect(await response.text()).not.toContain('secret from disk');
}));
