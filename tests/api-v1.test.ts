import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { startDashboardServer, type DashboardServerHandle } from '../apps/server/src/index.js';

let dashboard: DashboardServerHandle | undefined; let dataDir = '';
afterEach(async () => { if (dashboard) await dashboard.stop(); if (dataDir) await rm(dataDir, { recursive: true, force: true }); dashboard = undefined; });
async function start() { dataDir = await mkdtemp(path.join(os.tmpdir(), 'streamdashboard-api-')); dashboard = await startDashboardServer({ port: 0, dataDir, logger: { info() {}, warn() {}, error() {} } }); return dashboard; }

describe('API publique v1', () => {
  it('annonce protocole, capacités et état sans secrets', async () => {
    const app = await start();
    const capabilities = await fetch(`${app.url}/api/v1/capabilities`).then(r => r.json());
    const stateText = await fetch(`${app.url}/api/v1/state`).then(r => r.text());
    expect(capabilities).toMatchObject({ protocolVersion: 1, accessMode: 'desktop-local' });
    expect(stateText).not.toMatch(/accessToken|refreshToken|deviceCode|obsPassword\"/);
    const event = await new Promise<string>((resolve, reject) => { const ws = new WebSocket(app.url.replace('http:', 'ws:') + '/ws/v1'); ws.on('message', data => { const text = data.toString(); if (text.includes('state.updated')) { ws.close(); resolve(text); } }); ws.on('error', reject); });
    expect(event).not.toMatch(/accessToken|refreshToken|deviceCode|obsPassword\"/);
  });

  it('valide une commande distante avant le bus unique', async () => {
    const app = await start();
    const invalid = await fetch(`${app.url}/api/v1/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'obs.volume', input: '', volume: 'fort' }) });
    expect(invalid.status).toBe(400);
    const dangerous = await fetch(`${app.url}/api/v1/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'timer.reset', shell: 'cmd.exe' }) });
    expect(dangerous.status).toBe(400);
    const valid = await fetch(`${app.url}/api/v1/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'timer.add', seconds: 10 }) });
    expect(await valid.json()).toMatchObject({ ok: true, commandType: 'timer.add', state: { timer: { remaining: 310 } } });
    const persisted = await readFile(path.join(dataDir, 'dashboard.json'), 'utf8');
    expect(persisted).not.toMatch(/accessToken|refreshToken|deviceCode|obsPassword/);
  });
  it('refuse une écoute LAN sans pairing authentifié', async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'streamdashboard-api-'));
    await expect(startDashboardServer({ port: 0, host: '0.0.0.0', dataDir })).rejects.toThrow(/remote-LAN/);
  });
  it('arrête le serveur proprement et de façon idempotente', async () => {
    const app = await start(); await app.stop(); await app.stop(); dashboard = undefined;
    expect(app.server.listening).toBe(false);
  });
});
