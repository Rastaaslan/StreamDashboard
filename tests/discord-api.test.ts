import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startDashboardServer, type DashboardServerHandle } from '../apps/server/src/index.js';

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
let server: DashboardServerHandle | undefined; let folder = '';
afterEach(async () => { await server?.stop(); if (folder) await rm(folder, { recursive: true, force: true }); server = undefined; });

describe('API Discord', () => {
  it('garde le token hors état, valide la destination et déduplique deux posts concurrents', async () => {
    folder = await mkdtemp(join(tmpdir(), 'streamdashboard-discord-'));
    const discordFetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/users/@me')) return Response.json({ id: '9', username: 'Bot' });
      if (url.endsWith('/users/@me/guilds')) return Response.json([{ id: '1', name: 'Camp', permissions: 'secret' }]);
      if (url.endsWith('/guilds/1/channels')) return Response.json([{ id: '2', name: 'planning', type: 0 }, { id: '3', name: 'vocal', type: 2 }]);
      if (url.endsWith('/channels/2/messages') && init?.method === 'POST') return Response.json({ id: '42' });
      return Response.json({}, { status: 404 });
    });
    server = await startDashboardServer({ port: 0, dataDir: folder, discordFetch: discordFetch as any });
    const json = async (path: string, method = 'GET', body?: unknown) => fetch(`${server!.url}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    expect((await json('/api/v1/discord/token', 'PUT', { token: 'private-token' })).status).toBe(200);
    const state = await (await json('/api/v1/state')).json(); expect(JSON.stringify(state)).not.toContain('private-token'); expect(state.discord.configured).toBe(true);
    expect(await (await json('/api/v1/discord/guilds')).json()).toEqual([{ id: '1', name: 'Camp' }]);
    expect(await (await json('/api/v1/discord/guilds/1/channels')).json()).toEqual([{ id: '2', name: 'planning', type: 0 }]);
    expect((await json('/api/v1/discord/settings', 'PUT', { guildId: '1', channelId: '2', defaultMessage: 'Planning' })).status).toBe(200);
    const body = { imageBase64: png.toString('base64'), filename: '../../planning.png', message: 'Planning' };
    const [left, right] = await Promise.all([json('/api/v1/discord/planning', 'POST', body), json('/api/v1/discord/planning', 'POST', body)]);
    expect(left.status).toBe(201); expect(right.status).toBe(201);
    expect(discordFetch.mock.calls.filter(call => String(call[0]).endsWith('/channels/2/messages'))).toHaveLength(1);
  });

  it('refuse faux PNG, message trop long et URL distante', async () => {
    folder = await mkdtemp(join(tmpdir(), 'streamdashboard-discord-invalid-'));
    server = await startDashboardServer({ port: 0, dataDir: folder });
    for (const body of [{ imageBase64: Buffer.from('fake').toString('base64'), filename: 'x.png', channelId: '2' }, { imageUrl: 'https://evil.test/image', channelId: '2' }, { imageBase64: png.toString('base64'), filename: 'x.png', channelId: '2', message: 'x'.repeat(2001) }]) {
      expect((await fetch(`${server.url}/api/v1/discord/planning`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).status).toBe(400);
    }
  });
});
