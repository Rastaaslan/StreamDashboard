import { describe, expect, it, vi } from 'vitest';
import { generateTwitchTags, isValidTwitchTag, normalizeTwitchTag } from '../packages/core/src/twitch-tags.js';

describe('Twitch tag engine', () => {
  it('works without input or usable signals', () => {
    expect(generateTwitchTags()).toEqual(['Live']);
    expect(generateTwitchTags({ title: 'Bonjour tout le monde', defaultTags: ['', '🎮', 'a'.repeat(26)] })).toEqual(['Live']);
  });

  it('uses category, game, title, description and context without manual tags', () => {
    expect(generateTwitchTags({ category: 'Minecraft', title: 'Découverte en co-op !', description: 'Un défi en détente', context: ['Tutoriel'] }))
      .toEqual(['Minecraft', 'Coop', 'FirstPlaythrough', 'Tutorial', 'Challenge', 'Chill']);
    expect(generateTwitchTags({ game: 'Baldur’s Gate 3' })).toEqual(['BaldursGate3']);
  });

  it.each([
    ['Just Chatting', 'JustChatting'], ['Art', 'Creative'], ['Music', 'Music'],
    ['Software and Game Development', 'Programming'], ['Food & Drink', 'Cooking'],
  ])('recognizes the %s category', (category, tag) => {
    expect(generateTwitchTags({ category })).toContain(tag);
  });

  it('recognizes English text and accented French with word boundaries', () => {
    expect(generateTwitchTags({ title: 'RANKED speedrun / first playthrough', description: 'Guitare et programmation' }))
      .toEqual(['Speedrun', 'Ranked', 'FirstPlaythrough', 'Music', 'Programming']);
    expect(generateTwitchTags({ title: 'artificial apartment cooperativeish speedrunner', context: ['first', 'playthrough'] })).toEqual(['Live']);
  });

  it('uses existing Twitch metadata and tags without network calls', () => {
    const fetch = vi.fn(() => { throw new Error('No network allowed'); });
    vi.stubGlobal('fetch', fetch);
    try {
      expect(generateTwitchTags({ twitch: { gameName: 'Chess', title: 'Ranked', language: 'fr', tags: ['Strategy', 'chess'] } }))
        .toEqual(['Chess', 'French', 'Ranked', 'Strategy']);
      expect(fetch).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });

  it('lets explicit metadata override stale Twitch values', () => {
    expect(generateTwitchTags({ category: 'Art', title: '', language: 'en', twitch: { gameName: 'Chess', title: 'Ranked', language: 'fr' } }))
      .toEqual(['Art', 'English', 'Creative']);
    expect(generateTwitchTags({ category: '', twitch: { gameName: 'Chess' } })).toEqual(['Live']);
  });

  it('uses optional preferences and defaults, deduplicating across every source', () => {
    expect(generateTwitchTags({ category: 'Just Chatting', language: 'fr-FR', twitch: { tags: ['JUSTCHATTING', 'Communauté'] }, preferredTags: ['Communaute', 'French', 'Fun'], defaultTags: ['fun', 'Bienvenue'] }))
      .toEqual(['JustChatting', 'French', 'Communaute', 'Fun', 'Bienvenue']);
    expect(generateTwitchTags({ defaultTags: ['Community'] })).toEqual(['Community']);
  });

  it('does not guess language or identity from prose', () => {
    expect(generateTwitchTags({ title: 'Bonjour hello', language: 'unknown' })).toEqual(['Live']);
  });

  it.each(['constructor', 'constructor-US'])('ignores inherited language key %s in explicit input', language => {
    expect(generateTwitchTags({ language })).toEqual(['Live']);
    expect(generateTwitchTags({ language, category: 'Chess' })).toEqual(['Chess']);
  });

  it.each(['constructor', 'constructor-US'])('ignores inherited language key %s in Twitch metadata', language => {
    expect(generateTwitchTags({ twitch: { language } })).toEqual(['Live']);
    expect(generateTwitchTags({ twitch: { language, gameName: 'Chess' } })).toEqual(['Chess']);
  });

  it('caps output at ten in documented priority order', () => {
    expect(generateTwitchTags({ category: 'Chess', language: 'en', title: 'ranked', twitch: { tags: ['Chess', ...Array.from({ length: 12 }, (_, i) => `Tag${i}`)] }, preferredTags: ['Preference'], defaultTags: ['Default'] }))
      .toEqual(['Chess', 'English', 'Ranked', 'Tag0', 'Tag1', 'Tag2', 'Tag3', 'Tag4', 'Tag5', 'Tag6']);
  });

  it('is repeatable and does not mutate frozen input', () => {
    const input = Object.freeze({ category: 'Minecraft', context: Object.freeze(['chill']), twitch: Object.freeze({ tags: Object.freeze(['Community']) }), defaultTags: Object.freeze(['Fun']) });
    const first = generateTwitchTags(input);
    expect(generateTwitchTags(input)).toEqual(first);
    first.push('Changed');
    expect(generateTwitchTags(input)).toEqual(['Minecraft', 'Chill', 'Community', 'Fun']);
  });

  it('always returns valid unique bounded tags for varied noisy inputs', () => {
    const values = ['', ' ', '🎮', 'é', 'e\u0301', '#Co-op!', 'COOP', '日本語', 'a'.repeat(25), 'b'.repeat(26), 'Ｆｕｎ', '\n\t', '𐐀'.repeat(25)];
    for (const category of values) {
      const tags = generateTwitchTags({ category, defaultTags: values });
      expect(tags.length).toBeGreaterThan(0);
      expect(tags.length).toBeLessThanOrEqual(10);
      expect(tags.every(isValidTwitchTag)).toBe(true);
      expect(new Set(tags.map(tag => tag.toLowerCase())).size).toBe(tags.length);
    }
  });
});

describe('Twitch tag normalization and validation', () => {
  it.each([
    ['  #Découverte co-op! 🎮', 'Decouvertecoop'], ['e\u0301', 'e'],
    ['Ｆｕｎ１２', 'Fun12'], ['日本語', '日本語'], ['a'.repeat(25), 'a'.repeat(25)],
    ['𐐀'.repeat(25), '𐐀'.repeat(25)], ['', undefined], ['🎮!?', undefined],
    ['a'.repeat(26), undefined], ['𐐀'.repeat(26), undefined],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeTwitchTag(input)).toBe(expected);
  });

  it.each(['', 'two words', '#Tag', 'co-op', '🎮', 'a'.repeat(26), 'e\u0301'])('rejects invalid raw tag %s', tag => {
    expect(isValidTwitchTag(tag)).toBe(false);
  });
});
