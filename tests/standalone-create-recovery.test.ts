import { expect, it, vi } from 'vitest';
import { createCompanionStore } from '../apps/mobile/companion-store.js';
import { createNativeProviderAdapter, createStandaloneProviderSync } from '../apps/mobile/provider-sync.js';
import { companionSnapshot, emptyCompanionState, reconcileCompanionBatch } from '../apps/server/src/companion-sync.js';
import { drainCompanionProviders } from '../apps/server/src/companion-providers.js';

const event = { id: 'android-live', title: 'Original', startAtUtc: '2026-10-01T18:00:00Z', endAtUtc: '2026-10-01T20:00:00Z' };
function storage() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } } as Storage;
}

it.each(['google', 'twitch'] as const)('recovers %s after accepted CREATE loses its response and Android restarts', async provider => {
  const disk = storage();
  let store = createCompanionStore(disk);
  store.createEvent({ ...event, desiredPublication: { [provider]: true } });
  let remoteCount = 0;
  let readable = false;
  let attempts = 0;
  let recoveredEvent: any;
  const bridge = {
    [provider + 'Test']: () => JSON.stringify({ ok: true, configured: true, connected: true, tested: true, capabilities: ['calendar', 'schedule'] }),
    [provider + 'CreatePlanning']: () => {
      remoteCount++; attempts++;
      return JSON.stringify({ ok: false, code: 'NETWORK' }); // committed remotely, response lost
    },
    [provider + 'ReconcilePlanning']: (raw: string) => {
      recoveredEvent = JSON.parse(raw).event;
      return JSON.stringify(readable ? { ok: true, remoteId: 'remote-one', revision: 'etag', fingerprint: 'fp', calendarId: 'calendar' }
        : { ok: false, code: 'CREATE_UNCERTAIN' });
    },
  };
  let standalone = createStandaloneProviderSync({ store, adapter: createNativeProviderAdapter(bridge) });
  await standalone.apply('ONLINE_STANDALONE', store.snapshot().planning[0], 'create');
  expect(remoteCount).toBe(1);
  expect(store.snapshot().planning[0].providerLinks[provider]).toMatchObject({ status: 'error', uncertainCreate: { event: { title: 'Original' } } });

  // Desktop must also refuse a second create while Android is uncertain.
  const first = reconcileCompanionBatch([], [], emptyCompanionState(), store.snapshot().pending);
  const desktopCreate = vi.fn();
  await drainCompanionProviders(first.planning, first.companion, { [provider]: { create: desktopCreate, update: vi.fn(), delete: vi.fn() } }, async () => {});
  expect(desktopCreate).not.toHaveBeenCalled();
  expect(first.companion.providerWork[event.id + ':' + provider].uncertain).toBe(true);

  store = createCompanionStore(disk);
  standalone = createStandaloneProviderSync({ store, adapter: createNativeProviderAdapter(bridge) });
  await standalone.apply('ONLINE_STANDALONE', store.snapshot().planning[0], 'create');
  expect(attempts).toBe(1); // no match is not proof the first POST failed
  expect(store.snapshot().planning[0].providerLinks[provider].uncertainCreate).toBeTruthy();
  readable = true;
  await standalone.apply('ONLINE_STANDALONE', store.snapshot().planning[0], 'create');
  expect(recoveredEvent.title).toBe('Original');
  expect(attempts).toBe(1);
  expect(store.snapshot().planning[0].providerLinks[provider]).toMatchObject({ status: 'synced', remoteId: 'remote-one', uncertainCreate: null });
  const handover = reconcileCompanionBatch(first.planning, [], first.companion, store.snapshot().pending);
  expect(handover.conflicts).toEqual([]);
  await drainCompanionProviders(handover.planning, handover.companion, { [provider]: { create: desktopCreate, update: vi.fn(), delete: vi.fn() } }, async () => {});
  expect(desktopCreate).not.toHaveBeenCalled();
  expect(handover.companion.providerWork).toEqual({});
  store.applySyncResponse({ acknowledged: handover.acknowledged, snapshot: companionSnapshot(handover.planning, handover.companion) });
  expect(store.snapshot().pending).toEqual([]);
  expect(remoteCount).toBe(1);
});

it('persists uncertainty before native I/O so process death also requires reconciliation', async () => {
  const disk = storage(); const store = createCompanionStore(disk);
  store.createEvent({ ...event, desiredPublication: { google: true } });
  let entered!: () => void; let finish!: (value: any) => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const response = new Promise<any>(resolve => { finish = resolve; });
  const mutate = vi.fn(async () => { entered(); return response; });
  const running = createStandaloneProviderSync({ store, adapter: { mutate } as any }).apply('ONLINE_STANDALONE', store.snapshot().planning[0], 'create');
  await started;
  const restarted = createCompanionStore(disk);
  const reconcile = vi.fn(async () => ({ remoteId: 'one', revision: 'r1' }));
  const afterRestart = createStandaloneProviderSync({ store: restarted, adapter: { mutate, reconcile } as any });
  await afterRestart.apply('ONLINE_STANDALONE', restarted.snapshot().planning[0], 'create');
  expect(mutate).toHaveBeenCalledTimes(1);
  expect(reconcile).toHaveBeenCalledTimes(1);
  expect(restarted.snapshot().planning[0].providerLinks.google.remoteId).toBe('one');
  finish({ remoteId: 'one', revision: 'r1' }); await running;
});

it('does not mark a native preflight refusal as an uncertain remote write at Desktop handover', async () => {
  const store = createCompanionStore(storage());
  store.createEvent({ ...event, desiredPublication: { google: true } });
  const create = vi.fn();
  const adapter = createNativeProviderAdapter({
    googleTest: () => JSON.stringify({ ok: true, configured: true, connected: false, tested: true, code: 'REAUTH_REQUIRED' }),
    googleCreatePlanning: create,
  });
  await createStandaloneProviderSync({ store, adapter }).apply('ONLINE_STANDALONE', store.snapshot().planning[0], 'create');
  expect(create).not.toHaveBeenCalled();
  expect(store.snapshot().planning[0].providerLinks.google).toMatchObject({ uncertainCreate: null, createNotStarted: true });
  const batch = reconcileCompanionBatch([], [], emptyCompanionState(), store.snapshot().pending);
  const desktopCreate = vi.fn(async () => ({ id: 'one' }));
  await drainCompanionProviders(batch.planning, batch.companion, { google: { create: desktopCreate, update: vi.fn(), delete: vi.fn() } }, async () => {});
  expect(desktopCreate).toHaveBeenCalledTimes(1);
  expect(batch.companion.providerWork).toEqual({});
});

it('recovers the original create after an offline edit and updates the recovered ID', async () => {
  const disk = storage();
  let store = createCompanionStore(disk);
  store.createEvent({ ...event, desiredPublication: { google: true } });
  const mutate = vi.fn(async (_provider: string, action: string, value: any, link: any) => {
    if (action === 'create') throw new Error('response lost');
    expect(action).toBe('update'); expect(link.remoteId).toBe('one'); expect(value.title).toBe('Latest');
    return { remoteId: 'one', revision: 'r2' };
  });
  const reconcile = vi.fn(async (_provider: string, original: any) => {
    expect(original.title).toBe('Original'); return { remoteId: 'one', revision: 'r1' };
  });
  await createStandaloneProviderSync({ store, adapter: { mutate, reconcile } as any }).apply('ONLINE_STANDALONE', store.snapshot().planning[0], 'create');
  store = createCompanionStore(disk);
  store.updateEvent(event.id, { title: 'Latest' });
  await createStandaloneProviderSync({ store, adapter: { mutate, reconcile } as any }).apply('ONLINE_STANDALONE', store.snapshot().planning[0], 'update');
  expect(mutate.mock.calls.map(call => call[1])).toEqual(['create', 'update']);
  expect(store.snapshot().planning[0].providerLinks.google).toMatchObject({ remoteId: 'one', status: 'synced', revision: 'r2' });
});

it.each(['google', 'twitch'] as const)('retries %s definitive native rejections after restart and hands over one publication', async provider => {
  for (const code of ['HTTP_403', 'HTTP_429', 'INVALID_PAYLOAD']) {
    const disk = storage(); let store = createCompanionStore(disk);
    store.createEvent({ ...event, desiredPublication: { google: true, twitch: true } });
    let rejected = true;
    let publications = 0;
    const create = vi.fn(() => {
      if (rejected) return JSON.stringify({ ok: false, code }); // old bridge compatibility
      publications++;
      return JSON.stringify({ ok: true, remoteId: 'one', revision: 'etag', fingerprint: 'fp', calendarId: 'calendar' });
    });
    const reconcile = vi.fn();
    const otherCreate = vi.fn();
    const bridge = {
      [provider + 'Test']: () => JSON.stringify({ ok: true, configured: true, connected: true, tested: true, capabilities: ['calendar', 'schedule'] }),
      [provider + 'CreatePlanning']: create,
      [provider + 'ReconcilePlanning']: reconcile,
      [(provider === 'google' ? 'twitch' : 'google') + 'CreatePlanning']: otherCreate,
    };
    await createStandaloneProviderSync({ store, adapter: createNativeProviderAdapter(bridge) }).apply('ONLINE_STANDALONE', store.snapshot().planning[0], 'create', provider);
    store = createCompanionStore(disk);
    expect(store.snapshot().planning[0].providerLinks[provider]).toMatchObject({ status: 'error', uncertainCreate: null, createNotStarted: true });
    // The persisted rejection also permits Desktop recovery before Android retries.
    const failedHandover = reconcileCompanionBatch([], [], emptyCompanionState(), store.snapshot().pending);
    expect(failedHandover.companion.providerWork[event.id + ':' + provider].uncertain).not.toBe(true);
    rejected = false; // permission restored, or invalid input corrected
    if (code === 'INVALID_PAYLOAD') store.updateEvent(event.id, { title: 'Corrected' });
    await createStandaloneProviderSync({ store, adapter: createNativeProviderAdapter(bridge) }).apply('ONLINE_STANDALONE', store.snapshot().planning[0], 'create', provider);
    expect(create).toHaveBeenCalledTimes(2);
    expect(reconcile).not.toHaveBeenCalled();
    expect(otherCreate).not.toHaveBeenCalled();
    expect(publications).toBe(1);
    store = createCompanionStore(disk);
    expect(store.snapshot().planning[0].providerLinks[provider]).toMatchObject({ status: 'synced', remoteId: 'one', uncertainCreate: null, createNotStarted: false });
    const handover = reconcileCompanionBatch(failedHandover.planning, [], failedHandover.companion, store.snapshot().pending);
    expect(handover.conflicts).toEqual([]);
    const desktopCreate = vi.fn();
    await drainCompanionProviders(handover.planning, handover.companion, { [provider]: { create: desktopCreate, update: vi.fn(), delete: vi.fn() } }, async () => {}, event.id + ':' + provider);
    expect(desktopCreate).not.toHaveBeenCalled();
    expect(handover.planning[0].providers?.[provider]).toMatchObject({ remoteId: 'one', remoteRevision: 'etag', fingerprint: 'fp', calendarId: 'calendar' });
  }
});

it.each(['NETWORK', 'HTTP_408', 'HTTP_500', 'HTTP_503', 'CONFLICT'])('retains native CREATE uncertainty on %s after restart', async code => {
  const disk = storage(); let store = createCompanionStore(disk);
  store.createEvent({ ...event, desiredPublication: { google: true } });
  const create = vi.fn(() => JSON.stringify({ ok: false, code }));
  const reconcile = vi.fn(() => JSON.stringify({ ok: false, code: 'CREATE_UNCERTAIN' }));
  const bridge = {
    googleTest: () => JSON.stringify({ ok: true, configured: true, connected: true, tested: true, capabilities: ['calendar'] }),
    googleCreatePlanning: create, googleReconcilePlanning: reconcile,
  };
  await createStandaloneProviderSync({ store, adapter: createNativeProviderAdapter(bridge) }).apply('ONLINE_STANDALONE', store.snapshot().planning[0], 'create');
  store = createCompanionStore(disk);
  await createStandaloneProviderSync({ store, adapter: createNativeProviderAdapter(bridge) }).apply('ONLINE_STANDALONE', store.snapshot().planning[0], 'create');
  expect(create).toHaveBeenCalledTimes(1);
  expect(reconcile).toHaveBeenCalledTimes(1);
  expect(store.snapshot().planning[0].providerLinks.google.uncertainCreate).toBeTruthy();
});

it('carries explicit native non-creation evidence through the adapter', async () => {
  const adapter = createNativeProviderAdapter({
    googleTest: () => JSON.stringify({ ok: true, configured: true, connected: true, tested: true, capabilities: ['calendar'] }),
    googleCreatePlanning: () => JSON.stringify({ ok: false, code: 'VALIDATION', nonCreation: true }),
  });
  await expect(adapter.mutate('google', 'create', event, {})).rejects.toMatchObject({ nonCreation: true });
});
