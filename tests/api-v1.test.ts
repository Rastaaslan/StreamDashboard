import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { startDashboardServer, type DashboardServerHandle } from '../apps/server/src/index.js';

let dashboard: DashboardServerHandle | undefined; let dataDir = '';
afterEach(async () => { if (dashboard) await dashboard.stop(); if (dataDir) await rm(dataDir, { recursive: true, force: true }); dashboard = undefined; dataDir = ''; });
async function start() { dataDir = await mkdtemp(path.join(os.tmpdir(), 'streamdashboard-api-')); dashboard = await startDashboardServer({ port: 0, dataDir, logger: { info() {}, warn() {}, error() {} } }); return dashboard; }
async function wsRejected(url: string, origin: string) {
  await expect(new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(url, { origin });
    ws.on('open', () => { ws.close(); reject(new Error(`origine acceptée : ${origin}`)); });
    ws.on('error', () => resolve());
  })).resolves.toBeUndefined();
}

describe('API publique v1', () => {
  it('annonce protocole, capacités et état sans secrets', async () => {
    const app = await start();
    const capabilities = await fetch(`${app.url}/api/v1/capabilities`).then(r => r.json());
    const stateText = await fetch(`${app.url}/api/v1/state`).then(r => r.text());
    expect(capabilities).toMatchObject({ protocolVersion: 1, accessMode: 'desktop-local' });
    expect(stateText).not.toMatch(/accessToken|refreshToken|deviceCode|obsPassword\"/);
    const event = await new Promise<string>((resolve, reject) => { const ws = new WebSocket(app.url.replace('http:', 'ws:') + '/ws/v1'); ws.on('message', data => { const text = data.toString(); if (text.includes('state.updated')) { ws.close(); resolve(text); } }); ws.on('error', reject); });
    expect(event).not.toMatch(/accessToken|refreshToken|deviceCode|obsPassword\"/);
    const response = await fetch(`${app.url}/`);
    const csp = response.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain('ws://127.0.0.1:*');
    expect(csp).not.toContain('connect-src *');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
  });

  it('refuse une origine WebSocket étrangère ou un faux port local', async () => {
    const app = await start(); const wsUrl = app.url.replace('http:', 'ws:') + '/ws/v1';
    await wsRejected(wsUrl, 'https://evil.example');
    await wsRejected(wsUrl, 'http://127.0.0.1:1');
  });

  it('accepte le WebSocket du même origin exact', async () => {
    const app = await start();
    await expect(new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(app.url.replace('http:', 'ws:') + '/ws/v1', { origin: app.url });
      ws.on('open', () => { ws.close(); resolve(); }); ws.on('error', reject);
    })).resolves.toBeUndefined();
  });

  it('valide et borne une commande distante avant le bus unique', async () => {
    const app = await start();
    const invalid = await fetch(`${app.url}/api/v1/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'obs.volume', input: '', volume: 'fort' }) });
    expect(invalid.status).toBe(400);
    const dangerous = await fetch(`${app.url}/api/v1/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'timer.reset', shell: 'cmd.exe' }) });
    expect(dangerous.status).toBe(400);
    const excessive = await fetch(`${app.url}/api/v1/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'timer.add', seconds: 9_999_999 }) });
    expect(excessive.status).toBe(400);
    const valid = await fetch(`${app.url}/api/v1/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'timer.add', seconds: 10 }) });
    expect(await valid.json()).toMatchObject({ ok: true, commandType: 'timer.add', state: { timer: { remaining: 310 } } });
    const persisted = await readFile(path.join(dataDir, 'dashboard.json'), 'utf8');
    expect(persisted).not.toMatch(/accessToken|refreshToken|deviceCode|obsPassword/);
  });

  it('rejette les URLs OBS non locales et expose les réglages valides par v1', async () => {
    const app = await start();
    const remote = await fetch(`${app.url}/api/v1/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ obsUrl: 'ws://example.com:4455' }) });
    expect(remote.status).toBe(400);
    const updated = await fetch(`${app.url}/api/v1/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ streamerName: 'Smoke', obsExecutablePath: 'C:\\OBS\\bin\\64bit\\obs64.exe' }) }).then(r => r.json());
    expect(updated.settings).toMatchObject({ streamerName: 'Smoke', obsExecutablePath: 'C:\\OBS\\bin\\64bit\\obs64.exe', obsUrl: 'ws://127.0.0.1:4455' });
    const probe = await fetch(`${app.url}/api/v1/obs/test`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ obsUrl: 'wss://evil.example/ws' }) });
    expect(probe.status).toBe(400);
    expect((await fetch(`${app.url}/api/v1/diagnostics`)).status).toBe(200);
  });

  it('rejette un planning aux dates invalides', async () => {
    const app = await start();
    const response = await fetch(`${app.url}/api/v1/planning`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Impossible', startAtUtc: 'pas-une-date', endAtUtc: 'encore-moins', category: 'live' }) });
    expect(response.status).toBe(400);
    const state = await fetch(`${app.url}/api/v1/state`).then(r => r.json());
    expect(state.planning).toEqual([]);
  });

  it('termine réellement le timer côté serveur et persiste 00:00', async () => {
    const app = await start();
    const started = await fetch(`${app.url}/api/v1/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'timer.start', seconds: 1 }) });
    expect(started.status).toBe(200);
    await new Promise(resolve => setTimeout(resolve, 1_150));
    const state = await fetch(`${app.url}/api/v1/state`).then(r => r.json());
    expect(state.timer).toMatchObject({ running: false, remaining: 0, deadline: null, duration: 1 });
    const persisted = JSON.parse(await readFile(path.join(dataDir, 'dashboard.json'), 'utf8'));
    expect(persisted.timer).toMatchObject({ running: false, remaining: 0, deadline: null, duration: 1 });
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
