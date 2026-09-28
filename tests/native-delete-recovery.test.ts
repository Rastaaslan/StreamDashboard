import { expect, it, vi } from 'vitest';
import { createCompanionStore } from '../apps/mobile/companion-store.js';
import { createNativeProviderAdapter, createStandaloneProviderSync } from '../apps/mobile/provider-sync.js';
import { reconcileCompanionBatch, emptyCompanionState } from '../apps/server/src/companion-sync.js';
import { drainCompanionProviders } from '../apps/server/src/companion-providers.js';

function storage() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } } as Storage;
}
const event = { id: 'android-event', title: 'Live', startAtUtc: '2030-10-01T18:00:00Z', endAtUtc: '2030-10-01T20:00:00Z' };

it.each([['twitch', 'HTTP_404'], ['google', 'HTTP_404'], ['google', 'HTTP_410']] as const)(
  'completes %s deletion on %s after lost response and Android restart', async (provider, absentCode) => {
    const disk = storage(); let store = createCompanionStore(disk);
    store.createEvent({ ...event, desiredPublication: { [provider]: true },
      providerLinks: { [provider]: { status: 'synced', remoteId: 'remote-one', calendarId: 'calendar', revision: 'etag', fingerprint: 'fp' } } });
    const original = store.snapshot().planning[0]; store.deleteEvent(event.id);
    let remotePresent = true;
    const remove = vi.fn(() => {
      if (remotePresent) { remotePresent = false; return JSON.stringify({ ok: false, code: 'NETWORK' }); }
      return JSON.stringify({ ok: false, code: absentCode });
    });
    const adapter = createNativeProviderAdapter({
      [provider + 'Test']: () => JSON.stringify({ ok: true, configured: true, connected: true, tested: true, capabilities: ['calendar', 'schedule'] }),
      [provider + 'DeletePlanning']: remove,
    });
    await createStandaloneProviderSync({ store, adapter }).apply('ONLINE_STANDALONE', original, 'delete');
    expect(store.snapshot().tombstones[0].providerLinks[provider]).toMatchObject({ remoteId: 'remote-one', status: 'error' });
    store = createCompanionStore(disk);
    const tombstone = store.snapshot().tombstones[0];
    await createStandaloneProviderSync({ store, adapter }).apply('ONLINE_STANDALONE', { ...tombstone, id: event.id }, 'delete');
    expect(remove).toHaveBeenCalledTimes(2);
    expect(store.snapshot().tombstones[0].providerLinks[provider]).toMatchObject({ status: 'deleted', remoteId: null, revision: null, fingerprint: null });
    const desktop = reconcileCompanionBatch([], [], emptyCompanionState(), store.snapshot().pending);
    const mutate = vi.fn();
    await drainCompanionProviders(desktop.planning, desktop.companion, { [provider]: { create: mutate, update: mutate, delete: mutate } }, async () => {});
    expect(desktop.planning).toEqual([]);
    expect(desktop.companion.providerWork).toEqual({});
    expect(mutate).not.toHaveBeenCalled();
    expect(remotePresent).toBe(false);
  },
);

it.each([['google', 'HTTP_403'], ['google', 'HTTP_500'], ['google', 'CONFLICT'], ['twitch', 'HTTP_410']] as const)(
  'preserves genuine %s deletion failure %s and the remote identity', async (provider, code) => {
    const store = createCompanionStore(storage());
    store.createEvent({ ...event, desiredPublication: { [provider]: true }, providerLinks: { [provider]: { remoteId: 'one', status: 'synced' } } });
    const current = store.snapshot().planning[0]; store.deleteEvent(event.id);
    const adapter = createNativeProviderAdapter({
      [provider + 'Test']: () => JSON.stringify({ ok: true, configured: true, connected: true, tested: true, capabilities: ['calendar', 'schedule'] }),
      [provider + 'DeletePlanning']: () => JSON.stringify({ ok: false, code }),
    });
    await createStandaloneProviderSync({ store, adapter }).apply('ONLINE_STANDALONE', current, 'delete');
    expect(store.snapshot().tombstones[0].providerLinks[provider]).toMatchObject({ remoteId: 'one', status: code === 'CONFLICT' ? 'conflict' : 'error' });
  },
);
