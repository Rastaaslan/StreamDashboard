import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import express, { type Request } from 'express';
import { expect, it } from 'vitest';
import { RemoteAuth } from '../apps/server/src/remote-auth.js';
import { MomentsPipeline } from '../apps/server/src/streamcockpit-moments.js';
import { MomentsFileStorage } from '../apps/server/src/streamcockpit-moments-file.js';
import { createMomentsReadRouter } from '../apps/server/src/streamcockpit-moments-router.js';
import { isRemoteApiAllowed, requiredDevicePermissions } from '../apps/server/src/remote-api-policy.js';

const base = '/api/v1/streamcockpit-moments/session_1';
const input = { sessionId: 'session_1', instant: 1000, source: 'manual' as const,
  correlationId: 'local_1', title: 'Repère manuel', status: 'confirmed' as const };

async function fixture(run: (f: {
  url: string;
  auth: RemoteAuth;
  id: string;
  credential: string;
  pipeline: MomentsPipeline;
  allow: (value: boolean) => void;
  setRead: (reader: (sessionId: string) => Promise<Awaited<ReturnType<MomentsPipeline['exportObserved']>>>) => void;
}) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'sc3-moments-http-'));
  const pipeline = new MomentsPipeline(new MomentsFileStorage(join(dir, 'moments.json')));
  const auth = new RemoteAuth();
  const pair = auth.createPairing(undefined, false, ['observe']);
  const paired = auth.pair(pair.id, pair.code, 'Android');
  let host = true;
  let reader = (sessionId: string) => pipeline.exportObserved(sessionId);
  const app = express();
  app.use('/api/v1/streamcockpit-moments', createMomentsReadRouter({
    canRead(request: Request) {
      const credential = request.headers.authorization?.match(/^Device (\\S+)$/)?.[1];
      const id = credential ? auth.authenticate(credential) : null;
      return host && Boolean(id && auth.permits(id, ['observe']));
    },
    readExport: sessionId => reader(sessionId),
  }));
  const server = createServer(app);
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address() as AddressInfo;
    await run({
      url: `http://127.0.0.1:${address.port}${base}`,
      auth, id: paired.deviceId, credential: paired.credential, pipeline,
      allow: value => { host = value; },
      setRead: value => { reader = value; },
    });
  } finally {
    if (server.listening) {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
    await rm(dir, { recursive: true, force: true });
  }
}

it('F09 exports observed markers via authenticated read-only HTTP, no provider calls', async () =>
  fixture(async f => {
    const call = (url = f.url, method = 'GET', credential = f.credential) =>
      fetch(url, { method, headers: { authorization: `Device ${credential}` } });
    expect(isRemoteApiAllowed('GET', '/v1/streamcockpit-moments/session_1')).toBe(true);
    expect(isRemoteApiAllowed('HEAD', '/v1/streamcockpit-moments/session_1')).toBe(true);
    expect(requiredDevicePermissions('GET', '/v1/streamcockpit-moments/session_1', undefined)).toEqual(['observe']);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'])
      expect(isRemoteApiAllowed(method, '/v1/streamcockpit-moments/session_1')).toBe(false);

    // Never turn an absent journal into an authoritative 'no moments' result.
    expect((await call()).status).toBe(503);
    await f.pipeline.record(input);
    const response = await call();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const text = await response.text();
    expect(text).not.toContain(f.credential);
    expect(JSON.parse(text)).toMatchObject({
      sessionId: 'session_1', schemaVersion: 1, kind: 'streamcockpit-markers',
      readOnly: true, markers: [{ title: 'Repère manuel', correlationId: 'local_1' }],
    });
    const head = await call(f.url, 'HEAD');
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    expect((await call(f.url.replace('session_1', 'other'))).status).toBe(200);
    const other = await (await call(f.url.replace('session_1', 'other'))).json();
    expect(other.markers).toEqual([]);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'])
      expect((await call(f.url, method)).status).toBe(405);
  }));

it('F09 denies unauthenticated, reduced role and revoked pairing without leaking markers', () =>
  fixture(async f => {
    await f.pipeline.record(input);
    const call = (credential = f.credential) => fetch(f.url, {headers: {authorization: `Device ${credential}`}});
    expect((await call('invalid')).status).toBe(403);
    f.allow(false); expect((await call()).status).toBe(403);
    f.allow(true);
    f.auth.setPermissions(f.id, ['chat']); expect((await call()).status).toBe(403);
    f.auth.setPermissions(f.id, ['observe']); expect((await call()).status).toBe(200);
    f.auth.revoke(f.id); const denied = await call();
    expect(denied.status).toBe(403);
    expect(await denied.text()).not.toContain(input.title);
  }));

it('F09 rechecks authorization after asynchronous disk read; no stale private response', () =>
  fixture(async f => {
    await f.pipeline.record(input);
    let release!: (value: Awaited<ReturnType<MomentsPipeline['exportObserved']>>) => void;
    let started!: () => void;
    const pending = new Promise<void>(resolve => { started = resolve; });
    f.setRead(() => new Promise(resolve => { release = resolve; started(); }));
    const response = fetch(f.url, { headers: { authorization: `Device ${f.credential}` } });
    await pending;
    f.auth.revoke(f.id);
    release(await f.pipeline.exportObserved('session_1'));
    const result = await response;
    expect(result.status).toBe(403);
    expect(await result.text()).not.toContain(input.title);
  }));

it('F09 rejects malformed session ids and corrupted persisted journal without overwriting', () =>
  fixture(async f => {
    await f.pipeline.record(input);
    const ask = (suffix: string) => fetch(f.url.replace('session_1', suffix), {
      headers: { authorization: `Device ${f.credential}` },
    });
    expect((await ask('a'.repeat(129))).status).toBe(400);
    expect((await ask('invalid%2Fid')).status).toBe(400);
    f.setRead(async () => { throw new Error('secret: PRIVATE_TOKEN'); });
    const response = await ask('session_1');
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('PRIVATE_TOKEN');
  }));

it('F09 does not allow missing data, corrupt source or oversized export to masquerade as valid', () =>
  fixture(async f => {
    const request = () => fetch(f.url, { headers: { authorization: `Device ${f.credential}` } });
    f.setRead(async () => ({ schemaVersion: 1, kind: 'streamcockpit-markers', sessionId: 'foreign',
      timebase: 'unix-ms', markers: [] }));
    expect((await request()).status).toBe(503);
    f.setRead(async () => ({ schemaVersion: 1, kind: 'streamcockpit-markers', sessionId: 'session_1',
      timebase: 'unix-ms', markers: Array.from({length: 10001}, () => ({ ...input, sequence: 1 })) }));
    expect((await request()).status).toBe(503);
  }));
