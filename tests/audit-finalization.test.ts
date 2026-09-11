import { describe, expect, it, vi } from 'vitest';
import { PlanningOrchestrator, type PlanningProvider } from '../packages/core/src/planning.js';
import { TwitchPreflight } from '../integrations/twitch/src/preflight.js';
import type { CalendarItem } from '../packages/contracts/src/index.js';

const baseEvent = {
  title: 'Live final',
  startAtUtc: '2030-01-01T10:00:00.000Z',
  endAtUtc: '2030-01-01T11:00:00.000Z',
  category: 'live' as const,
  kind: 'LIVE' as const,
};

function provider(): PlanningProvider & { update: ReturnType<typeof vi.fn> } {
  return {
    create: vi.fn(async () => ({ id: 'remote' })),
    update: vi.fn(async () => ({ revision: 'etag-after' })),
    delete: vi.fn(async () => undefined),
  };
}

describe('résolution de conflit sûre', () => {
  it('garder local transmet la dernière révision distante et ne ferme le conflit qu’après succès', async () => {
    const google = provider();
    const items: CalendarItem[] = [{
      id: 'local-1', localId: 'local-1', ...baseEvent, ownership: 'LOCAL', editable: true,
      desiredPublication: { local: true, twitch: false, google: true },
      providers: { google: { status: 'conflict', remoteId: 'g1', calendarId: 'primary', remoteRevision: 'etag-remote' } },
      conflict: { provider: 'google', detectedAt: '2030-01-01T09:00:00.000Z', remote: { ...baseEvent, title: 'Remote title' } },
    }];
    const planning = new PlanningOrchestrator(items, { google }, async () => undefined);
    const resolved = await planning.resolveConflict('local-1', 'google', 'local');
    expect(google.update).toHaveBeenCalledWith('g1', expect.objectContaining({ title: 'Live final' }), 'etag-remote');
    expect(resolved.conflict).toBeUndefined();
    expect(resolved.providers?.google).toMatchObject({ status: 'synced', remoteRevision: 'etag-after' });
  });

  it('garder local conserve le conflit et la révision si l’écriture distante échoue', async () => {
    const google = provider();
    google.update.mockRejectedValueOnce(new Error('412 precondition failed'));
    const items: CalendarItem[] = [{
      id: 'local-1', localId: 'local-1', ...baseEvent, ownership: 'LOCAL', editable: true,
      desiredPublication: { local: true, twitch: false, google: true },
      providers: { google: { status: 'conflict', remoteId: 'g1', calendarId: 'primary', remoteRevision: 'etag-remote' } },
      conflict: { provider: 'google', detectedAt: '2030-01-01T09:00:00.000Z', remote: { ...baseEvent, title: 'Remote title' } },
    }];
    const planning = new PlanningOrchestrator(items, { google }, async () => undefined);
    await expect(planning.resolveConflict('local-1', 'google', 'local')).rejects.toThrow(/412/);
    const current = planning.all()[0];
    expect(current.conflict).toMatchObject({ provider: 'google' });
    expect(current.providers?.google).toMatchObject({ status: 'conflict', remoteRevision: 'etag-remote', lastError: '412 precondition failed' });
  });
});

describe('préflight Twitch optimisé', () => {
  it('réutilise un game_id connu sans rechercher à nouveau la catégorie', async () => {
    const api = {
      getChannel: vi.fn(async () => ({ title: 'Ancien', gameId: '0' })),
      searchGame: vi.fn(async () => [{ id: '32399', name: 'Counter-Strike 2' }]),
      updateChannel: vi.fn(async () => undefined),
    };
    const preflight = new TwitchPreflight(api);
    const result = await preflight.prepare({
      eventId: 'event-1', title: 'Live CS2', category: 'Counter-Strike 2', categoryId: '32399',
    });
    expect(result).toMatchObject({ status: 'ready', gameId: '32399' });
    expect(api.searchGame).not.toHaveBeenCalled();
    expect(api.updateChannel).toHaveBeenCalledWith({ title: 'Live CS2', gameId: '32399' });
  });
});
