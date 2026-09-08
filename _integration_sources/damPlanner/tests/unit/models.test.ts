import { describe, expect, it } from 'vitest';
import { eventInputSchema, eventSchema } from '../../src/domain/models.js';

const baseInput = {
  kind: 'LIVE' as const,
  title: 'Test live',
  description: '',
  startAtUtc: '2026-09-04T18:00:00.000Z',
  endAtUtc: '2026-09-04T20:00:00.000Z',
  timezone: 'Europe/Paris',
  syncGoogle: false,
  syncTwitch: true,
  googleCalendarId: null,
  twitchTitle: 'Test live',
  twitchCategoryId: '509658',
  twitchCategoryName: 'Just Chatting',
  twitchCategoryBoxArtUrl: null,
};

describe('event schemas', () => {
  it('constructs and parses eventInputSchema at runtime', () => {
    expect(() => eventInputSchema.parse(baseInput)).not.toThrow();
  });

  it('applies shared refinements to input and persisted events', () => {
    const invalidInput = { ...baseInput, endAtUtc: '2026-09-04T18:10:00.000Z' };
    expect(eventInputSchema.safeParse(invalidInput).success).toBe(false);

    const persisted = {
      ...invalidInput,
      id: 'a4f56053-70fb-4d1a-b4d8-20d4ff2d2e31',
      conflictOverrideHash: null,
      conflictOverrideAt: null,
      createdAt: '2026-09-04T17:00:00.000Z',
      updatedAt: '2026-09-04T17:00:00.000Z',
      deletedAt: null,
    };
    expect(eventSchema.safeParse(persisted).success).toBe(false);
  });
});
