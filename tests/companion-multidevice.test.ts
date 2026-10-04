import { publicationContent } from '../apps/mobile/shared/publication-content.js';
import { describe, expect, it, vi } from 'vitest';
import { createCompanionStore } from '../apps/mobile/companion-store.js';
import { createStandaloneProviderSync } from '../apps/mobile/provider-sync.js';
import { companionSnapshot, emptyCompanionState, reconcileCompanionBatch, resolveCompanionConflict } from '../apps/server/src/companion-sync.js';
import { drainCompanionProviders } from '../apps/server/src/companion-providers.js';

const event = { id: 'android-live', title: 'Live', startAtUtc: '2026-10-01T18:00:00Z', endAtUtc: '2026-10-01T20:00:00Z', desiredPublication: { local: true, twitch: true, google: true } };
function mobile() {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } } as Storage;
  return createCompanionStore(storage);
}
function providers() {
  return Object.fromEntries(['twitch', 'google'].map(name => [name, {
    create: vi.fn(async () => ({ id: name + '-remote', revision: 'r1', calendarId: 'calendar' })),
    update: vi.fn(async () => ({ revision: 'r2' })), delete: vi.fn(async () => {}),
  }])) as any;
}
const sync = (store: ReturnType<typeof mobile>, previous?: ReturnType<typeof reconcileCompanionBatch>) =>
  reconcileCompanionBatch(previous?.planning ?? [], [], previous?.companion ?? emptyCompanionState(), store.snapshot().pending);
const response = (batch: ReturnType<typeof sync>) => ({ acknowledged: batch.acknowledged, conflicts: batch.conflicts, snapshot: companionSnapshot(batch.planning, batch.companion) });

describe('CB-16 real mobile journal / Desktop provider handover', () => {
  it('drains an edit made during a delayed create without creating a duplicate', async () => {
    const store = mobile(); store.createEvent({ ...event, title: 'Original' });
    let releaseCreate!: () => void; let releaseUpdate!: () => void;
    let created!: () => void; let updating!: () => void;
    const createStarted = new Promise<void>(resolve => { created = resolve; });
    const updateStarted = new Promise<void>(resolve => { updating = resolve; });
    const createGate = new Promise<void>(resolve => { releaseCreate = resolve; });
    const updateGate = new Promise<void>(resolve => { releaseUpdate = resolve; });
    let remoteTitle = '';
    const adapter = { mutate: vi.fn(async (_provider: string, action: string, value: any, link: any) => {
      if (action === 'create') { created(); await createGate; }
      else { expect(link.remoteId).toBe('google-remote'); updating(); await updateGate; }
      remoteTitle = value.title;
      return { remoteId: 'google-remote', revision: action === 'create' ? 'r1' : 'r2' };
    }) };
    const standalone = createStandaloneProviderSync({ store, adapter } as any);
    const first = standalone.apply('ONLINE_STANDALONE', store.snapshot().planning[0], 'create', 'google');
    await createStarted;
    store.updateEvent(event.id, { title: 'Latest' });
    const overlapping = standalone.apply('ONLINE_STANDALONE', store.snapshot().planning[0], 'update', 'google');
    releaseCreate(); await updateStarted;
    expect(remoteTitle).toBe('Original');
    const interim = sync(store);
    expect(interim.planning[0].title).toBe('Latest');
    expect(interim.planning[0].providers?.google?.status).toBe('pending');
    expect(interim.companion.providerWork[event.id + ':google']).toMatchObject({ action: 'publish', status: 'queued' });
    releaseUpdate(); await Promise.all([first, overlapping]);
    expect(remoteTitle).toBe('Latest');
    expect(adapter.mutate.mock.calls.map(call => call[1])).toEqual(['create', 'update']);
    const final = sync(store);
    expect(final.companion.providerWork[event.id + ':google']).toBeUndefined();
    expect(final.planning[0].providers?.google).toMatchObject({ status: 'synced', remoteId: 'google-remote', remoteRevision: 'r2',
      publishedContent: publicationContent({ ...event, title: 'Latest' }, 'google') });
  });

  it('keeps newer Desktop publication work when an older completion arrives after an edit', async () => {
    const store = mobile(); store.createEvent({ ...event, title: 'Original' });
    store.updateEvent(event.id, { title: 'Latest' });
    (store as any).updateProvider(event.id, 'google', { status: 'synced', remoteId: 'google-remote',
      revision: 'r1', publishedContent: publicationContent({ ...event, title: 'Original' }, 'google') });
    const batch = sync(store); const remote = providers();
    expect(batch.companion.providerWork[event.id + ':google']).toMatchObject({ action: 'publish', status: 'queued' });
    await drainCompanionProviders(batch.planning, batch.companion, remote, async () => {}, event.id + ':google');
    expect(remote.google.create).not.toHaveBeenCalled();
    expect(remote.google.update).toHaveBeenCalledWith('google-remote', expect.objectContaining({ title: 'Latest' }), 'r1');
    expect(batch.companion.providerWork[event.id + ':google']).toBeUndefined();
  });

  it('unpublishes a disabled standalone provider, republishes with a new ID and hands over without duplicates', async () => {
    const store = mobile(); store.createEvent({ ...event, desiredPublication: { local: true, twitch: false, google: true } });
    let creates = 0;
    const remoteIds = new Set<string>();
    const adapter = { mutate: vi.fn(async (_provider: string, action: string, _value: any, link: any) => {
      if (action === 'create') {
        const remoteId = 'google-' + ++creates; remoteIds.add(remoteId);
        return { remoteId, revision: 'etag-' + creates, calendarId: 'calendar', fingerprint: 'fp-' + creates };
      }
      expect(action).toBe('delete');
      expect(remoteIds.delete(link.remoteId)).toBe(true);
      return { remoteId: link.remoteId };
    }) };
    const standalone = createStandaloneProviderSync({ store, adapter } as any);
    await standalone.apply('ONLINE_STANDALONE', store.snapshot().planning[0], 'create');
    let batch = sync(store); store.applySyncResponse(response(batch));
    store.updateEvent(event.id, { desiredPublication: { local: true, twitch: false, google: false } });
    await standalone.apply('ONLINE_STANDALONE', store.snapshot().planning[0], 'update');
    expect(remoteIds.size).toBe(0);
    expect(store.snapshot().planning[0].providerLinks.google).toMatchObject({
      status: 'deleted', remoteId: null, revision: null, fingerprint: null, calendarId: 'calendar',
    });
    batch = sync(store, batch);
    const desktop = providers();
    await drainCompanionProviders(batch.planning, batch.companion, desktop, async () => {});
    expect(batch.companion.providerWork).toEqual({});
    expect(batch.planning[0].providers?.google?.remoteId).toBeUndefined();
    expect(desktop.google.create).not.toHaveBeenCalled();
    expect(desktop.google.delete).not.toHaveBeenCalled();
    store.applySyncResponse(response(batch));
    store.updateEvent(event.id, { desiredPublication: { local: true, twitch: false, google: true } });
    await standalone.apply('ONLINE_STANDALONE', store.snapshot().planning[0], 'update');
    expect([...remoteIds]).toEqual(['google-2']);
    expect(adapter.mutate.mock.calls.map(call => call[1])).toEqual(['create', 'delete', 'create']);
    batch = sync(store, JSON.parse(JSON.stringify(batch)));
    await drainCompanionProviders(batch.planning, batch.companion, desktop, async () => {});
    expect(batch.planning[0].providers?.google).toMatchObject({ status: 'synced', remoteId: 'google-2', remoteRevision: 'etag-2', calendarId: 'calendar' });
    expect(batch.companion.providerWork).toEqual({});
    expect(desktop.google.create).not.toHaveBeenCalled();
    expect(desktop.google.update).not.toHaveBeenCalled();
  });

  it('clears the legacy Twitch segment ID after Android unpublication before a Desktop republication', async () => {
    const initial = reconcileCompanionBatch([{ ...event, twitchSegmentId: 'old-segment',
      desiredPublication: { local: true, twitch: true, google: false },
      providers: { twitch: { status: 'synced', remoteId: 'old-segment' } } }], [], emptyCompanionState(), []);
    const store = mobile(); store.applySyncResponse(response(initial));
    store.updateEvent(event.id, { desiredPublication: { local: true, twitch: false, google: false } });
    const adapter = { mutate: vi.fn(async () => ({ remoteId: 'old-segment' })) };
    await createStandaloneProviderSync({ store, adapter } as any).apply('ONLINE_STANDALONE', store.snapshot().planning[0], 'update');
    const unpublished = sync(store, initial);
    expect(unpublished.planning[0].twitchSegmentId).toBeUndefined();
    expect(unpublished.planning[0].providers?.twitch?.remoteId).toBeUndefined();
    store.applySyncResponse(response(unpublished));
    store.updateEvent(event.id, { desiredPublication: { local: true, twitch: true, google: false } });
    const republish = sync(store, unpublished);
    const remote = providers();
    await drainCompanionProviders(republish.planning, republish.companion, remote, async () => {});
    expect(remote.twitch.create).toHaveBeenCalledTimes(1);
    expect(remote.twitch.update).not.toHaveBeenCalled();
    expect(republish.planning[0].twitchSegmentId).toBe('twitch-remote');
  });

  it('does not create either provider again after standalone publication, replay and restart', async () => {
    const store = mobile();
    store.createEvent(event);
    const adapter = { mutate: vi.fn(async (name: string) => ({ remoteId: name + '-remote', revision: 'etag-1', fingerprint: 'fp-1', calendarId: 'calendar' })) };
    await createStandaloneProviderSync({ store, adapter } as any).apply('ONLINE_STANDALONE', store.snapshot().planning[0], 'create');
    const batch = sync(store);
    const remote = providers();
    await drainCompanionProviders(batch.planning, batch.companion, remote, async () => {});
    expect(remote.twitch.create).not.toHaveBeenCalled(); expect(remote.google.create).not.toHaveBeenCalled();
    expect(batch.planning[0].providers?.google).toMatchObject({ remoteId: 'google-remote', remoteRevision: 'etag-1', fingerprint: 'fp-1', calendarId: 'calendar' });
    const restarted = JSON.parse(JSON.stringify(batch));
    const replay = sync(store, restarted);
    expect(replay.companion.serverRevision).toBe(batch.companion.serverRevision);
    store.applySyncResponse(response(replay));
    expect(store.snapshot().pending).toEqual([]);
    expect(store.snapshot().planning[0].providerLinks.google).toMatchObject({ revision: 'etag-1', fingerprint: 'fp-1' });
    store.updateEvent(event.id, { title: 'Android offline edit' });
    const edit = sync(store, replay);
    await drainCompanionProviders(edit.planning, edit.companion, remote, async () => {});
    expect(remote.google.update).toHaveBeenCalledWith('google-remote', expect.objectContaining({ title: 'Android offline edit' }), 'etag-1');
    expect(remote.google.create).not.toHaveBeenCalled();
  });

  it('publishes offline create/update once per provider and propagates a Desktop edit back', async () => {
    const store = mobile(); store.createEvent(event); store.updateEvent(event.id, { title: 'Offline title' });
    const batch = sync(store); const remote = providers();
    let disk = '';
    await drainCompanionProviders(batch.planning, batch.companion, remote, async () => { disk = JSON.stringify(batch); });
    expect(remote.twitch.create).toHaveBeenCalledTimes(1); expect(remote.google.create).toHaveBeenCalledTimes(1);
    const replay = sync(store, JSON.parse(disk));
    await drainCompanionProviders(replay.planning, replay.companion, remote, async () => {});
    expect(remote.google.create).toHaveBeenCalledTimes(1);
    replay.planning[0].description = 'Desktop description';
    replay.companion.eventRevisions[event.id]++;
    store.applySyncResponse(response(replay));
    expect(store.snapshot().planning[0]).toMatchObject({ title: 'Offline title', description: 'Desktop description', providerLinks: { google: { remoteId: 'google-remote' } } });
  });

  it('retains failed remote deletion across restart and retries only that provider', async () => {
    const store = mobile(); store.createEvent(event);
    const batch = sync(store); const remote = providers();
    await drainCompanionProviders(batch.planning, batch.companion, remote, async () => {});
    store.applySyncResponse(response(batch)); store.deleteEvent(event.id);
    const deleted = sync(store, batch);
    remote.google.delete.mockRejectedValueOnce(new Error('offline'));
    await drainCompanionProviders(deleted.planning, deleted.companion, remote, async () => {});
    expect(deleted.planning).toEqual([]);
    const restart = JSON.parse(JSON.stringify(deleted));
    const key = event.id + ':google';
    expect(restart.companion.providerWork[key].status).toBe('error');
    restart.companion.providerWork[key].status = 'queued';
    await drainCompanionProviders(restart.planning, restart.companion, remote, async () => {}, key);
    expect(remote.google.delete).toHaveBeenCalledTimes(2);
    expect(remote.twitch.delete).toHaveBeenCalledTimes(1);
    expect(restart.companion.providerWork).toEqual({});
    expect(restart.companion.tombstones[event.id].providerLinks.google.status).toBe('not-published');
    expect(restart.companion.tombstones[event.id].providerLinks.twitch.status).toBe('not-published');
  });

  it('does not blindly repeat a create interrupted before receiving its remote ID', async () => {
    const store = mobile(); store.createEvent(event); const batch = sync(store);
    batch.companion.providerWork[event.id + ':google'].status = 'running';
    const remote = providers();
    await drainCompanionProviders(batch.planning, batch.companion, remote, async () => {});
    expect(remote.google.create).not.toHaveBeenCalled();
    expect(batch.companion.providerWork[event.id + ':google']).toMatchObject({ status: 'error', uncertain: true });
    expect(batch.planning[0].providers?.google?.lastError).toMatch(/incertaine/);
  });

  it('projects both providers for a local series and preserves remotely deleted links', async () => {
    const store = mobile(); store.createEvent({ ...event, recurrence: { frequency: 'weekly', interval: 1, timeZone: 'Europe/Paris', exceptions: { 'android-live:2026-10-08T20:00:00': { cancelled: true } } } });
    const batch = sync(store); const remote = providers();
    await drainCompanionProviders(batch.planning, batch.companion, remote, async () => {});
    expect(remote.google.create).toHaveBeenCalled(); expect(remote.twitch.create).toHaveBeenCalled();
    expect(batch.planning[0].providers?.google?.status).toBe('synced');
    const single = mobile(); single.createEvent({ ...event, providerLinks: { google: { status: 'error', remoteId: 'gone', deletedRemotely: true } } });
    const deleted = sync(single);
    await drainCompanionProviders(deleted.planning, deleted.companion, remote, async () => {});
    expect(remote.google.update).not.toHaveBeenCalled();
    expect(deleted.planning[0].providers?.google?.deletedRemotely).toBe(true);
  });

  it('blocks dependent edits until conflict resolution and can accept an Android deletion', () => {
    const store = mobile(); store.createEvent(event); const batch = sync(store);
    store.applySyncResponse(response(batch));
    store.updateEvent(event.id, { title: 'Android' }); store.updateEvent(event.id, { description: 'dependent' });
    batch.planning[0].title = 'Desktop'; batch.companion.eventRevisions[event.id]++;
    const conflict = sync(store, batch);
    expect(conflict.conflicts).toHaveLength(1); expect(conflict.acknowledged).toEqual([]);
    const resolved = resolveCompanionConflict(conflict.planning, conflict.companion, conflict.conflicts[0].operationId, 'android');
    expect(resolved.planning[0].title).toBe('Android');
    store.applySyncResponse({ acknowledged: resolved.acknowledged, snapshot: companionSnapshot(resolved.planning, resolved.companion) });
    const next = sync(store, { ...conflict, ...resolved });
    expect(next.planning[0].description).toBe('dependent');
    store.applySyncResponse(response(next)); store.deleteEvent(event.id);
    next.companion.eventRevisions[event.id]++;
    const deletion = sync(store, next);
    const accepted = resolveCompanionConflict(deletion.planning, deletion.companion, deletion.conflicts[0].operationId, 'android');
    expect(accepted.planning).toEqual([]);
    expect(accepted.companion.tombstones[event.id]).toBeDefined();
  });

  it('restores a rejected local deletion when the PC version is chosen', () => {
    const store = mobile(); store.createEvent(event); const batch = sync(store); store.applySyncResponse(response(batch)); store.deleteEvent(event.id);
    batch.companion.eventRevisions[event.id]++;
    const deletion = sync(store, batch);
    const resolved = resolveCompanionConflict(deletion.planning, deletion.companion, deletion.conflicts[0].operationId, 'pc');
    store.applySyncResponse({ acknowledged: resolved.acknowledged, snapshot: companionSnapshot(resolved.planning, resolved.companion) });
    expect(store.snapshot().planning).toHaveLength(1); expect(store.snapshot().tombstones).toEqual([]);
  });

  it('keeps authoritative links and revisions when a redacted display snapshot arrives', () => {
    const store = mobile();
    store.replaceServerSnapshot({ schemaVersion: 3, planning: [{ ...event, revision: 12, providerLinks: { google: { remoteId: 'g', revision: 'etag', calendarId: 'c' } } }] });
    store.replaceServerSnapshot({ planning: [{ ...event, providers: { google: { status: 'synced' } } }] });
    expect(store.snapshot().planning[0]).toMatchObject({ revision: 12, providerLinks: { google: { remoteId: 'g', revision: 'etag', calendarId: 'c' } } });
  });

  it('does not repeat deletes already completed on Android while the PC was offline', async () => {
    const store = mobile(); store.createEvent(event);
    const adapter = { mutate: vi.fn(async (provider: string) => ({ remoteId: provider + '-remote' })) };
    const standalone = createStandaloneProviderSync({ store, adapter } as any);
    await standalone.apply('ONLINE_STANDALONE', store.snapshot().planning[0], 'create');
    const item = store.snapshot().planning[0]; store.deleteEvent(item.id);
    await standalone.apply('ONLINE_STANDALONE', item, 'delete');
    const batch = sync(store); const remote = providers();
    await drainCompanionProviders(batch.planning, batch.companion, remote, async () => {});
    expect(batch.planning).toEqual([]);
    expect(remote.google.create).not.toHaveBeenCalled(); expect(remote.google.delete).not.toHaveBeenCalled();
    expect(remote.twitch.create).not.toHaveBeenCalled(); expect(remote.twitch.delete).not.toHaveBeenCalled();
  });

  it('persists running intent before network I/O and preserves committed ACKs after a lost response', async () => {
    const store = mobile(); store.createEvent(event); const batch = sync(store);
    let disk = JSON.stringify(batch);
    const remote = providers();
    remote.google.create.mockImplementation(async () => {
      expect(JSON.parse(disk).companion.providerWork[event.id + ':google'].status).toBe('running');
      throw new Error('lost response');
    });
    await drainCompanionProviders(batch.planning, batch.companion, remote, async () => { disk = JSON.stringify(batch); });
    const restarted = JSON.parse(disk);
    const replay = sync(store, restarted);
    await drainCompanionProviders(replay.planning, replay.companion, remote, async () => {});
    expect(remote.google.create).toHaveBeenCalledTimes(1);
    expect(replay.acknowledged).toEqual(batch.acknowledged);
    expect(replay.companion.providerWork[event.id + ':google'].uncertain).toBe(true);
  });

  it('retires a provider import when the canonical Android journal arrives', () => {
    const store = mobile();
    store.createEvent({ ...event, providerLinks: { google: { status: 'synced', remoteId: 'g', calendarId: 'calendar' } } });
    const batch = reconcileCompanionBatch([{ ...event, id: 'google:calendar:g', ownership: 'EXTERNAL', providers: { google: { status: 'synced', remoteId: 'g', calendarId: 'calendar' } } }], [], emptyCompanionState(), store.snapshot().pending);
    expect(batch.planning.map(item => item.id)).toEqual([event.id]);
    expect(batch.companion.tombstones['google:calendar:g']).toBeDefined();
  });

  it('resolves a collection conflict with the chosen Android value', () => {
    const state = emptyCompanionState(); state.notes = [{ id: 'note', text: 'Desktop', revision: 2, updatedAt: '' }];
    const batch = reconcileCompanionBatch([], [], state, [{ id: 'note-edit', eventId: 'note', type: 'notes.upsert', baseRevision: 1, patch: { text: 'Android' } }]);
    const resolved = resolveCompanionConflict(batch.planning, batch.companion, 'note-edit', 'android');
    expect(resolved.companion.notes[0]).toMatchObject({ text: 'Android', revision: 3 });
  });
});
