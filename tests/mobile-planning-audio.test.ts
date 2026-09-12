import { describe, expect, it } from 'vitest';
import { collectActiveSceneSources } from '../integrations/obs/src/client.js';
import { DEFAULT_FILTERS, filterPlanning, periodBounds } from '../apps/mobile/planning-model.js';

describe('audio OBS actif', () => {
  it('suit scènes et groupes imbriqués sans éléments désactivés ni Special Inputs fantômes', async () => {
    const scenes: Record<string, any[]> = { Program: [{ sourceName: 'Direct', sceneItemEnabled: true }, { sourceName: 'Off', sceneItemEnabled: false }, { sourceName: 'Nested', sceneItemEnabled: true, sourceType: 'OBS_SOURCE_TYPE_SCENE' }], Nested: [{ sourceName: 'Group', sceneItemEnabled: true, isGroup: true }] };
    const groups = { Group: [{ sourceName: 'Discord', sceneItemEnabled: true }, { sourceName: 'Muted item', sceneItemEnabled: false }] } as Record<string, any[]>;
    expect([...await collectActiveSceneSources('Program', async name => scenes[name] || [], async name => groups[name] || [])]).toEqual(['Direct', 'Nested', 'Group', 'Discord']);
    expect([...await collectActiveSceneSources('Other', async () => [{ sourceName: 'Other audio', sceneItemEnabled: true }], async () => [])]).toEqual(['Other audio']);
  });
});

describe('planning mobile', () => {
  it('calcule aujourd’hui et la prochaine semaine civile locale', () => {
    const now = new Date(2026, 8, 12, 14);
    const today = periodBounds('today', now); const week = periodBounds('next-week', now);
    expect(new Date(today.start).getHours()).toBe(0); expect(today.end - today.start).toBe(86_400_000);
    expect(new Date(week.start).getDay()).toBe(1); expect(new Date(week.end).getDay()).toBe(1); expect(week.end - week.start).toBe(7 * 86_400_000);
  });
  it('applique les filtres sans modifier les événements', () => {
    const items = [{ title: 'Live', startAtUtc: '2026-09-14T18:00:00Z', category: 'live', source: 'TWITCH' }, { title: 'Perso', startAtUtc: '2026-09-14T19:00:00Z', category: 'personal', source: 'GOOGLE' }];
    expect(filterPlanning(items, { ...DEFAULT_FILTERS, twitch: false }, null)).toEqual([items[1]]); expect(items).toHaveLength(2);
  });
});
