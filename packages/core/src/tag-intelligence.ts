import type { CalendarItem, TagPreferences } from '../../contracts/src/index.js';
import { generateTwitchTags, normalizeTwitchLanguage, normalizeTwitchTag } from './twitch-tags.js';
import type { TagEngine } from './tags.js';

export interface ObservedStream { tags: string[]; viewer_count: number; language: string }
type Input = Parameters<TagEngine['generate']>[0];
export interface TagSuggestion { tag: string; score: number; sources: string[] }
const seasonal = /^(halloween|spooktober)$/i;
const spooky = (event: Input['event']) => /\b(spooktober|halloween)\b/i.test(`${event.title} ${event.description ?? ''}`);
const seriesKey = (event: Partial<CalendarItem>) => event.seriesId || (event.recurrence ? event.id : undefined);

/** Observed frequency is additive; the strongest source determines the final score. */
export function scoreTags(input: Input, streams: readonly ObservedStream[] = [], history: readonly CalendarItem[] = []): TagSuggestion[] {
  const scores = new Map<string, TagSuggestion>();
  const add = (value: string, score: number, source: string) => {
    const tag = normalizeTwitchTag(value);
    if (!tag) return;
    const key = tag.toLowerCase();
    const existing = scores.get(key);
    if (existing) { existing.score = Math.max(existing.score, score); if (!existing.sources.includes(source)) existing.sources.push(source); }
    else scores.set(key, { tag, score, sources: [source] });
  };
  const { event, preferences } = input;
  for (const tag of preferences.preferredTags ?? []) add(tag, 10, 'channel');
  const learnedGame = new Set<string>(), learnedSeries = new Set<string>();
  for (const saved of history) {
    // Only saved user choices, never preflight output or occurrence exceptions.
    if (saved.occurrenceKey) continue;
    for (const tag of saved.tags?.values ?? []) {
      if (seasonal.test(tag) && !spooky(event)) continue;
      if (saved.id !== event.id && event.twitchCategoryId && saved.twitchCategoryId === event.twitchCategoryId) learnedGame.add(tag);
      if (seriesKey(event) && seriesKey(saved) === seriesKey(event)) learnedSeries.add(tag);
    }
  }
  for (const tag of learnedSeries) add(tag, 30, 'series');
  for (const tag of learnedGame) add(tag, 65, 'game-history');
  const observed = new Map<string, { tag: string; weight: number }>();
  const language = normalizeTwitchLanguage(preferences.language ?? '');
  streams.slice(0, 100).forEach((stream, rank) => {
    // A million viewers adds at most 0.25; frequency always dominates one celebrity.
    const audience = Math.min(0.25, Math.log10(1 + Math.max(0, stream.viewer_count || 0)) / 20);
    const weight = 1 + audience + 0.15 / (rank + 1) + (language && normalizeTwitchLanguage(stream.language) === language ? 0.25 : 0);
    const seen = new Set<string>();
    for (const raw of stream.tags) {
      const tag = normalizeTwitchTag(raw), key = tag?.toLowerCase();
      if (!tag || !key || seen.has(key) || (seasonal.test(tag) && !spooky(event))) continue;
      seen.add(key);
      const value = observed.get(key) ?? { tag, weight: 0 };
      value.weight += weight; observed.set(key, value);
    }
  });
  for (const { tag, weight } of observed.values()) add(tag, 45 + 15 * weight / Math.max(1, streams.length), 'twitch');
  for (const tag of generateTwitchTags({ title: event.title, description: event.description, language: preferences.language })) {
    if (tag !== 'Live') add(tag, 20, 'local');
  }
  for (const tag of generateTwitchTags({ category: event.twitchCategoryName })) if (tag !== 'Live') add(tag, 75, 'game');
  if (spooky(event)) { add('Halloween', 35, 'local'); add('Horror', 62, 'local'); }
  return [...scores.values()].sort((a, b) => b.score - a.score).slice(0, 10);
}

/** Bounded runtime stale-while-revalidate cache. No generation awaits network. */
export class TwitchTagIntelligence implements TagEngine {
  private cache = new Map<string, { streams: ObservedStream[]; expires: number }>();
  private pending = new Map<string, Promise<void>>();
  private retryAfter = new Map<string, number>();
  constructor(private fetchStreams: (gameId: string, signal: AbortSignal) => Promise<ObservedStream[]>,
    private history: () => readonly CalendarItem[] = () => [], private now = Date.now,
    private ttlMs = 6 * 60 * 60 * 1000, private timeoutMs = 800, private channelPreferences: () => TagPreferences = () => ({})) {}

  invalidate(gameId: string) { this.cache.delete(gameId); this.retryAfter.delete(gameId); }

  refresh(gameId: string, force = false): Promise<void> {
    if (!gameId) return Promise.resolve();
    const pending = this.pending.get(gameId);
    if (pending) return pending;
    if (!force && ((this.cache.get(gameId)?.expires ?? 0) > this.now() || (this.retryAfter.get(gameId) ?? 0) > this.now())) return Promise.resolve();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const work = Promise.race([
      Promise.resolve().then(() => this.fetchStreams(gameId, controller.signal)),
      new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(Error('tag refresh timeout')); }, this.timeoutMs); }),
    ]).then(streams => {
      this.cache.delete(gameId);
      this.cache.set(gameId, { streams: structuredClone(streams.slice(0, 100)), expires: this.now() + this.ttlMs });
      if (this.cache.size > 200) this.cache.delete(this.cache.keys().next().value!);
      this.retryAfter.delete(gameId);
    }).catch(() => {
      this.retryAfter.set(gameId, this.now() + 60_000);
      if (this.retryAfter.size > 200) this.retryAfter.delete(this.retryAfter.keys().next().value!);
    }).finally(() => { clearTimeout(timer); this.pending.delete(gameId); });
    this.pending.set(gameId, work);
    return work;
  }

  async generate(input: Input): Promise<string[]> {
    const channel = this.channelPreferences();
    input = { ...input, preferences: { ...channel, ...input.preferences, language: input.preferences.language || channel.language, preferredTags: [...(channel.preferredTags ?? []), ...(input.preferences.preferredTags ?? [])] } };
    const gameId = input.event.twitchCategoryId ?? '';
    void this.refresh(gameId);
    const result = scoreTags(input, this.cache.get(gameId)?.streams, this.history());
    return result.length ? result.map(value => value.tag) : ['Live'];
  }
}
