import { beforeEach, describe, expect, it, vi } from 'vitest';
import { COMPANION_KEY, CompanionMode, createCompanionStore, reconcileEvent, resolveMode } from '../apps/mobile/companion-store.js';

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe('compagnon Android autonome', () => {
  let storage: MemoryStorage;
  beforeEach(() => { storage = new MemoryStorage(); vi.stubGlobal('crypto', { randomUUID: () => 'uuid' }); });

  it('démarre sans serveur et sans snapshot avec un planning vide', () => {
    const store = createCompanionStore(storage as unknown as Storage);
    expect(store.snapshot()).toMatchObject({ schemaVersion: 2, planning: [], pending: [], tombstones: [] });
    expect(resolveMode({ pcAvailable: false, internetAvailable: false })).toBe(CompanionMode.OFFLINE);
    expect(resolveMode({ pcAvailable: false, internetAvailable: true })).toBe(CompanionMode.ONLINE_STANDALONE);
  });

  it('migre et conserve un snapshot serveur utilisable après redémarrage', () => {
    const first = createCompanionStore(storage as unknown as Storage, () => '2026-09-12T22:14:00.000Z');
    first.replaceServerSnapshot({ at: '2026-09-12T22:13:00.000Z', planning: [{ id: 'pc-1', title: 'FC26' }], settings: { streamerName: 'Rasta' } });
    const restarted = createCompanionStore(storage as unknown as Storage);
    expect(restarted.snapshot()).toMatchObject({ streamerName: 'Rasta', lastServerSyncAt: '2026-09-12T22:14:00.000Z', planning: [{ id: 'pc-1', title: 'FC26' }] });
  });

  it('persiste create/update/delete avec identité canonique, révision et tombstone', () => {
    const store = createCompanionStore(storage as unknown as Storage, () => '2026-09-12T22:14:00.000Z');
    const created = store.createEvent({ title: 'FC26', desiredPublication: { twitch: true, google: true, local: false } }).item!;
    expect(created.id).toMatch(/^live-[a-z0-9]+-uuid-\d+$/);
    expect(store.updateEvent(created.id, { title: 'FC26 club' }, 1).item?.revision).toBe(2);
    expect(store.deleteEvent(created.id, 2)).toEqual({ deleted: true });
    const afterRestart = createCompanionStore(storage as unknown as Storage).snapshot();
    expect(afterRestart.pending.map((item: { type: string }) => item.type)).toEqual(['create', 'update', 'delete']);
    expect(afterRestart.tombstones[0]).toMatchObject({ eventId: created.id, revision: 3 });
  });

  it('refuse un écrasement lorsque baseRevision est obsolète', () => {
    const store = createCompanionStore(storage as unknown as Storage);
    const item = store.createEvent({ title: 'A', startAtUtc: '20:00' }).item!;
    store.updateEvent(item.id, { startAtUtc: '20:30' }, 1);
    expect(store.updateEvent(item.id, { startAtUtc: '21:00' }, 1)).toMatchObject({ conflict: true, current: { startAtUtc: '20:30' }, proposed: { startAtUtc: '21:00' } });
  });

  it('ne perd ni une création pending ni une tombstone lorsque le PC revient', () => {
    const store = createCompanionStore(storage as unknown as Storage);
    const local = store.createEvent({ title: 'Android 21:00' }).item!;
    store.replaceServerSnapshot({ planning: [{ id: 'pc-old', title: 'PC 20:00' }], settings: {} });
    expect(store.snapshot().planning.map((item: { id: string }) => item.id)).toContain(local.id);
    store.deleteEvent('pc-old', 1);
    store.replaceServerSnapshot({ planning: [{ id: 'pc-old', title: 'PC 20:00' }], settings: {} });
    expect(store.snapshot().planning.map((item: { id: string }) => item.id)).not.toContain('pc-old');
  });

  it('fusionne les champs disjoints et expose les vrais conflits', () => {
    const base = { id: '1', title: 'A', startAtUtc: '20:00', description: '', revision: 1 };
    expect(reconcileEvent(base, { ...base, startAtUtc: '21:00', revision: 2 }, { ...base, description: 'live chill', revision: 2 })).toMatchObject({ conflict: false, value: { startAtUtc: '21:00', description: 'live chill', revision: 3 } });
    expect(reconcileEvent(base, { ...base, startAtUtc: '20:30' }, { ...base, startAtUtc: '21:00' })).toMatchObject({ conflict: true, fields: ['startAtUtc'] });
  });

  it('persiste notes, checklist et templates et acquitte uniquement les opérations reçues', () => {
    const store = createCompanionStore(storage as unknown as Storage);
    store.upsertCollection('notes', { text: 'Discussion feu de camp' });
    store.upsertCollection('checklist', { label: 'Micro chargé', done: false });
    store.upsertCollection('templates', { title: 'Jeu narratif', twitchCategoryId: '42' });
    const before = store.snapshot(); store.acknowledge([before.pending[1].id]);
    const restarted = createCompanionStore(storage as unknown as Storage).snapshot();
    expect(restarted.notes).toHaveLength(1); expect(restarted.checklist).toHaveLength(1); expect(restarted.templates).toHaveLength(1); expect(restarted.pending).toHaveLength(2);
    expect(JSON.parse(storage.getItem(COMPANION_KEY)!)).not.toHaveProperty('accessToken');
  });
});
