import { generateTwitchTags } from './twitch-tags.js';
import type { CalendarItem, TagMetadata, TagPreferences } from '../../contracts/src/index.js';

/** Adapter boundary only: the engine owns selection/ranking, Dashboard owns fallback. */
export interface TagEngine {
  generate(input: { event: Pick<CalendarItem, 'title' | 'description' | 'twitchCategoryId' | 'twitchCategoryName'>; preferences: TagPreferences }, signal: AbortSignal): Promise<string[]>;
}
export function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.filter((tag): tag is string => typeof tag === 'string').map(tag => tag.trim().normalize('NFC')).filter(tag => {
    const key = tag.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
    if (!/^[\p{L}\p{N}]+$/u.test(tag) || Array.from(tag).length > 25 || seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0, 10);
}
export function tagMetadata(value: unknown): TagMetadata | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const data = value as Partial<TagMetadata>;
  return { values: normalizeTags(data.values), source: data.source === 'generated' ? 'generated' : 'manual', ...(typeof data.generatedAt === 'string' ? { generatedAt: data.generatedAt } : {}) };
}
export function tagPreferences(value: unknown): TagPreferences {
  const data = (value && typeof value === 'object' ? value : {}) as Partial<TagPreferences>;
  return { automatic: data.automatic !== false, ...(typeof data.language === 'string' ? { language: data.language.slice(0, 35) } : {}) };
}
export async function resolveTags(event: Pick<CalendarItem, 'title' | 'description' | 'twitchCategoryId' | 'twitchCategoryName' | 'tags' | 'tagPreferences'>, engine?: TagEngine, force = false, timeoutMs = 1500): Promise<{ tags?: TagMetadata; warning?: string }> {
  if (!force && (event.tags?.values.length || event.tagPreferences?.automatic === false)) return { tags: event.tags };
  const fallback = event.tags?.values.length ? event.tags : undefined;
  if (!engine) return { tags: fallback, warning: 'Moteur de tags indisponible ; tags existants conservés.' };
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const values = await Promise.race([
      Promise.resolve().then(() => engine.generate({ event: { title: event.title, description: event.description, twitchCategoryId: event.twitchCategoryId, twitchCategoryName: event.twitchCategoryName }, preferences: tagPreferences(event.tagPreferences) }, controller.signal)),
      new Promise<never>((_, reject) => { timer = setTimeout(() => { reject(new Error('timeout')); controller.abort(); }, timeoutMs); }),
    ]);
    const normalized = normalizeTags(values);
    if (!normalized.length) throw new Error('empty tags');
    return { tags: { values: normalized, source: 'generated', generatedAt: new Date().toISOString() } };
  } catch {
    return { tags: fallback, warning: 'Génération des tags impossible ; tags existants conservés.' };
  } finally { clearTimeout(timer); }
}

/** Production default: CB-100's deterministic engine, with no external API. */
export const localTagEngine: TagEngine = {
  async generate({ event, preferences }) {
    return generateTwitchTags({ category: event.twitchCategoryName, title: event.title, description: event.description, language: preferences.language });
  },
};
