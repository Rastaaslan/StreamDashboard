/** Twitch custom tags: at most 10 tags, each 1–25 letters/digits. */
export const TWITCH_TAG_LIMIT = 10;
export const TWITCH_TAG_MAX_LENGTH = 25;

export interface TwitchTagInput {
  category?: string;
  game?: string;
  title?: string;
  description?: string;
  context?: readonly string[];
  /** Explicit language signal; language is never guessed from prose. */
  language?: string;
  /** Optional, already available Twitch data. No fetching or credentials needed.
   * Compatible with TwitchClient.getChannelMetadata()'s title/gameName fields.
   */
  twitch?: {
    title?: string;
    gameName?: string;
    tags?: readonly string[];
    language?: string;
  };
  preferredTags?: readonly string[];
  defaultTags?: readonly string[];
}

/** Locale-independent normalization. Overlong tags are rejected, never truncated. */
export function normalizeTwitchTag(value: string): string | undefined {
  const tag = value.normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]/gu, '');
  return isValidTwitchTag(tag) ? tag : undefined;
}

export function isValidTwitchTag(value: string): boolean {
  return /^[\p{L}\p{N}]+$/u.test(value) && Array.from(value).length <= TWITCH_TAG_MAX_LENGTH;
}

const rules: readonly (readonly [string, readonly string[]])[] = [
  ['JustChatting', ['just chatting', 'discussion', 'discussions', 'papotage', 'blabla']],
  ['Speedrun', ['speedrun', 'speedrunning']],
  ['Ranked', ['ranked', 'classe', 'classee', 'classees']],
  ['Coop', ['coop', 'co op', 'cooperatif', 'cooperative']],
  ['FirstPlaythrough', ['first playthrough', 'first time playing', 'premiere partie', 'decouverte']],
  ['Tutorial', ['tutorial', 'tutorials', 'tutoriel', 'tutoriels', 'tuto']],
  ['Challenge', ['challenge', 'defi']],
  ['Creative', ['art', 'drawing', 'dessin', 'painting', 'peinture']],
  ['Music', ['music', 'musique', 'guitar', 'guitare', 'piano']],
  ['Programming', ['software and game development', 'programming', 'coding', 'programmation', 'developpement']],
  ['Cooking', ['food and drink', 'food drink', 'cooking', 'cuisine', 'recette']],
  ['Chill', ['chill', 'relax', 'detente']],
];

function words(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

const languages: Readonly<Record<string, string>> = {
  fr: 'French', french: 'French', francais: 'French',
  en: 'English', english: 'English', anglais: 'English',
  es: 'Spanish', spanish: 'Spanish', espagnol: 'Spanish',
  de: 'German', german: 'German', allemand: 'German',
  it: 'Italian', italian: 'Italian', italien: 'Italian',
  pt: 'Portuguese', portuguese: 'Portuguese', portugais: 'Portuguese',
  ja: 'Japanese', japanese: 'Japanese', japonais: 'Japanese',
  ko: 'Korean', korean: 'Korean', coreen: 'Korean',
  zh: 'Chinese', chinese: 'Chinese', chinois: 'Chinese',
};

/** Shared canonical language tag for local suggestions and Helix language matching. */
export function normalizeTwitchLanguage(value: string): string | undefined {
  const language = words(value);
  const primary = language.split(' ')[0];
  return Object.hasOwn(languages, language) ? languages[language]
    : Object.hasOwn(languages, primary) ? languages[primary] : undefined;
}

/**
 * Pure, deterministic engine; never mutates input or uses network, AI, time or randomness.
 * Priority: explicit category/game, language, local text rules, existing Twitch tags,
 * preferences, defaults. First spelling wins case-insensitive duplicates.
 * Explicit title/category override Twitch metadata, including an empty string.
 * Unknown prose is not emitted as tags. A nonempty result is guaranteed by `Live`.
 */
export function generateTwitchTags(input: TwitchTagInput = {}): string[] {
  const category = input.category ?? input.twitch?.gameName ?? '';
  const title = input.title ?? input.twitch?.title ?? '';
  const sources = [category, input.game ?? '', title, input.description ?? '', ...(input.context ?? [])]
    .map(value => ` ${words(value)} `);
  const language = normalizeTwitchLanguage(input.language ?? input.twitch?.language ?? '');
  const candidates = [category, input.game ?? '', language ?? ''];
  for (const [tag, phrases] of rules) {
    if (sources.some(source => phrases.some(phrase => source.includes(` ${phrase} `)))) candidates.push(tag);
  }
  candidates.push(...(input.twitch?.tags ?? []), ...(input.preferredTags ?? []), ...(input.defaultTags ?? []));

  const tags: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const tag = normalizeTwitchTag(candidate);
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    tags.push(tag);
    if (tags.length === TWITCH_TAG_LIMIT) break;
  }
  return tags.length ? tags : ['Live'];
}
