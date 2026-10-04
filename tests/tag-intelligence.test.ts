import { afterEach, describe, expect, it, vi } from 'vitest';
import { scoreTags, TwitchTagIntelligence, type ObservedStream } from '../packages/core/src/tag-intelligence.js';
import { resolveTags } from '../packages/core/src/tags.js';
import { TwitchClient } from '../integrations/twitch/src/client.js';
import { TwitchPreflight } from '../integrations/twitch/src/preflight.js';
import type { CalendarItem } from '../packages/contracts/src/index.js';

const input = { event: { title: 'Spooktober', twitchCategoryId: '42', twitchCategoryName: 'Dead Island 2' }, preferences: { language: 'fr' } };
const streams: ObservedStream[] = [
  { tags: ['Celebrity', 'Celebrity'], viewer_count: 1_000_000, language: 'en' },
  { tags: ['Horror', 'Zombie', 'Action', 'Coop'], viewer_count: 30, language: 'fr' },
  { tags: ['horror', 'Zombie', 'Action', 'Coop'], viewer_count: 10, language: 'fr' },
  { tags: ['Horror', 'Zombie', 'Action', 'Halloween'], viewer_count: 5, language: 'en' },
];
const saved = (patch: Partial<CalendarItem>): CalendarItem => ({ id: 'past', title: 'Live', startAtUtc: '2026-10-01T10:00:00Z', endAtUtc: '2026-10-01T11:00:00Z', ...patch });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('Twitch tag intelligence v2', () => {
  it('combines game, observed genres and Spooktober without leaking Halloween to October', () => {
    const result = scoreTags(input, streams);
    expect(result[0].tag).toBe('DeadIsland2');
    expect(result.map(v => v.tag)).toEqual(expect.arrayContaining(['Horror', 'Zombie', 'Action', 'Coop', 'Halloween']));
    expect(result.find(v => v.tag === 'Zombie')!.score).toBeGreaterThan(result.find(v => v.tag === 'Celebrity')!.score);
    const ordinary = scoreTags({ ...input, event: { ...input.event, title: 'Live du 20 octobre' } }, streams);
    expect(ordinary.map(v => v.tag)).not.toContain('Halloween');
    expect(result.find(v => v.tag === 'Horror')!.sources).toEqual(expect.arrayContaining(['twitch', 'local']));
  });
  it('prefers the explicit language, normalizes, deduplicates and caps at ten', () => {
    const observed = [{ tags: ['EnglishOnly'], viewer_count: 10, language: 'en' }, { tags: ['Français', 'francais'], viewer_count: 10, language: 'fr' }];
    const scored = scoreTags(input, observed);
    expect(scored.find(v => v.tag === 'Francais')!.score).toBeGreaterThan(scored.find(v => v.tag === 'EnglishOnly')!.score);
    const result = scoreTags(input, [{ tags: ['', 'a'.repeat(26), ...Array.from({ length: 20 }, (_, i) => `Tag${i}`)], viewer_count: 0, language: 'fr' }]);
    expect(result).toHaveLength(10);
    expect(new Set(result.map(v => v.tag.toLowerCase())).size).toBe(10);
    expect(result.every(v => /^[\p{L}\p{N}]{1,25}$/u.test(v.tag))).toBe(true);
  });
  it.each(['fr', 'FR', 'fr-FR', 'French', 'français'])('weights French aliases identically at the ten-tag cutoff: %s', language => {
    const frenchTags = Array.from({ length: 6 }, (_, i) => `Francophone${i}`);
    const englishTags = Array.from({ length: 6 }, (_, i) => `Anglophone${i}`);
    const observed = [
      { tags: englishTags, viewer_count: 10, language: 'en' },
      { tags: frenchTags, viewer_count: 10, language: 'fr' },
    ];
    const event = { title: 'Live', twitchCategoryName: 'Minecraft' };
    const result = scoreTags({ event, preferences: { language } }, observed);
    expect(result).toEqual(scoreTags({ event, preferences: { language: 'fr' } }, observed));
    expect(result).toHaveLength(10);
    expect(result.map(value => value.tag)).toEqual(['Minecraft', ...frenchTags, ...englishTags.slice(0, 3)]);
    expect(result.find(value => value.tag === frenchTags[0])!.score)
      .toBeGreaterThan(result.find(value => value.tag === englishTags[0])!.score);
  });
  it('learns saved game and series choices, with occurrence exceptions isolated', () => {
    const history = [saved({ twitchCategoryId: '42', tags: { values: ['GameChoice', 'Halloween'], source: 'manual' } }), saved({ id: 'series', seriesId: 'weekly', tags: { values: ['SeriesChoice'], source: 'generated' } }), saved({ id: 'special', seriesId: 'weekly', occurrenceKey: 'special', tags: { values: ['Birthday'], source: 'manual' } })];
    const result = scoreTags({ event: { title: 'Live', twitchCategoryId: '42', seriesId: 'weekly' }, preferences: { preferredTags: ['ChannelChoice'] } }, [], history);
    expect(result.map(v => v.tag)).toEqual(['GameChoice', 'SeriesChoice', 'ChannelChoice']);
    expect(scoreTags({ event: { title: 'Other', twitchCategoryId: '99' }, preferences: {} }, [], history)).toEqual([]);
  });
  it('returns immediately on miss, coalesces refreshes, serves fresh cache without calls, expires and invalidates', async () => {
    let now = 1;
    let complete!: (value: ObservedStream[]) => void;
    const fetchStreams = vi.fn(() => new Promise<ObservedStream[]>(resolve => { complete = resolve; }));
    const engine = new TwitchTagIntelligence(fetchStreams, () => [], () => now);
    expect(await engine.generate(input)).toContain('DeadIsland2');
    await engine.generate(input);
    expect(fetchStreams).toHaveBeenCalledTimes(1);
    const refresh = engine.refresh('42'); complete(streams); await refresh;
    expect(await engine.generate(input)).toContain('Zombie');
    expect(fetchStreams).toHaveBeenCalledTimes(1);
    now += 6 * 60 * 60 * 1000;
    await engine.generate(input); expect(fetchStreams).toHaveBeenCalledTimes(2);
    const expired = engine.refresh('42'); complete([]); await expired;
    expect(await engine.generate(input)).not.toContain('Zombie');
    engine.invalidate('42'); await engine.generate(input); expect(fetchStreams).toHaveBeenCalledTimes(3);
    const invalidated = engine.refresh('42'); complete([]); await invalidated;
  });
  it('bounds hung refreshes, aborts, backs off errors and never delays generation/preflight', async () => {
    vi.useFakeTimers();
    let signal!: AbortSignal;
    const fetchStreams = vi.fn((_id, value) => { signal = value; return new Promise<ObservedStream[]>(() => {}); });
    const engine = new TwitchTagIntelligence(fetchStreams);
    const resolved = await resolveTags(input.event, engine);
    expect(resolved.tags?.values).toContain('DeadIsland2');
    expect(signal.aborted).toBe(false);
    const updateChannel = vi.fn(async () => {});
    const preflight = new TwitchPreflight({ getChannel: async () => ({ title: '', gameId: '' }), searchGame: vi.fn(), updateChannel });
    expect(await preflight.prepare({ eventId: 'next', title: 'Spooktober', categoryId: '42', tags: resolved.tags?.values })).toMatchObject({ status: 'ready' });
    const refresh = engine.refresh('42'); await vi.advanceTimersByTimeAsync(800); await refresh;
    expect(signal.aborted).toBe(true);
    await engine.generate(input); expect(fetchStreams).toHaveBeenCalledTimes(1);
    const manual = { ...input.event, tags: { values: ['MyOverride'], source: 'manual' as const } };
    expect(await resolveTags(manual, engine)).toEqual({ tags: manual.tags });
    expect(fetchStreams).toHaveBeenCalledTimes(1);
  });
  it('handles network failure and empty games without repeated calls', async () => {
    for (const response of [async () => { throw Error('offline'); }, async () => []]) {
      const fetchStreams = vi.fn(response);
      const engine = new TwitchTagIntelligence(fetchStreams);
      await engine.refresh('42');
      expect(await engine.generate(input)).toContain('DeadIsland2');
      await engine.generate(input); expect(fetchStreams).toHaveBeenCalledTimes(1);
    }
  });
  it('makes exactly one authenticated Get Streams first=100 and ignores pagination', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: streams, pagination: { cursor: 'ignored' } })));
    vi.stubGlobal('fetch', fetchMock);
    const client = new TwitchClient({ clientId: 'client', accessToken: 'token', refreshToken: '', broadcasterId: '1', userName: 'test', displayName: 'Test' });
    expect(await client.getStreamsForGame('42', new AbortController().signal)).toEqual(streams);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('https://api.twitch.tv/helix/streams?game_id=42&first=100', expect.objectContaining({ headers: { Authorization: 'Bearer token', 'Client-Id': 'client' } }));
    client.close();
  });
});
