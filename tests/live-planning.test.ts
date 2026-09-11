import { describe, expect, it } from 'vitest';
import {
  createUnplannedLiveItem,
  finalizeUnplannedLive,
  findScheduledLiveForStart,
  findUnplannedDraft,
} from '../packages/core/src/live-planning.js';
import type { CalendarItem } from '../packages/contracts/src/index.js';

const now = Date.parse('2030-01-01T20:00:00.000Z');

function planned(overrides: Partial<CalendarItem> = {}): CalendarItem {
  return {
    id: 'planned', title: 'Live prévu', category: 'live', kind: 'LIVE',
    startAtUtc: new Date(now + 10 * 60_000).toISOString(),
    endAtUtc: new Date(now + 2 * 60 * 60_000).toISOString(),
    ...overrides,
  };
}

describe('suivi des lives non programmés', () => {
  it('réutilise un live prévu qui commence bientôt au lieu de créer un doublon', () => {
    expect(findScheduledLiveForStart([planned()], now)?.id).toBe('planned');
    expect(findScheduledLiveForStart([planned({ startAtUtc: new Date(now + 40 * 60_000).toISOString() })], now)).toBeUndefined();
  });

  it('crée un brouillon local-only puis le finalise à l’arrêt réel', () => {
    const item = createUnplannedLiveItem({ id: 'adhoc', now, title: 'Live surprise', twitchCategoryId: '123' });
    expect(item).toMatchObject({ id: 'adhoc', title: 'Live surprise', draft: true, ownership: 'LOCAL', desiredPublication: { local: true, twitch: false, google: false }, twitchCategoryId: '123' });
    expect(Date.parse(item.endAtUtc)).toBeGreaterThan(now);
    const ended = finalizeUnplannedLive(item, now + 95 * 60_000);
    expect(ended.draft).toBe(false);
    expect(ended.endAtUtc).toBe(new Date(now + 95 * 60_000).toISOString());
  });

  it('retrouve le brouillon après redémarrage sans capturer un événement publié', () => {
    const draft = createUnplannedLiveItem({ id: 'adhoc', now });
    const published = { ...createUnplannedLiveItem({ id: 'published', now }), desiredPublication: { local: true, twitch: true, google: false } };
    expect(findUnplannedDraft([published, draft])?.id).toBe('adhoc');
    expect(findUnplannedDraft([draft], 'adhoc')?.id).toBe('adhoc');
  });
});
