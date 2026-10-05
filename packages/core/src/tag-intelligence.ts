import type { CalendarItem, TagPreferences } from '../../contracts/src/index.js';
import { generateTwitchTags, normalizeTwitchLanguage, normalizeTwitchTag } from './twitch-tags.js';
import type { TagEngine } from './tags.js';

export interface ObservedStream { tags: string[]; viewer_count: number; language: string }
type Input = Parameters<TagEngine['generate']>[0];
export interface TagSuggestion { tag: string; score: number; sources: string[] }
const seasonal = /^(halloween|spooktober)$/i;
const spooky = (event: Input['event']) => /\b(spooktober|halloween)\b/i.test(`${event.title} ${event.description ?? ''}`);
const seriesKey = (event: Partial<CalendarItem>) => event.seriesId || (event.recurrence ? event.id : undefined);

const canonical = (value: string) => normalizeTwitchLanguage(value) ?? normalizeTwitchTag(value);
const keyOf = (value: string) => canonical(value)?.toLowerCase();
const words = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export interface TagAnalysis { recommended: TagSuggestion[]; observedSuggestions: TagSuggestion[] }

/** Mining can rank confirmed concepts, but can never establish local relevance. */
export function analyzeTags(input: Input, streams: readonly ObservedStream[] = [], history: readonly CalendarItem[] = []): TagAnalysis {
  const scores = new Map<string, TagSuggestion>();
  const add = (value: string, score: number, source: string) => {
    const tag = canonical(value);
    if (!tag) return;
    const key = tag.toLowerCase(), existing = scores.get(key);
    if (existing) { existing.score = Math.max(existing.score, score); if (!existing.sources.includes(source)) existing.sources.push(source); }
    else scores.set(key, { tag, score, sources: [source] });
  };
  const { event, preferences } = input;
  const language = normalizeTwitchLanguage(preferences.language ?? '');
  const explicit = new Set((preferences.preferredTags ?? []).map(keyOf));
  const languageAllowed = (tag: string) => !normalizeTwitchLanguage(tag) || normalizeTwitchLanguage(tag) === language || explicit.has(keyOf(tag));
  const rejected = new Set<string>();
  // A draft replaces only its own saved version; other events retain their feedback.
  const effectiveHistory = event.tags && event.id
    ? history.filter(saved => saved.id !== event.id || saved.occurrenceKey !== event.occurrenceKey) : history;
  for (const saved of [...effectiveHistory, ...(event.tags ? [event] : [])]) {
    if (saved.occurrenceKey) continue;
    const sameGame = !!event.twitchCategoryId && saved.twitchCategoryId === event.twitchCategoryId;
    const sameSeries = !!seriesKey(event) && seriesKey(saved) === seriesKey(event);
    if (!sameGame && !sameSeries) continue;
    for (const tag of saved.tags?.rejectedValues ?? []) { const key = keyOf(tag); if (key) rejected.add(key); }
    const accepted = saved.tags?.source === 'manual' || saved.tags?.validated
      ? saved.tags?.values ?? [] : (saved.tags?.acceptedValues ?? []).filter(tag => saved.tags?.values.some(value => keyOf(value) === keyOf(tag)));
    for (const tag of accepted) {
      if (((seasonal.test(tag) || (keyOf(tag) === 'horror' && spooky(saved))) && !spooky(event)) || !languageAllowed(tag)) continue;
      add(tag, sameGame ? 85 : 80, sameGame ? 'game-history' : 'series');
    }
  }
  for (const tag of preferences.preferredTags ?? []) add(tag, 88, 'channel');
  for (const tag of generateTwitchTags({ title: event.title, description: event.description, language: preferences.language })) {
    if (tag !== 'Live') add(tag, 70, 'local');
  }
  for (const tag of generateTwitchTags({ category: event.twitchCategoryName })) if (tag !== 'Live') add(tag, 100, 'game');
  if (spooky(event)) { add('Horror', 80, 'local'); add('Halloween', 80, 'local'); }
  const context = words(`${event.title} ${event.description ?? ''}`);
  // Positive semantic rules: specific genres/formats need evidence in this live.
  const concepts: [string, RegExp][] = [
    ['Modded', /\b(all\s*the\s*mods|modded|modpack|mods)(?=\b|\d)/],
    ['Survival', /\b(survival|survie)\b/], ['Adventure', /\b(adventure|aventure)\b/],
    ['Zombie', /\bzombies?\b/], ['Action', /\baction\b/], ['Horror', /\b(horror|horreur)\b/],
  ];
  for (const [tag, pattern] of concepts) if (pattern.test(context)) add(tag, 70, 'local');
  // Small positive category taxonomy; it never infers a player's mode (e.g. co-op).
  if (/^dead island(?: 2)?$/.test(words(event.twitchCategoryName ?? ''))) {
    add('Horror', 90, 'game'); add('Zombie', 90, 'game'); add('Action', 90, 'game');
  }
  const observed = new Map<string, { tag: string; count: number; weight: number }>();
  const sample = streams.slice(0, 100);
  for (const stream of sample) {
    const seen = new Set<string>();
    for (const raw of stream.tags) {
      const tag = canonical(raw), key = tag?.toLowerCase();
      if (!tag || !key || seen.has(key)) continue;
      seen.add(key);
      const value = observed.get(key) ?? { tag, count: 0, weight: 0 };
      value.count++; value.weight += 1 + Math.min(0.25, Math.log10(1 + Math.max(0, stream.viewer_count || 0)) / 20);
      observed.set(key, value);
    }
  }
  for (const [key, value] of observed) {
    // Exact word/phrase confirmation avoids substring matches such as SMP in prose.
    const phrase = words(value.tag);
    if (phrase && ` ${context} `.includes(` ${phrase} `) && languageAllowed(value.tag) && (!seasonal.test(value.tag) || spooky(event))) add(value.tag, 70, 'local');
    const local = scores.get(key);
    if (local) { local.score += Math.min(4, value.count / Math.max(1, sample.length) * 4); local.sources.push('twitch'); }
  }
  for (const [key, value] of scores) {
    if (!languageAllowed(value.tag)) scores.delete(key);
    else if (rejected.has(key) && !explicit.has(key)) { value.score -= 60; value.sources.push('rejected'); }
  }
  const sort = (a: TagSuggestion, b: TagSuggestion) => b.score - a.score || a.tag.localeCompare(b.tag, 'en');
  const recommended = [...scores.values()].filter(value => value.score >= 65).sort(sort).slice(0, 10);
  const selected = new Set(recommended.map(value => keyOf(value.tag)));
  const observedSuggestions = [...observed.entries()].filter(([key]) => !selected.has(key)).map(([key, value]) => ({
    tag: value.tag,
    // Singleton/persona/server tags remain low confidence even on a large channel.
    score: Math.max(0, Math.min(40, 30 * value.count / Math.max(1, sample.length) + Math.min(4, value.weight - value.count)) - (value.count < 2 ? 10 : 0) - (rejected.has(key) ? 25 : 0)),
    sources: ['twitch', ...(rejected.has(key) ? ['rejected'] : [])],
  })).sort(sort).slice(0, 30);
  return { recommended, observedSuggestions };
}

/** Compatibility helper: only high-confidence tags are eligible for auto-application. */
export function scoreTags(input: Input, streams: readonly ObservedStream[] = [], history: readonly CalendarItem[] = []): TagSuggestion[] {
  return analyzeTags(input, streams, history).recommended;
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

  async analyze(input: Input): Promise<TagAnalysis> {
    const channel = this.channelPreferences();
    input = { ...input, preferences: { ...channel, ...input.preferences, language: input.preferences.language || channel.language, preferredTags: [...(channel.preferredTags ?? []), ...(input.preferences.preferredTags ?? [])] } };
    const gameId = input.event.twitchCategoryId ?? '';
    void this.refresh(gameId);
    return analyzeTags(input, this.cache.get(gameId)?.streams, this.history());
  }
  async generate(input: Input): Promise<string[]> {
    return (await this.analyze(input)).recommended.map(value => value.tag);
  }
}
