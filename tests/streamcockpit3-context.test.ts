import { describe, expect, it } from 'vitest';
import { parseContextConfig, parseContextSnapshot, selectContextPresentation,
  type ContextConfig, type ContextSnapshot } from '../packages/core/src/streamcockpit-context.js';
import { mountContextPresentation, renderContextPresentation } from '../apps/mobile/control/streamcockpit-context-renderer.js';

const config: ContextConfig = {
  schemaVersion: 1, platform: 'twitch', fallbackBankId: 'default',
  actions: [
    { id: 'marker', label: 'Marqueur Twitch', roles: ['stream-pc', 'android'], capabilities: ['twitch:marker'] },
    { id: 'preview', label: 'Aperçu', roles: ['stream-pc', 'gaming-pc', 'android'], capabilities: [] },
    { id: 'private', label: 'Régie fixe', roles: ['stream-pc'], capabilities: ['obs:scene'] },
  ],
  banks: [
    { id: 'default', label: 'Accueil', actionIds: ['preview', 'private'] },
    { id: 'game', label: 'Jeu', actionIds: ['marker', 'preview', 'private'] },
    { id: 'pause', label: 'Pause', actionIds: ['preview'] },
  ],
  rules: [
    { id: 'game-live', priority: 10, bankId: 'game', when: { scene: 'Gameplay', game: 'Chess', streamState: 'live' } },
    { id: 'pause', priority: 20, bankId: 'pause', when: { scene: 'BRB' } },
  ],
};
const snapshot: ContextSnapshot = {
  scene: 'Gameplay', game: 'Chess', streamState: 'live', role: 'android',
  capabilities: ['twitch:marker'], network: 'online',
};
const select = (patch: Partial<ContextSnapshot> = {}, c = config) => selectContextPresentation(c, { ...snapshot, ...patch });

describe('context presentation engine', () => {
  it('recomputes scene transitions and returns to live without retained state', () => {
    expect(select().bank.id).toBe('game');
    expect(select({ scene: 'BRB' }).bank.id).toBe('pause');
    expect(select().bank.id).toBe('game');
  });
  it('falls back for absent game or unknown stream state without guessing', () => {
    for (const patch of [{ game: null }, { streamState: null }, { streamState: 'offline' as const }]) {
      expect(select(patch).selection).toBe('fallback');
    }
    expect(select({ game: null }).unknownFields).toContain('game');
  });
  it.each(['offline', 'unknown'] as const)('invalidates stale context when network is %s and recovers explicitly', network => {
    const result = select({ network });
    expect(result.bank.id).toBe('default');
    expect(result.unknownFields).toEqual(['scene', 'game', 'streamState', 'capabilities']);
    expect(result.actions).toEqual([{ id: 'preview', label: 'Aperçu', available: false, reason: 'network-unavailable' }]);
    expect(select().actions[0].available).toBe(true);
  });
  it('matches explicit unknown values, whereas omitted predicates are wildcards', () => {
    const c = structuredClone(config);
    c.rules.push({ id: 'no-game', priority: 100, bankId: 'pause', when: { game: null } });
    expect(select({ game: null }, c).ruleId).toBe('no-game');
    expect(select({}, c).ruleId).toBe('game-live');
  });
  it('resolves conflicts by priority then case-sensitive ID independent of array order', () => {
    const c = structuredClone(config);
    c.rules.push({ id: 'a-winner', priority: 10, bankId: 'pause', when: {} });
    expect(select({}, c).matchedRuleIds).toEqual(['a-winner', 'game-live']);
    c.rules.reverse();
    expect(select({}, c).ruleId).toBe('a-winner');
    c.rules.push({ id: 'higher', priority: 11, bankId: 'default', when: {} });
    expect(select({}, c).ruleId).toBe('higher');
  });
  it('filters actions by device role including unknown role', () => {
    expect(select().actions.map(a => a.id)).toEqual(['marker', 'preview']);
    expect(select({ role: 'gaming-pc' }).actions.map(a => a.id)).toEqual(['preview']);
    expect(select({ role: 'stream-pc' }).actions.map(a => a.id)).toEqual(['marker', 'preview', 'private']);
    expect(select({ role: null }).actions).toEqual([]);
  });
  it('matches role and all required capabilities in rules', () => {
    const c = structuredClone(config);
    c.rules.push({ id: 'role', priority: 99, bankId: 'pause', when: { role: 'android', capabilities: ['twitch:marker'] } });
    expect(select({}, c).ruleId).toBe('role');
    expect(select({ role: 'gaming-pc' }, c).ruleId).toBe('game-live');
    expect(select({ capabilities: [] }, c).ruleId).toBe('game-live');
    expect(select({ capabilities: null }, c).ruleId).toBe('game-live');
  });
  it('disables missing/unknown capabilities and never treats UI availability as execution', () => {
    expect(select({ capabilities: [] }).actions[0]).toMatchObject({ available: false, reason: 'missing-capability' });
    expect(select({ capabilities: null }).actions.every(a => !a.available)).toBe(true);
    expect(select({ capabilities: [] }).actions[1].available).toBe(true);
  });
  it('does not mutate inputs or share output references with inputs', () => {
    const before = JSON.stringify([config, snapshot]);
    const a = select();
    a.actions[0].label = 'changed';
    a.bank.label = 'changed';
    expect(JSON.stringify([config, snapshot])).toBe(before);
    expect(select()).toEqual(select());
    expect(select().bank.label).toBe('Jeu');
  });
});

describe('strict input contracts', () => {
  it.each([
    (c: any) => { c.script = 'alert(1)'; },
    (c: any) => { c.platform = 'youtube'; },
    (c: any) => { c.schemaVersion = 2; },
    (c: any) => { c.actions[0].command = { type: 'obs.start' }; },
    (c: any) => { c.actions[0].roles = ['admin']; },
    (c: any) => { c.actions[0].capabilities = ['x', 'x']; },
    (c: any) => { c.actions.push(c.actions[0]); },
    (c: any) => { c.banks.push(c.banks[0]); },
    (c: any) => { c.rules.push(c.rules[0]); },
    (c: any) => { c.banks[0].actionIds = ['missing']; },
    (c: any) => { c.rules[0].bankId = 'missing'; },
    (c: any) => { c.fallbackBankId = 'missing'; },
    (c: any) => { c.rules[0].priority = Infinity; },
    (c: any) => { c.rules[0].priority = 1.5; },
    (c: any) => { c.rules[0].when.expression = 'true'; },
    (c: any) => { c.rules[0].when.game = undefined; },
    (c: any) => { c.rules[0].when.streamState = 'unknown'; },
    (c: any) => { delete c.actions[0].roles; },
  ])('rejects invalid configuration %#', mutate => {
    const c = structuredClone(config); mutate(c);
    expect(() => parseContextConfig(c)).toThrow(TypeError);
  });
  it('rejects accessor fields without calling them', () => {
    let called = false;
    const c = { ...config };
    Object.defineProperty(c, 'actions', { get() { called = true; return []; } });
    expect(() => parseContextConfig(c)).toThrow(TypeError);
    expect(called).toBe(false);
  });
  it.each([{ network: 'connected' }, { role: 'admin' }, { scene: '' }, { game: undefined }, { capabilities: 'all' }, { command: 'start' }])('rejects invalid snapshot %j', patch => {
    expect(() => parseContextSnapshot({ ...snapshot, ...patch })).toThrow(TypeError);
  });
});

describe('mobile render-only adapter', () => {
  it('replaces cards on scene change, network loss and role change', () => {
    const container = { innerHTML: '' };
    mountContextPresentation(container, select());
    expect(container.innerHTML).toContain('Marqueur Twitch');
    mountContextPresentation(container, select({ scene: 'BRB' }));
    expect(container.innerHTML).not.toContain('Marqueur Twitch');
    mountContextPresentation(container, select({ network: 'offline' }));
    expect(container.innerHTML).toContain('aria-disabled="true"');
    expect(container.innerHTML).toContain('Agent indisponible');
    mountContextPresentation(container, select({ role: null }));
    expect(container.innerHTML).toContain('Aucune action visible');
  });
  it('escapes labels and exposes no executable controls or routing attributes', () => {
    const c = structuredClone(config);
    c.banks[1].label = '<script>alert("x")</script>';
    c.actions[0].label = '<img src=x onerror=alert(1)>';
    const html = renderContextPresentation(select({}, c));
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img');
    expect(html).not.toMatch(/<script|<img|<button|data-action|onclick=/);
  });
});
