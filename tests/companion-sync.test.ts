import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { companionSnapshot, emptyCompanionState, reconcileCompanionBatch, resolveCompanionConflict } from '../apps/server/src/companion-sync.js';
import { startDashboardServer, type DashboardServerHandle } from '../apps/server/src/index.js';

const event = (id = 'event-a', startAtUtc = '2026-09-12T20:00:00.000Z') => ({ id, title: 'Live', description: '', startAtUtc, endAtUtc: '2026-09-12T23:00:00.000Z', category: 'live' as const, desiredPublication: { local: true, twitch: true, google: true }, providers: { google: { status: 'synced' as const, remoteId: 'google-1' } } });
const op = (id: string, type: string, patch: Record<string, unknown>, baseRevision = 0) => ({ id, eventId: 'event-a', type, baseRevision, timestamp: new Date().toISOString(), patch });

describe('transaction compagnon', () => {
  it('applique une création une seule fois lorsque la réponse est perdue', () => {
    const state = emptyCompanionState(); const create = op('op-create', 'create', event());
    const first = reconcileCompanionBatch([], [], state, [create]);
    const replay = reconcileCompanionBatch(first.planning, [], first.companion, [create]);
    expect(replay.planning).toHaveLength(1); expect(replay.acknowledged).toEqual(['op-create']); expect(replay.companion.serverRevision).toBe(1);
  });

  it('fusionne les champs disjoints, mais expose puis résout le même champ', () => {
    const created = reconcileCompanionBatch([], [], emptyCompanionState(), [op('create', 'create', event())]);
    const pc = structuredClone(created.planning); pc[0].startAtUtc = '2026-09-12T21:00:00.000Z';
    created.companion.eventRevisions['event-a'] = 2;
    const merged = reconcileCompanionBatch(pc, [], created.companion, [{ ...op('note', 'update', { description: 'Live avec Miryun' }, 1), base: event() }]);
    expect(merged.planning[0]).toMatchObject({ startAtUtc: '2026-09-12T21:00:00.000Z', description: 'Live avec Miryun' });
    const conflict = reconcileCompanionBatch(merged.planning.map(item => ({ ...item, startAtUtc: '2026-09-12T21:30:00.000Z' })), [], { ...merged.companion, eventRevisions: { 'event-a': 4 } }, [{ ...op('same-field', 'update', { startAtUtc: '2026-09-12T22:00:00.000Z' }, 3), base: merged.planning[0] as unknown as Record<string, unknown> }]);
    expect(conflict.acknowledged).toEqual([]); expect(conflict.conflicts[0].fields).toEqual(['startAtUtc']);
    const resolved = resolveCompanionConflict(conflict.planning, conflict.companion, 'same-field', 'android');
    expect(resolved.planning[0].startAtUtc).toBe('2026-09-12T22:00:00.000Z'); expect(resolved.acknowledged).toEqual(['same-field']);
  });

  it('synchronise tombstones, notes, checklist et templates avec ACK partiel', () => {
    const state = emptyCompanionState();
    const result = reconcileCompanionBatch([event()], [], { ...state, eventRevisions: { 'event-a': 1 } }, [op('delete', 'delete', {}, 1), { id: 'note', eventId: 'note-1', type: 'notes.upsert', baseRevision: 0, patch: { text: 'Idée' } }, { id: 'check', eventId: 'check-1', type: 'checklist.upsert', baseRevision: 0, patch: { label: 'Micro', done: true } }, { id: 'template', eventId: 'template-1', type: 'templates.upsert', baseRevision: 0, patch: { title: 'FC26' } }]);
    expect(result.planning).toEqual([]); expect(result.companion.tombstones['event-a']).toBeTruthy(); expect(result.acknowledged).toEqual(['delete', 'note', 'check', 'template']);
    expect(companionSnapshot(result.planning, result.companion)).toMatchObject({ notes: [{ text: 'Idée' }], checklist: [{ done: true }], templates: [{ title: 'FC26' }] });
  });
});

describe('intégration serveur PC ↔ Android', () => {
  let server: DashboardServerHandle | undefined; let dataDir = '';
  afterEach(async () => { await server?.stop(); if (dataDir) await rm(dataDir, { recursive: true, force: true }); });
  it('conserve 21:00 après ACK, réponse perdue et redémarrage PC (anti-régression 20:00)', async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'companion-sync-'));
    server = await startDashboardServer({ port: 0, remoteEnabled: true, dataDir, logger: { info() {}, warn() {}, error() {} } });
    expect((await fetch(`${server.url}/api/v1/companion/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(401);
    const pairing = await fetch(`${server.url}/api/v1/remote/pairing`, { method: 'POST' }).then(r => r.json());
    const paired = await fetch(`${server.url}/api/v1/remote/pair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: pairing.id, code: pairing.code, name: 'Test Android' }) }).then(r => r.json());
    const headers = { 'content-type': 'application/json', authorization: `Device ${paired.credential}` };
    const create = op('offline-create', 'create', event('event-a', '2026-09-12T21:00:00.000Z'));
    const send = () => fetch(`${server!.url}/api/v1/companion/sync`, { method: 'POST', headers, body: JSON.stringify({ schemaVersion: 2, deviceId: paired.deviceId, lastKnownServerRevision: 0, operations: [create] }) }).then(r => r.json());
    expect(await send()).toMatchObject({ acknowledged: ['offline-create'], snapshot: { planning: [{ id: 'event-a', startAtUtc: '2026-09-12T21:00:00.000Z' }] } });
    await server.stop(); server = await startDashboardServer({ port: 0, remoteEnabled: true, dataDir, logger: { info() {}, warn() {}, error() {} } });
    const replay = await send(); expect(replay.snapshot.planning).toHaveLength(1); expect(replay.snapshot.planning[0].startAtUtc).toBe('2026-09-12T21:00:00.000Z');
  });
});
