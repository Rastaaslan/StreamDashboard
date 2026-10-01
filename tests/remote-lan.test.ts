import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { request } from 'node:http';
import { WebSocket } from 'ws';
import { RemoteAuth } from '../apps/server/src/remote-auth.js';
import { startDashboardServer, type DashboardServerHandle } from '../apps/server/src/index.js';

const interfaces = vi.hoisted(() => ({ extra: {} as Record<string, any> }));
vi.mock('node:os', async importOriginal => {
  const original = await importOriginal<typeof import('node:os')>();
  return { ...original, networkInterfaces: () => ({ ...original.networkInterfaces(), ...interfaces.extra }) };
});

const logger = { info() {}, warn() {}, error() {} };
const lan = Object.values(networkInterfaces()).flat().find(value => value?.family === 'IPv4' && !value.internal)!.address;
const json = { 'content-type': 'application/json' };
function httpStatus(url: string, headers: Record<string, string>) {
  return new Promise<number>((resolve, reject) => {
    const req = request(url, { headers }, response => { response.resume(); resolve(response.statusCode!); });
    req.on('error', reject); req.end();
  });
}
function socketState(url: string, ticket: string) {
  return new Promise<any>((resolve, reject) => {
    const ws = new WebSocket(`${url.replace('http:', 'ws:')}/ws/v1?ticket=${ticket}`);
    ws.on('error', reject);
    ws.on('message', data => { const value = JSON.parse(String(data)); if (value.type === 'state.updated') { ws.close(); resolve(value.data); } });
  });
}
function rejectedSocket(url: string, ticket = '', headers = {}) {
  return new Promise<number>((resolve, reject) => {
    const ws = new WebSocket(`${url.replace('http:', 'ws:')}/ws/v1?ticket=${ticket}`, { headers });
    ws.on('open', () => { ws.close(); reject(new Error('Unauthorized socket opened')); });
    ws.on('unexpected-response', (_request, response) => { response.resume(); ws.terminate(); resolve(response.statusCode!); });
    ws.on('error', () => {});
  });
}

describe('remote authentication lifetime', () => {
  it('expires pending codes and single-use tickets, preserves revocation after restart', () => {
    let now = 1000;
    const auth = new RemoteAuth(() => now);
    const expired = auth.createPairing(10);
    now += 10;
    expect(() => auth.pair(expired.id, expired.code, 'phone')).toThrow(/expiré/);
    const pairing = auth.createPairing();
    const restored = new RemoteAuth(() => now, [], auth.serializePairings());
    const device = restored.pair(pairing.id, pairing.code, 'phone');
    expect(() => restored.pair(pairing.id, pairing.code, 'phone')).toThrow();
    const ticket = restored.createWsTicket(device.credential, 10);
    now += 10;
    expect(restored.consumeWsTicket(ticket.ticket)).toBeNull();
    const fresh = restored.createWsTicket(device.credential);
    expect(restored.consumeWsTicket(fresh.ticket)).toBe(device.deviceId);
    expect(restored.consumeWsTicket(fresh.ticket)).toBeNull();
    const revoked = restored.createWsTicket(device.credential);
    restored.revoke(device.deviceId);
    expect(restored.consumeWsTicket(revoked.ticket)).toBeNull();
    expect(new RemoteAuth(() => now, restored.serialize()).authenticate(device.credential)).toBeNull();
    expect(JSON.stringify(restored.serialize())).not.toContain(device.credential);
  });
});

describe('LAN HTTP and WebSocket integration', () => {
  let server: DashboardServerHandle | undefined;
  let dataDir = '';
  afterEach(async () => { interfaces.extra = {}; await server?.stop(); if (dataDir) await rm(dataDir, { recursive: true, force: true }); });
  const boot = async () => {
    server = await startDashboardServer({ port: 0, host: '0.0.0.0', remoteEnabled: true, dataDir, logger });
    const port = new URL(server.url).port;
    return { local: `http://127.0.0.1:${port}`, remote: `http://${lan}:${port}` };
  };
  it('pairs across restart, reconnects with redacted state, rejects replay and revoked credentials', async () => {
    dataDir = await mkdtemp(path.resolve('.remote-lan-test-'));
    let urls = await boot();
    const pairing = await fetch(`${urls.local}/api/v1/remote/pairing`, { method: 'POST' }).then(r => r.json());
    const stored = await readFile(path.join(dataDir, 'dashboard.json'), 'utf8');
    expect(stored).not.toContain(pairing.code);
    await server!.stop(); urls = await boot();
    const pairResponse = await fetch(`${urls.remote}/api/v1/remote/pair`, { method: 'POST', headers: json, body: JSON.stringify(pairing) });
    expect(pairResponse.status).toBe(201);
    const device = await pairResponse.json();
    const headers = { ...json, authorization: `Device ${device.credential}` };
    const first = await fetch(`${urls.remote}/api/v1/state`, { headers }).then(r => r.json());
    expect(first.settings.obsUrl).toBeUndefined();
    const ticket = await fetch(`${urls.remote}/api/v1/remote/ws-ticket`, { method: 'POST', headers }).then(r => r.json());
    expect((await socketState(urls.remote, ticket.ticket)).serverInstanceId).toBe(first.serverInstanceId);
    expect(await rejectedSocket(urls.remote, ticket.ticket)).toBe(403);
    await server!.stop(); urls = await boot();
    const next = await fetch(`${urls.remote}/api/v1/state`, { headers }).then(r => r.json());
    expect(next.serverInstanceId).not.toBe(first.serverInstanceId);
    expect(next.obs).toHaveProperty('connected');
    const newTicket = await fetch(`${urls.remote}/api/v1/remote/ws-ticket`, { method: 'POST', headers }).then(r => r.json());
    expect((await socketState(urls.remote, newTicket.ticket)).serverInstanceId).toBe(next.serverInstanceId);
    expect((await fetch(`${urls.remote}/api/v1/remote/pair`, { method: 'POST', headers: json, body: JSON.stringify(pairing) })).status).toBe(400);
    const liveTicket = await fetch(`${urls.remote}/api/v1/remote/ws-ticket`, { method: 'POST', headers }).then(r => r.json());
    const active = new WebSocket(`${urls.remote.replace('http:', 'ws:')}/ws/v1?ticket=${liveTicket.ticket}`);
    await new Promise<void>((resolve, reject) => { active.once('open', resolve); active.once('error', reject); });
    const closed = new Promise(resolve => active.once('close', resolve));
    expect((await fetch(`${urls.local}/api/v1/remote/devices/${device.deviceId}`, { method: 'DELETE' })).status).toBe(204);
    await closed;
    await server!.stop(); urls = await boot();
    expect((await fetch(`${urls.remote}/api/v1/state`, { headers })).status).toBe(401);
    expect((await fetch(`${urls.remote}/api/v1/remote/ws-ticket`, { method: 'POST', headers })).status).toBe(401);
  });

  it('refreshes LAN diagnostics and accepted hosts when Wi-Fi is replaced by Ethernet', async () => {
    dataDir = await mkdtemp(path.resolve('.remote-lan-test-'));
    const urls = await boot();
    const port = new URL(urls.local).port;
    interfaces.extra = { wifi: [{ family: 'IPv4', internal: false, address: '192.168.10.8' }], ethernet: [{ family: 'IPv4', internal: false, address: '10.0.0.8' }] };
    const info = () => fetch(`${urls.local}/api/v1/remote/info`).then(r => r.json());
    expect((await info()).urls).toEqual(expect.arrayContaining([`http://192.168.10.8:${port}/mobile/`, `http://10.0.0.8:${port}/mobile/`]));
    expect(await httpStatus(`${urls.local}/api/v1/health`, { host: `192.168.10.8:${port}` })).toBe(200);
    interfaces.extra = { ethernet: [{ family: 'IPv4', internal: false, address: '10.0.0.8' }] };
    expect((await info()).urls).not.toContain(`http://192.168.10.8:${port}/mobile/`);
    expect(await httpStatus(`${urls.local}/api/v1/health`, { host: `192.168.10.8:${port}` })).toBe(403);
    expect(await httpStatus(`${urls.local}/api/v1/health`, { host: `10.0.0.8:${port}` })).toBe(200);
  });

  it('denies sensitive endpoints without credentials and rejects DNS rebinding / foreign origins', async () => {
    dataDir = await mkdtemp(path.resolve('.remote-lan-test-'));
    const urls = await boot();
    for (const [method, route] of [['GET', 'state'], ['GET', 'profile'], ['GET', 'connections'], ['POST', 'commands'], ['POST', 'companion/sync'], ['POST', 'remote/ws-ticket'], ['PUT', 'settings']]) {
      expect((await fetch(`${urls.remote}/api/v1/${route}`, { method, headers: json, ...(method === 'GET' ? {} : { body: '{}' }) })).status).toBe(401);
    }
    for (const route of ['devices', 'info']) expect((await fetch(`${urls.remote}/api/v1/remote/${route}`)).status).toBe(403);
    expect(await rejectedSocket(urls.remote)).toBe(403);
    expect(await httpStatus(`${urls.local}/api/v1/state`, { host: 'attacker.example', origin: 'http://attacker.example' })).toBe(403);
    expect((await fetch(`${urls.local}/api/v1/state`, { headers: { origin: 'http://attacker.example' } })).status).toBe(403);
    expect(await rejectedSocket(urls.local, '', { host: 'attacker.example', origin: 'http://attacker.example' })).toBe(403);
  });
});
