import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startDashboardServer, type DashboardServerHandle } from '../apps/server/src/index.js';
import { MemorySecretStore } from '../apps/server/src/storage.js';

let server: DashboardServerHandle | undefined;
let directory = '';
afterEach(async () => { await server?.stop(); if (directory) await rm(directory, { recursive: true, force: true }); server = undefined; vi.restoreAllMocks(); });
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
function deferred<T>() { let resolve!: (value: T) => void; return { promise: new Promise<T>(done => { resolve = done; }), resolve: (value: T) => resolve(value) }; }

async function fixture(respond: (url: string, init?: RequestInit) => Response | Promise<Response>, restore = false) {
  directory = await mkdtemp(join(tmpdir(), 'streamlabs-session-'));
  const secrets = new MemorySecretStore();
  if (restore) await secrets.setStreamlabsOAuth({ clientId: 'client', clientSecret: 'secret', accessToken: 'access-previous' });
  const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => respond(String(input), init));
  const transport = { connect: vi.fn(async (_token: string) => async () => {}) };
  server = await startDashboardServer({ port: 0, dataDir: directory, secretStore: secrets, streamlabsTransport: transport, streamlabsFetch: request as typeof fetch, obsEnabled: false, logger: { info() {}, warn() {}, error() {} } });
  const call = (path: string, method = 'GET', body?: unknown) => fetch(server!.url + path, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const authorize = async () => {
    const response = await call('/api/v1/supports/streamlabs/oauth/start', 'POST');
    expect(response.status).toBe(200);
    return new URL((await response.json()).authorizationUrl).searchParams.get('state')!;
  };
  if (!restore) {
    await server.providersReady;
    expect((await call('/api/v1/supports/streamlabs/oauth/config', 'PUT', { clientId: 'client', clientSecret: 'secret' })).status).toBe(200);
  }
  return { secrets, request, transport, call, authorize };
}

describe('Streamlabs connection changes supersede in-flight authorization', () => {
  it('does not reconnect after disconnect while an OAuth response is pending', async () => {
    const response = deferred<Response>();
    const f = await fixture(url => url.endsWith('/token') && !url.endsWith('/socket/token') ? response.promise : json({ socket_token: 'late-socket' }));
    const callback = f.call('/api/v1/streamlabs/oauth/callback?code=old&state=' + encodeURIComponent(await f.authorize()));
    await vi.waitFor(() => expect(f.request).toHaveBeenCalledTimes(1));
    expect((await f.call('/api/v1/supports/streamlabs/config', 'DELETE')).status).toBe(200);
    response.resolve(json({ access_token: 'late-access' }));
    expect((await callback).status).toBe(400);
    expect(await f.secrets.getStreamlabsToken()).toBe('');
    expect(await f.secrets.getStreamlabsOAuth()).toEqual({ clientId: 'client', clientSecret: 'secret' });
    expect(f.transport.connect).not.toHaveBeenCalled();
    expect(f.request).toHaveBeenCalledTimes(1);
  });

  it('keeps a manually replaced token when the older OAuth request completes', async () => {
    const response = deferred<Response>();
    const f = await fixture(url => url.endsWith('/socket/token') ? json({ socket_token: 'late-socket' }) : response.promise);
    const callback = f.call('/api/v1/streamlabs/oauth/callback?code=old&state=' + encodeURIComponent(await f.authorize()));
    await vi.waitFor(() => expect(f.request).toHaveBeenCalledTimes(1));
    expect((await f.call('/api/v1/supports/streamlabs/config', 'PUT', { token: 'manual-socket' })).status).toBe(200);
    response.resolve(json({ access_token: 'late-access' }));
    expect((await callback).status).toBe(400);
    expect(await f.secrets.getStreamlabsToken()).toBe('manual-socket');
    expect(f.transport.connect.mock.calls.map(call => call[0])).toEqual(['manual-socket']);
  });

  it('retains the newest authorization when the older exchange returns last', async () => {
    const oldResponse = deferred<Response>();
    const f = await fixture((url, init) => {
      if (url.endsWith('/socket/token')) return json({ socket_token: new Headers(init?.headers).get('authorization') === 'Bearer access-new' ? 'socket-new' : 'socket-old' });
      return JSON.parse(String(init?.body)).code === 'old' ? oldResponse.promise : json({ access_token: 'access-new' });
    });
    const oldCallback = f.call('/api/v1/streamlabs/oauth/callback?code=old&state=' + encodeURIComponent(await f.authorize()));
    await vi.waitFor(() => expect(f.request).toHaveBeenCalledTimes(1));
    expect((await f.call('/api/v1/streamlabs/oauth/callback?code=new&state=' + encodeURIComponent(await f.authorize()))).status).toBe(200);
    oldResponse.resolve(json({ access_token: 'access-old' }));
    expect((await oldCallback).status).toBe(400);
    expect(await f.secrets.getStreamlabsToken()).toBe('socket-new');
    expect((await f.secrets.getStreamlabsOAuth())?.accessToken).toBe('access-new');
    expect(f.transport.connect.mock.calls.map(call => call[0])).toEqual(['socket-new']);
  });

  it('waits for an already-started secret write before finishing disconnect', async () => {
    const disk = deferred<void>();
    const f = await fixture(url => json(url.endsWith('/socket/token') ? { socket_token: 'socket' } : { access_token: 'access' }));
    const write = f.secrets.setStreamlabsOAuth.bind(f.secrets);
    const writes = vi.spyOn(f.secrets, 'setStreamlabsOAuth').mockImplementation(async value => { if (value.accessToken) await disk.promise; await write(value); });
    const callback = f.call('/api/v1/streamlabs/oauth/callback?code=old&state=' + encodeURIComponent(await f.authorize()));
    await vi.waitFor(() => expect(writes).toHaveBeenCalledTimes(1));
    const disconnect = f.call('/api/v1/supports/streamlabs/config', 'DELETE');
    // Seeing the DELETE reach the route must invalidate the callback even if
    // its secure-store write has already begun. Release it on the next turn.
    await new Promise(resolve => setTimeout(resolve, 30));
    disk.resolve();
    expect((await disconnect).status).toBe(200);
    expect((await callback).status).toBe(400);
    expect(await f.secrets.getStreamlabsToken()).toBe('');
    expect(await f.secrets.getStreamlabsOAuth()).toEqual({ clientId: 'client', clientSecret: 'secret' });
    expect(f.transport.connect).not.toHaveBeenCalled();
  });

  it('does not consume a valid OAuth attempt for an unrelated callback state', async () => {
    const f = await fixture(url => json(url.endsWith('/socket/token') ? { socket_token: 'socket' } : { access_token: 'access' }));
    const state = await f.authorize();
    expect((await f.call('/api/v1/streamlabs/oauth/callback?code=wrong&state=unrelated')).status).toBe(400);
    expect(f.request).not.toHaveBeenCalled();
    expect((await f.call('/api/v1/streamlabs/oauth/callback?code=right&state=' + encodeURIComponent(state))).status).toBe(200);
    expect(await f.secrets.getStreamlabsToken()).toBe('socket');
  });

  it('does not restore startup credentials after disconnecting in the UI', async () => {
    const response = deferred<Response>();
    const f = await fixture(() => response.promise, true);
    await vi.waitFor(() => expect(f.request).toHaveBeenCalledTimes(1));
    expect((await f.call('/api/v1/supports/streamlabs/config', 'DELETE')).status).toBe(200);
    response.resolve(json({ socket_token: 'restored-too-late' }));
    await server!.providersReady;
    expect(await f.secrets.getStreamlabsToken()).toBe('');
    expect(await f.secrets.getStreamlabsOAuth()).toEqual({ clientId: 'client', clientSecret: 'secret' });
    expect(f.transport.connect).not.toHaveBeenCalled();
  });
});
