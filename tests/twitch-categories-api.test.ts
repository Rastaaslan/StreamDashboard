import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { startDashboardServer, type DashboardServerHandle } from '../apps/server/src/index.js';
import { MemorySecretStore } from '../apps/server/src/storage.js';

let server: DashboardServerHandle | undefined;
let folder = '';
afterEach(async () => {
  await server?.stop(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (folder) await rm(folder, { recursive: true, force: true });
});

it('routes the UI q query, the older query alias and a stored ID through real Twitch client reads', async () => {
  folder = await mkdtemp(join(tmpdir(), 'twitch-categories-'));
  const secrets = new MemorySecretStore();
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  server = await startDashboardServer({ port: 0, dataDir: folder, secretStore: secrets, logger });
  await server.stop();
  const file = join(folder, 'dashboard.json');
  const local = JSON.parse(await readFile(file, 'utf8'));
  local.twitch = { broadcasterId: '42', userName: 'streamer', displayName: 'Streamer' };
  await writeFile(file, JSON.stringify(local));
  await secrets.setTwitchTokens({ accessToken: 'private-test-access', refreshToken: '' });
  const nativeFetch = globalThis.fetch;
  const providerCalls: string[] = [];
  const minecraft = { id: '27471', name: 'Minecraft', box_art_url: 'https://static-cdn.jtvnw.net/ttv-boxart/27471.jpg' };
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.protocol !== 'https:') return nativeFetch(input, init);
    providerCalls.push(url.pathname + url.search);
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'retry-after': '1' } });
    if (url.pathname.endsWith('/validate')) return json({ client_id: 'client', user_id: '42', scopes: [] });
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer private-test-access');
    expect(init?.method ?? 'GET').toBe('GET');
    if (url.pathname === '/helix/channels') return json({ data: [{ title: 'Title', game_id: '460637', game_name: 'Dead Island 2', tags: [] }] });
    if (url.pathname === '/helix/streams') return json({ data: [] });
    if (url.pathname === '/helix/search/categories') {
      if (url.searchParams.get('query') === 'Failure') return json({ message: 'private-test-access' }, 429);
      return json({ data: url.searchParams.get('query') === 'Minecraft' ? [minecraft] : [] });
    }
    if (url.pathname === '/helix/games') return json({ data: url.searchParams.get('id') === '460637' ? [{ id: '460637', name: 'Dead Island 2' }] : [] });
    throw new Error('Unexpected provider request');
  }));
  server = await startDashboardServer({ port: 0, dataDir: folder, secretStore: secrets, twitchClientId: 'client', logger });
  await server.providersReady;
  const get = async (query: string) => {
    const response = await nativeFetch(server!.url + '/api/v1/twitch/categories?' + query);
    const text = await response.text();
    expect(text).not.toContain('private-test-access');
    return { status: response.status, body: JSON.parse(text) };
  };
  expect(await get('q=Minecraft')).toEqual({ status: 200, body: [minecraft] });
  expect(await get('query=Minecraft')).toEqual({ status: 200, body: [minecraft] });
  expect(await get('q=%20Minecraft%20&query=wrong')).toEqual({ status: 200, body: [minecraft] });
  expect(await get('id=460637')).toEqual({ status: 200, body: [{ id: '460637', name: 'Dead Island 2' }] });
  expect(await get('id=123')).toEqual({ status: 200, body: [] });
  const before = providerCalls.length;
  expect((await get('id=460637%26q%3DMinecraft')).status).toBe(400);
  expect(await get('q=')).toEqual({ status: 200, body: [] });
  expect(providerCalls).toHaveLength(before);
  expect((await get('q=Failure')).status).toBe(429);
  expect(providerCalls.filter(url => url.startsWith('/helix/search/categories?'))).toEqual([
    '/helix/search/categories?query=Minecraft&first=20',
    '/helix/search/categories?query=Minecraft&first=20',
    '/helix/search/categories?query=Minecraft&first=20',
    '/helix/search/categories?query=Failure&first=20',
  ]);
  expect(JSON.stringify(logger.error.mock.calls)).not.toContain('private-test-access');
});
