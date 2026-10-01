import { describe, expect, it, vi } from 'vitest';
import { expandRecurringItems } from '../packages/core/src/recurrence.js';
import type { CalendarItem } from '../packages/contracts/src/index.js';
import { findScheduledLiveForStart } from '../packages/core/src/live-planning.js';
import { PlanningOrchestrator } from '../packages/core/src/planning.js';

const series = (start: string, recurrence: any): CalendarItem => ({ id: 'minecraft', localId: 'minecraft', title: 'Minecraft', startAtUtc: start, endAtUtc: new Date(Date.parse(start) + 3 * 3600000).toISOString(), category: 'live', recurrence });

describe('moteur canonique de récurrence', () => {
  it('préserve mardi 20h Europe/Paris des deux côtés du DST', () => {
    const item = series('2026-03-17T19:00:00.000Z', { frequency: 'weekly', interval: 1, timeZone: 'Europe/Paris', until: null, exceptions: {} });
    const values = expandRecurringItems([item], { from: '2026-03-15', to: '2026-04-15' });
    expect(values.map(value => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(value.startAtUtc)))).toEqual(['mardi 20:00', 'mardi 20:00', 'mardi 20:00', 'mardi 20:00', 'mardi 20:00']);
  });

  it('respecte une cadence bihebdomadaire et une fin inclusive', () => {
    const item = series('2026-01-06T19:00:00.000Z', { frequency: 'weekly', interval: 2, timeZone: 'Europe/Paris', until: '2026-02-04T00:00:00.000Z', exceptions: {} });
    expect(expandRecurringItems([item], { from: '2026-01-01', to: '2026-03-01' }).map(value => value.startAtUtc.slice(0, 10))).toEqual(['2026-01-06', '2026-01-20', '2026-02-03']);
  });

  it('ramène une ancre mensuelle du 31 au dernier jour valide sans dériver', () => {
    const item = series('2025-01-31T19:00:00.000Z', { frequency: 'monthly', interval: 1, timeZone: 'Europe/Paris', until: null, exceptions: {} });
    expect(expandRecurringItems([item], { from: '2025-01-01', to: '2025-05-01' }).map(value => value.startAtUtc.slice(0, 10))).toEqual(['2025-01-31', '2025-02-28', '2025-03-31', '2025-04-30']);
  });

  it('applique annulation et patch sans muter la série', () => {
    const item = series('2026-01-06T19:00:00.000Z', { frequency: 'weekly', interval: 1, timeZone: 'Europe/Paris', until: null, exceptions: {} });
    const initial = expandRecurringItems([item], { from: '2026-01-01', to: '2026-02-01' });
    item.recurrence!.exceptions![initial[1].occurrenceKey!] = { cancelled: true };
    item.recurrence!.exceptions![initial[2].occurrenceKey!] = { patch: { title: 'Minecraft spécial', startAtUtc: '2026-01-20T20:00:00.000Z', endAtUtc: '2026-01-20T23:00:00.000Z' } };
    const values = expandRecurringItems([item], { from: '2026-01-01', to: '2026-02-01' });
    expect(values.map(value => value.title)).toEqual(['Minecraft', 'Minecraft spécial', 'Minecraft']);
    expect(values[1].startAtUtc).toBe('2026-01-20T20:00:00.000Z');
    expect(item.title).toBe('Minecraft'); expect(item.id).toBe('minecraft');
  });

  it('rend une occurrence virtuelle visible à nextLive', () => {
    const item = series('2026-01-06T19:00:00.000Z', { frequency: 'weekly', interval: 1, timeZone: 'Europe/Paris', until: null, exceptions: {} });
    const now = Date.parse('2026-01-13T18:50:00.000Z'); const expanded = expandRecurringItems([item], { from: now - 3600000, to: now + 3600000 });
    expect(findScheduledLiveForStart(expanded, now)?.seriesId).toBe('minecraft');
  });

  it('refuse une représentation provider inexacte sans perdre la série ni créer de doublon', async () => {
    const item = series('2026-01-06T19:00:00.000Z', { frequency: 'weekly', interval: 1, timeZone: 'Europe/Paris', until: null, exceptions: {} });
    item.desiredPublication = { local: true, twitch: true, google: true };
    const create = vi.fn(); const values: CalendarItem[] = []; const orchestrator = new PlanningOrchestrator(values, { twitch: { create, update: vi.fn(), delete: vi.fn() }, google: { create, update: vi.fn(), delete: vi.fn() } }, async () => undefined);
    const created = await orchestrator.create(item);
    expect(create).not.toHaveBeenCalled(); expect(orchestrator.all()).toHaveLength(1); expect(created.providers?.twitch?.status).toBe('error');
    await orchestrator.retry(created.id, 'twitch').catch(() => undefined); expect(create).not.toHaveBeenCalled(); expect(orchestrator.all()).toHaveLength(1);
  });
});
