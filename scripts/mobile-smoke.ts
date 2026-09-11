import { mkdtemp, rm } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { startDashboardServer } from '../apps/server/src/index.js';

const dataDir = await mkdtemp(path.join(os.tmpdir(), 'streamdashboard-mobile-'));
const dashboard = await startDashboardServer({
  port: 0,
  host: '0.0.0.0',
  remoteEnabled: true,
  dataDir,
  logger: { info() {}, warn() {}, error() {} },
});

try {
  const ipv4 = Object.values(networkInterfaces()).flatMap(value => value ?? [])
    .find(value => value.family === 'IPv4' && !value.internal)?.address;
  if (!ipv4) throw new Error('Aucune interface IPv4 LAN disponible pour le smoke remote.');
  const remoteOrigin = `http://${ipv4}:${dashboard.port}`;

  const health = await fetch(`${remoteOrigin}/api/v1/health`).then(response => response.json()) as { status: string };
  const capabilities = await fetch(`${remoteOrigin}/api/v1/capabilities`).then(response => response.json()) as { protocolVersion: number; accessMode: string };
  const unauthenticated = await fetch(`${remoteOrigin}/api/v1/state`);
  if (unauthenticated.status !== 401) throw new Error(`State distant non authentifié devrait être 401, reçu ${unauthenticated.status}.`);

  const root = await fetch(`${remoteOrigin}/`, { redirect: 'manual' });
  if (![301, 302, 303, 307, 308].includes(root.status) || root.headers.get('location') !== '/mobile/') {
    throw new Error('Le cockpit desktop ne doit pas être servi directement sur le LAN.');
  }

  const pairing = await fetch(`${dashboard.url}/api/v1/remote/pairing`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  }).then(response => response.json()) as { id: string; code: string };
  const paired = await fetch(`${remoteOrigin}/api/v1/remote/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: pairing.id, code: pairing.code, name: 'CI Android' }),
  }).then(response => response.json()) as { credential: string };
  const headers = { authorization: `Device ${paired.credential}`, 'content-type': 'application/json' };

  const stateResponse = await fetch(`${remoteOrigin}/api/v1/state`, { headers });
  const stateText = await stateResponse.text();
  const state = JSON.parse(stateText) as { timer: { remaining: number } };
  for (const forbidden of ['obsUrl', 'obsExecutablePath', 'logsPath', 'dataDir', 'remoteDevices', 'targetCalendarId', 'calendars']) {
    if (stateText.includes(forbidden)) throw new Error(`Le state mobile expose encore ${forbidden}.`);
  }

  const allowedCommand = await fetch(`${remoteOrigin}/api/v1/commands`, {
    method: 'POST', headers, body: JSON.stringify({ type: 'timer.add', seconds: 30 }),
  });
  const result = await allowedCommand.json() as { ok: boolean };

  const forbiddenCommands = [
    { type: 'session.start', force: true },
    { type: 'obs.record', start: true },
    { type: 'obs.scene', scene: 'Arbitrary scene' },
    { type: 'obs.browser.refresh', input: 'Anything' },
    { type: 'checklist.reset' },
  ];
  for (const command of forbiddenCommands) {
    const denied = await fetch(`${remoteOrigin}/api/v1/commands`, {
      method: 'POST', headers, body: JSON.stringify(command),
    });
    if (denied.status !== 403) throw new Error(`Commande distante sensible ${command.type} devrait être 403, reçu ${denied.status}.`);
  }

  const deniedSettings = await fetch(`${remoteOrigin}/api/v1/settings`, {
    method: 'PUT', headers, body: JSON.stringify({ streamerName: 'Remote must not configure desktop' }),
  });
  if (deniedSettings.status !== 403) throw new Error(`Settings distant devrait être 403, reçu ${deniedSettings.status}.`);

  const ticketResponse = await fetch(`${remoteOrigin}/api/v1/remote/ws-ticket`, { method: 'POST', headers, body: '{}' });
  const ticket = await ticketResponse.json() as { ticket: string };
  const event = await new Promise<string>((resolve, reject) => {
    const ws = new WebSocket(`ws://${ipv4}:${dashboard.port}/ws/v1?ticket=${encodeURIComponent(ticket.ticket)}`, { headers: { Origin: remoteOrigin } });
    ws.on('message', data => {
      const value = data.toString();
      if (value.includes('state.updated')) { ws.close(); resolve(value); }
    });
    ws.on('error', reject);
  });
  if (event.includes('logsPath') || event.includes('obsExecutablePath') || event.includes('targetCalendarId')) {
    throw new Error('Le WebSocket mobile expose des données desktop non nécessaires.');
  }

  const replayRejected = await new Promise<boolean>(resolve => {
    const ws = new WebSocket(`ws://${ipv4}:${dashboard.port}/ws/v1?ticket=${encodeURIComponent(ticket.ticket)}`, { headers: { Origin: remoteOrigin } });
    ws.on('open', () => { ws.close(); resolve(false); });
    ws.on('unexpected-response', () => resolve(true));
    ws.on('error', () => resolve(true));
  });

  if (health.status !== 'ready'
    || capabilities.protocolVersion !== 1
    || capabilities.accessMode !== 'remote-LAN'
    || !state.timer
    || !result.ok
    || !event.includes('state.updated')
    || !replayRejected) {
    throw new Error('Le protocole mobile sécurisé est incomplet.');
  }
  console.log('Mobile smoke OK: LAN auth, pairing, redacted state, command allowlist, scope denial, one-use WS ticket');
} finally {
  await dashboard.stop();
  await rm(dataDir, { recursive: true, force: true });
}
