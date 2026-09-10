import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { startDashboardServer } from '../apps/server/src/index.js';

const dataDir = await mkdtemp(path.join(os.tmpdir(), 'streamdashboard-mobile-'));
const dashboard = await startDashboardServer({ port: 0, dataDir, logger: { info() {}, warn() {}, error() {} } });
try {
  const health = await fetch(`${dashboard.url}/api/v1/health`).then(response => response.json()) as { status: string };
  const capabilities = await fetch(`${dashboard.url}/api/v1/capabilities`).then(response => response.json()) as { protocolVersion: number };
  const state = await fetch(`${dashboard.url}/api/v1/state`).then(response => response.json()) as { timer: { remaining: number } };
  const result = await fetch(`${dashboard.url}/api/v1/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'timer.add', seconds: 30 }) }).then(response => response.json()) as { ok: boolean };
  const event = await new Promise<string>((resolve, reject) => { const ws = new WebSocket(dashboard.url.replace('http:', 'ws:') + '/ws/v1'); ws.on('message', data => { const text = data.toString(); if (text.includes('state.updated')) { ws.close(); resolve(text); } }); ws.on('error', reject); });
  if (health.status !== 'ready' || capabilities.protocolVersion !== 1 || !state.timer || !result.ok || !event.includes('state.updated')) throw new Error('Le protocole mobile simulé est incomplet.');
  console.log('Mobile smoke OK: health, capabilities, state, command, WebSocket');
} finally { await dashboard.stop(); await rm(dataDir, { recursive: true, force: true }); }
