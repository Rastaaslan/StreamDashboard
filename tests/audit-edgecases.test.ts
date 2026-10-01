import { describe, expect, it, vi } from 'vitest';
import { PlanningOrchestrator, type PlanningProvider } from '../packages/core/src/planning.js';
import type { CalendarItem } from '../packages/contracts/src/index.js';

function provider(): PlanningProvider & {
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
} {
  return {
    create: vi.fn(async () => ({ id: 'created' })),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => undefined),
  };
}

const event = {
  title: 'Live',
  startAtUtc: '2030-01-01T10:00:00.000Z',
  endAtUtc: '2030-01-01T11:00:00.000Z',
  category: 'live' as const,
  kind: 'LIVE' as const,
};

describe('audit planning edge cases', () => {
  it('retry d’une destination déjà désactivée et sans objet distant est idempotent', async () => {
    const twitch = provider();
    const items: CalendarItem[] = [{
      id: 'local', ...event, ownership: 'LOCAL', editable: true,
      desiredPublication: { local: true, twitch: false, google: false },
      providers: { twitch: { status: 'error', lastError: 'ancienne erreur' } },
    }];
    const planning = new PlanningOrchestrator(items, { twitch }, async () => undefined);
    const result = await planning.retry('local', 'twitch');
    expect(twitch.create).not.toHaveBeenCalled();
    expect(twitch.update).not.toHaveBeenCalled();
    expect(twitch.delete).not.toHaveBeenCalled();
    expect(result.providers?.twitch).toMatchObject({ status: 'not-published', deletedRemotely: false });
    expect(result.providers?.twitch?.lastError).toBeUndefined();
  });

  it('un ancien twitchSegmentId sans ProviderLink est mis à jour au lieu de créer un doublon', async () => {
    const twitch = provider();
    const items: CalendarItem[] = [{
      id: 'legacy', ...event, ownership: 'LOCAL', editable: true,
      twitchSegmentId: 'legacy-segment',
      desiredPublication: { local: true, twitch: true, google: false },
      providers: {},
    }];
    const planning = new PlanningOrchestrator(items, { twitch }, async () => undefined);
    const result = await planning.update('legacy', { ...event, title: 'Live modifié' });
    expect(twitch.update).toHaveBeenCalledWith('legacy-segment', expect.objectContaining({ title: 'Live modifié' }), undefined);
    expect(twitch.create).not.toHaveBeenCalled();
    expect(result.providers?.twitch).toMatchObject({ status: 'synced', remoteId: 'legacy-segment' });
  });
});
