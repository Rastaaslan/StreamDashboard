import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyzeTags, scoreTags, TwitchTagIntelligence, type ObservedStream } from '../packages/core/src/tag-intelligence.js';
import fixtures from './fixtures/tag-quality.json' with { type: 'json' };
import { editedTags, resolveTags } from '../packages/core/src/tags.js';
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
  it.each(Object.entries(fixtures))('quality gate fixture: %s', (_name, fixture) => {
    const observed = Array.from({ length: 10 }, () => ({ tags: fixture.tags, viewer_count: 200, language: 'en' }));
    const result = analyzeTags({ event: fixture.event, preferences: { language: 'fr' } }, observed);
    expect(result.recommended.map(value => value.tag)).toEqual(fixture.recommended);
    expect(result.recommended.length).toBeLessThan(10);
    expect(result.observedSuggestions.map(value => value.tag)).toContain('English');
    expect(result.observedSuggestions.every(value => value.score < 65)).toBe(true);
  });
  it('does not promote rare communities or popular unrelated games, and ranks repeated observations above singletons', () => {
    const observed = Array.from({ length: 20 }, (_, i) => ({ tags: ['OtherGame', 'Gaming', 'Fun', 'PC', 'DropsEnabled', ...(i === 0 ? ['UniqueServer123'] : [])], viewer_count: i === 0 ? 1_000_000 : 10, language: 'en' }));
    const result = analyzeTags(input, observed);
    expect(result.recommended.map(v => v.tag)).toEqual(['DeadIsland2', 'Action', 'Horror', 'Zombie', 'Halloween', 'French']);
    expect(result.observedSuggestions.find(v => v.tag === 'OtherGame')!.score).toBeGreaterThan(result.observedSuggestions.find(v => v.tag === 'UniqueServer123')!.score);
    expect(analyzeTags({ event: { title: 'Live' }, preferences: {} }, observed).recommended).toEqual([]);
  });
  it.each(['fr', 'FR', 'fr-FR', 'French', 'français'])('normalizes preferred and observed language aliases: %s', language => {
    const observed = [{ tags: ['Français', 'francais', 'French', 'English', 'Español', 'Spanish', 'Русский'], viewer_count: 10, language: 'fr' }];
    const result = analyzeTags({ ...input, preferences: { language } }, observed);
    expect(result).toEqual(analyzeTags(input, observed));
    expect(result.recommended.map(v => v.tag)).toContain('French');
    expect(result.observedSuggestions.map(v => v.tag)).toEqual(['English', 'Russian', 'Spanish']);
    expect(scoreTags({ ...input, preferences: {} }, observed).map(v => v.tag)).not.toContain('English');
    expect(scoreTags({ ...input, preferences: { language: 'en' } }, observed).map(v => v.tag)).toContain('English');
  });
  it('requires local confirmation for modes/personas, and gates seasonal tags by the format', () => {
    const observed = [{ tags: ['VTuber', 'Speedrun', 'Coop', 'Halloween'], viewer_count: 10, language: 'fr' }];
    expect(scoreTags({ ...input, event: { ...input.event, title: 'VTuber Speedrun en coop' } }, observed).map(v => v.tag)).toEqual(expect.arrayContaining(['VTuber', 'Speedrun', 'Coop']));
    expect(scoreTags({ ...input, event: { ...input.event, title: 'Live du 20 octobre' } }, observed).map(v => v.tag)).not.toContain('Halloween');
    const seasonalHistory = [saved({ title: 'Spooktober', twitchCategoryId: '27471', tags: { values: ['Horror', 'Halloween'], source: 'manual' } })];
    expect(scoreTags({ event: fixtures.minecraft.event, preferences: {} }, [], seasonalHistory).map(v => v.tag)).toEqual(['Minecraft', 'Modded']);
  });
  it('learns only validated game/series choices and persists explicit rejection, including empty selections', () => {
    const history = [saved({ twitchCategoryId: '42', tags: { values: ['GameChoice', 'Halloween'], source: 'manual' } }), saved({ id: 'series', seriesId: 'weekly', tags: { values: ['SeriesChoice'], source: 'generated', validated: true } }), saved({ id: 'unvalidated', twitchCategoryId: '42', tags: { values: ['Pollution'], source: 'generated' } }), saved({ id: 'special', seriesId: 'weekly', occurrenceKey: 'special', tags: { values: ['Birthday'], source: 'manual' } })];
    const event = { title: 'Live', twitchCategoryId: '42', seriesId: 'weekly' };
    expect(scoreTags({ event, preferences: {} }, [], history).map(v => v.tag)).toEqual(['GameChoice', 'SeriesChoice']);
    const tags = editedTags({ values: [], source: 'manual' }, history[0].tags)!;
    expect(tags.rejectedValues).toContain('GameChoice');
    history[0].tags = tags;
    expect(scoreTags({ event, preferences: {} }, [], history).map(v => v.tag)).toEqual(['SeriesChoice']);
    expect(scoreTags({ event: { title: 'Other', twitchCategoryId: '99' }, preferences: {} }, [], history)).toEqual([]);
    const rejected = saved({ twitchCategoryId: '42', tags: { values: [], source: 'manual', rejectedValues: ['Zombie'] } });
    expect(scoreTags(input, streams, [rejected]).map(v => v.tag)).not.toContain('Zombie');
    expect(scoreTags(input, streams).map(v => v.tag)).toContain('Zombie');
    const accepted = editedTags({ values: ['Zombie'], source: 'manual' }, rejected.tags)!;
    expect(accepted.rejectedValues).toEqual([]);
    expect(scoreTags(input, streams, [{ ...rejected, tags: accepted }]).map(v => v.tag)).toContain('Zombie');
  });
  it('caps confirmed choices at ten, without filling from observations', () => {
    const result = scoreTags({ event: { title: 'Live' }, preferences: { preferredTags: Array.from({ length: 15 }, (_, i) => `Tag${i}`) } });
    expect(result).toHaveLength(10);
    expect(new Set(result.map(v => v.tag)).size).toBe(10);
  });
  it('preflight excludes observations and old unvalidated generated tags, preserving explicit choices', async () => {
    const fixture = fixtures.minecraft;
    const engine = new TwitchTagIntelligence(async () => [{ tags: fixture.tags, viewer_count: 100, language: 'en' }]);
    await engine.refresh(fixture.event.twitchCategoryId);
    const resolved = await resolveTags({ ...fixture.event, tagPreferences: { language: 'fr' }, tags: { values: ['VTuber', 'English'], source: 'generated' } }, engine);
    expect(resolved.recommended).toEqual(fixture.recommended);
    expect(resolved.observedSuggestions!.map(v => v.tag)).toContain('VTuber');
    const updateChannel = vi.fn(async () => {});
    const preflight = new TwitchPreflight({ getChannel: async () => ({ title: '', gameId: '' }), searchGame: vi.fn(), updateChannel });
    await preflight.prepare({ eventId: 'next', title: fixture.event.title, categoryId: fixture.event.twitchCategoryId, tags: resolved.tags?.values });
    expect(updateChannel).toHaveBeenCalledWith({ title: fixture.event.title, gameId: fixture.event.twitchCategoryId, tags: fixture.recommended });
    expect((await resolveTags({ ...fixture.event, tags: { values: ['VTuber'], source: 'manual' } }, engine)).tags?.values).toEqual(['VTuber']);
    expect((await resolveTags({ ...fixture.event, tags: { values: [], source: 'manual' } }, engine)).tags?.values).toEqual([]);
  });
  it('keeps both outputs stable across cached refreshes, ordering and duplicate tags', async () => {
    const fixture = fixtures.minecraft;
    let observed = fixture.tags.map(tag => ({ tags: [tag, tag], viewer_count: 10, language: 'fr' }));
    const engine = new TwitchTagIntelligence(async () => observed);
    const request = { event: fixture.event, preferences: { language: 'fr' } };
    await engine.refresh(fixture.event.twitchCategoryId);
    const first = await engine.analyze(request);
    expect(await engine.analyze(request)).toEqual(first);
    observed = observed.reverse();
    await engine.refresh(fixture.event.twitchCategoryId, true);
    expect(await engine.analyze(request)).toEqual(first);
  });
  it('permits an empty recommendation set and honors unsaved rejections on regeneration', async () => {
    const engine = new TwitchTagIntelligence(async () => []);
    expect((await resolveTags({ title: 'Live' }, engine)).recommended).toEqual([]);
    const result = await resolveTags({ ...input.event, tags: { values: [], source: 'manual', rejectedValues: ['Zombie'] } }, engine, true);
    expect(result.recommended).not.toContain('Zombie');
    expect(result.recommended).toContain('DeadIsland2');
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
    expect(await engine.generate(input)).toContain('Zombie'); // Category evidence survives cache expiry.
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
