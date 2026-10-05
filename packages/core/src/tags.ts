import type { TagAnalysis } from './tag-intelligence.js';
import { generateTwitchTags, normalizeTwitchLanguage } from './twitch-tags.js';
import type { CalendarItem, TagMetadata, TagPreferences } from '../../contracts/src/index.js';

/** Adapter boundary only: the engine owns selection/ranking, Dashboard owns fallback. */
export interface TagEngine {
  analyze?(input: Parameters<TagEngine['generate']>[0], signal: AbortSignal): Promise<TagAnalysis>;
  generate(input: { event: Pick<CalendarItem, 'title' | 'description' | 'twitchCategoryId' | 'twitchCategoryName'> & Partial<Pick<CalendarItem, 'id' | 'seriesId' | 'recurrence' | 'occurrenceKey' | 'tags'>>; preferences: TagPreferences }, signal: AbortSignal): Promise<string[]>;
}
export function normalizeTags(value: unknown, limit = 10): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.filter((tag): tag is string => typeof tag === 'string').map(tag => tag.trim().normalize('NFC')).filter(tag => {
    const key = tag.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
    if (!/^[\p{L}\p{N}]+$/u.test(tag) || Array.from(tag).length > 25 || seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0, limit);
}
export function tagMetadata(value: unknown): TagMetadata | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const data = value as Partial<TagMetadata>;
  return { values: normalizeTags(data.values), source: data.source === 'generated' ? 'generated' : 'manual', ...(typeof data.generatedAt === 'string' ? { generatedAt: data.generatedAt } : {}), ...(data.validated === true ? { validated: true } : {}), ...(Array.isArray(data.acceptedValues) ? { acceptedValues: normalizeTags(data.acceptedValues) } : {}), ...(Array.isArray(data.rejectedValues) ? { rejectedValues: normalizeTags(data.rejectedValues, 100) } : {}) };
}
export function tagPreferences(value: unknown): TagPreferences {
  const data = (value && typeof value === 'object' ? value : {}) as Partial<TagPreferences>;
  return { automatic: data.automatic !== false, ...(Array.isArray(data.preferredTags) ? { preferredTags: normalizeTags(data.preferredTags) } : {}), ...(typeof data.language === 'string' ? { language: data.language.slice(0, 35) } : {}) };
}
export async function resolveTags(event: Pick<CalendarItem, 'title' | 'description' | 'twitchCategoryId' | 'twitchCategoryName' | 'tags' | 'tagPreferences'> & Partial<Pick<CalendarItem, 'id' | 'seriesId' | 'recurrence' | 'occurrenceKey'>>, engine?: TagEngine, force = false, timeoutMs = 1500): Promise<{ tags?: TagMetadata; recommended?: string[]; observedSuggestions?: TagAnalysis['observedSuggestions']; warning?: string }> {
  const validated = event.tags?.source === 'manual' || event.tags?.validated === true;
  if (!force && (validated || event.tagPreferences?.automatic === false)) return { tags: validated ? event.tags : undefined };
  const fallback = validated ? event.tags : undefined;
  if (!engine) return { tags: fallback, warning: 'Moteur de tags indisponible ; tags existants conservés.' };
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const values = await Promise.race([
      Promise.resolve().then((): Promise<TagAnalysis | string[]> => {
        const input = { event, preferences: tagPreferences(event.tagPreferences) };
        return engine.analyze ? engine.analyze(input, controller.signal) : engine.generate(input, controller.signal);
      }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => { reject(new Error('timeout')); controller.abort(); }, timeoutMs); }),
    ]);
    const analysis = Array.isArray(values) ? undefined : values;
    const normalized = normalizeTags(Array.isArray(values) ? values : values.recommended.map(value => value.tag));
    return { tags: { values: normalized, source: 'generated', generatedAt: new Date().toISOString() }, recommended: normalized, observedSuggestions: analysis?.observedSuggestions ?? [] };
  } catch {
    return { tags: fallback, warning: 'Génération des tags impossible ; tags existants conservés.' };
  } finally { clearTimeout(timer); }
}

/** Compatible CB-100 adapter for callers needing a purely local engine. */
export const localTagEngine: TagEngine = {
  async generate({ event, preferences }) {
    return generateTwitchTags({ category: event.twitchCategoryName, title: event.title, description: event.description, language: preferences.language });
  },
};

/** Persist explicit edits as scoped feedback on the existing calendar record. */
export function editedTags(value: unknown, previous?: TagMetadata): TagMetadata | undefined {
  const next = tagMetadata(value);
  if (!next) return next;
  const key = (value: string) => (normalizeTwitchLanguage(value) ?? value).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  const keys = new Set(next.values.map(key));
  const removed = (previous?.values ?? []).filter(value => !keys.has(key(value)));
  return { ...next, rejectedValues: normalizeTags([...(next.rejectedValues ?? []), ...(previous?.rejectedValues ?? []), ...removed], 100).filter(value => !keys.has(key(value))) };
}
