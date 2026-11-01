import { describe, expect, it, vi } from 'vitest';
import type { CalendarItem } from '../packages/contracts/src/index.js';
import { expandRecurringItems } from '../packages/core/src/recurrence.js';
import { inspectPlanningSlot, parisInstant, proposeSessionDuplicate, suggestPlanningSlots, type PlanningObservation } from '../packages/core/src/streamcockpit-planning.js';

const now = Date.parse('2026-03-28T08:00:00Z');
const from = '2026-03-28T08:00:00Z', to = '2026-04-02T22:00:00Z';
const item = (patch: Partial<CalendarItem> = {}): CalendarItem => ({ id: 'live', title: 'Session', category: 'live', startAtUtc: '2026-03-28T19:00:00Z', endAtUtc: '2026-03-28T21:00:00Z', ...patch });
const snapshot = (items = [item()], google: CalendarItem[] = []): PlanningObservation[] => [
  { source: 'local', status: 'observed', observedAt: from, from, to, items },
  { source: 'google', status: 'observed', observedAt: from, from, to, items: google },
];
const slot = { from: '2026-03-29T18:00:00Z', to: '2026-03-29T20:00:00Z' };
const propose = (s = snapshot()) => proposeSessionDuplicate(s, { source: 'local', id: 'live' }, slot, now);

describe('suggestions observées et Paris', () => {
  it('résout les deux changements DST et refuse dates invalides ou sans fuseau', () => {
    expect(parisInstant('2026-03-28T20:00')).toBe('2026-03-28T19:00:00.000Z');
    expect(parisInstant('2026-03-29T20:00')).toBe('2026-03-29T18:00:00.000Z');
    expect(() => parisInstant('2026-03-29T02:30')).toThrow('inexistante');
    expect(() => parisInstant('2026-10-25T02:30')).toThrow('ambiguë');
    expect(parisInstant('2026-10-25T02:30', 'earlier')).toBe('2026-10-25T00:30:00.000Z');
    expect(parisInstant('2026-10-25T02:30', 'later')).toBe('2026-10-25T01:30:00.000Z');
    expect(() => parisInstant('2026-02-30T12:00')).toThrow();
    expect(() => inspectPlanningSlot(snapshot(), { ...slot, from: '2026-03-29T18:00:00' }, now)).toThrow('fuseau');
  });
  it('détecte local/Google et permet des intervalles adjacents, sans mutation', () => {
    const s = snapshot([item()], [item({ id: 'g', startAtUtc: '2026-03-28T21:00:00Z', endAtUtc: '2026-03-28T22:00:00Z' })]);
    const before = structuredClone(s);
    expect(inspectPlanningSlot(s, { from: '2026-03-28T20:00:00Z', to: '2026-03-28T21:30:00Z' }, now).conflicts.map(c => c.source)).toEqual(['local', 'google']);
    const suggestions = suggestPlanningSlots(s, { from: '2026-03-28T19:00:00Z', to: '2026-03-29T01:00:00Z', durationMinutes: 120 }, now);
    expect(suggestions[0].from).toBe('2026-03-28T22:00:00.000Z');
    expect(s).toEqual(before);
  });
  it('bloque une journée entière Google selon la date civile Paris (23h DST)', () => {
    const s = snapshot([], [item({ id: 'g', allDay: true, startAtUtc: '2026-03-29', endAtUtc: '2026-03-30' })]);
    expect(inspectPlanningSlot(s, { from: '2026-03-28T23:00:00Z', to: '2026-03-29T22:00:00Z' }, now).conflicts).toHaveLength(1);
    expect(inspectPlanningSlot(s, { from: '2026-03-29T22:00:00Z', to: '2026-03-29T23:00:00Z' }, now).conflicts).toHaveLength(0);
  });
  it.each(['unavailable', 'stale', 'coverage', 'missing', 'invalid', 'conflict', 'custom', 'allDaySeries'])('échoue explicitement : %s', mode => {
    const s = snapshot();
    if (mode === 'unavailable') s[1].status = 'unavailable';
    if (mode === 'stale') s[1].observedAt = '2026-03-28T07:00:00Z';
    if (mode === 'coverage') s[1].to = '2026-03-29T18:30:00Z';
    if (mode === 'missing') s.pop();
    if (mode === 'invalid') s[0].items[0].endAtUtc = 'invalid';
    if (mode === 'conflict') s[0].items[0].conflict = { provider: 'google', detectedAt: from };
    if (mode === 'custom' || mode === 'allDaySeries') s[0].items[0].recurrence = { version: 2, frequency: 'daily', interval: 1, timeZone: 'Europe/Paris', ...(mode === 'custom' ? { custom: { engine: 'unknown', version: 1, parameters: {} } } : {}) };
    if (mode === 'allDaySeries') s[0].items[0].allDay = true;
    expect(() => inspectPlanningSlot(s, slot, now)).toThrow();
  });
  it('accepte Google explicitement désactivé, mais pas un échec silencieux', () => {
    const s = snapshot(); s[1].status = 'disabled';
    expect(inspectPlanningSlot(s, slot, now).conflicts).toEqual([]);
    s[1].items.push(item()); expect(() => inspectPlanningSlot(s, slot, now)).toThrow();
  });
  it('respecte cadence, until, exceptions annulées et déplacées via le moteur canonique', () => {
    const master = item({ recurrence: { frequency: 'daily', interval: 2, timeZone: 'Europe/Paris', until: '2026-04-01T18:00:00Z', exceptions: {} } });
    const occurrences = expandRecurringItems([master], { from, to });
    expect(occurrences.map(i => i.startAtUtc)).toEqual(['2026-03-28T19:00:00.000Z', '2026-03-30T18:00:00.000Z', '2026-04-01T18:00:00.000Z']);
    master.recurrence!.exceptions![occurrences[1].occurrenceKey!] = { cancelled: true };
    master.recurrence!.exceptions![occurrences[2].occurrenceKey!] = { patch: { startAtUtc: slot.from, endAtUtc: slot.to, title: 'Déplacée' } };
    const s = snapshot([master]);
    expect(inspectPlanningSlot(s, slot, now).conflicts[0].title).toBe('Déplacée');
    expect(inspectPlanningSlot(s, { from: '2026-03-30T18:00:00Z', to: '2026-03-30T20:00:00Z' }, now).conflicts).toEqual([]);
    expect(() => proposeSessionDuplicate(s, { source: 'local', id: 'live', occurrenceKey: occurrences[1].occurrenceKey }, slot, now)).toThrow('annulée');
    const proposal = proposeSessionDuplicate(s, { source: 'local', id: 'live', occurrenceKey: occurrences[2].occurrenceKey }, { from: '2026-03-31T18:00:00Z', to: '2026-03-31T20:00:00Z' }, now);
    expect(proposal.preview.title).toBe('Déplacée');
    expect(proposal.confirm(s, now).recurrence).toBeUndefined();
  });
});

describe('confirmation de duplication sans écriture', () => {
  it('attribue une nouvelle identité uniquement à confirmation, sans liens ni récurrence', () => {
    const s = snapshot([item({ twitchSegmentId: 'remote', desiredPublication: { local: true, twitch: true, google: true }, providers: { google: { status: 'synced', remoteId: 'g' } } })]);
    const before = structuredClone(s), proposal = propose(s);
    expect(proposal.preview).not.toHaveProperty('id');
    const draft = proposal.confirm(s, now), second = propose(s).confirm(s, now);
    expect(draft.id).not.toBe(second.id); expect(draft.localId).toBe(draft.id);
    expect(draft.desiredPublication).toEqual({ local: true, twitch: false, google: false });
    expect(draft.providers).toEqual({}); expect(draft.twitchSegmentId).toBeUndefined();
    expect(s).toEqual(before); expect(() => proposal.confirm(s, now)).toThrow('déjà');
  });
  it('annulation terminale et aperçu non modifiable', () => {
    const p = propose(); p.preview.from = from; p.preview.title = 'tampered';
    expect(p.confirm(snapshot(), now).startAtUtc).toBe(slot.from);
    const cancelled = propose(); cancelled.cancel(); expect(() => cancelled.confirm(snapshot(), now)).toThrow('annulée');
  });
  it('revérifie conflit, modifications, fraîcheur et passé', () => {
    const p = propose(), changed = snapshot(); changed[1].items.push(item({ id: 'new', startAtUtc: slot.from, endAtUtc: slot.to }));
    expect(() => p.confirm(changed, now)).toThrow('Chevauchement');
    changed[1].items = []; changed[0].items[0].title = 'changed';
    expect(() => p.confirm(changed, now)).toThrow('modifiées');
    expect(() => p.confirm(snapshot(), now + 6 * 60_000)).toThrow('périmée');
    const refreshed = snapshot(); refreshed.forEach(s => s.observedAt = '2026-03-29T19:00:00Z');
    expect(() => p.confirm(refreshed, Date.parse('2026-03-29T19:00:00Z'))).toThrow('passé');
    expect(p.state).toBe('proposed');
  });
  it('accepte une relecture identique avec nouvel horodatage', () => {
    const p = propose(), latest = snapshot(); latest.forEach(s => s.observedAt = '2026-03-28T08:01:00Z');
    expect(p.confirm(latest, now + 60_000).draft).toBe(true);
  });
  it('refuse une collision UUID sans faux succès', () => {
    const spy = vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('live' as `${string}-${string}-${string}-${string}-${string}`);
    try { const p = propose(); expect(() => p.confirm(snapshot(), now)).toThrow('Collision'); expect(p.state).toBe('proposed'); }
    finally { spy.mockRestore(); }
  });
});

it('préserve la cadence hebdomadaire en automne et borne les suggestions', () => {
  const autumnNow = Date.parse('2026-10-20T08:00:00Z');
  const start = '2026-10-20T08:00:00Z', end = '2026-10-31T23:00:00Z';
  const master = item({ startAtUtc: '2026-10-20T18:00:00Z', endAtUtc: '2026-10-20T20:00:00Z', recurrence: { frequency: 'weekly', interval: 1, timeZone: 'Europe/Paris' } });
  const s = snapshot([master]); s.forEach(v => { v.from = start; v.to = end; v.observedAt = start; });
  expect(inspectPlanningSlot(s, { from: '2026-10-27T19:00:00Z', to: '2026-10-27T21:00:00Z' }, autumnNow).conflicts).toHaveLength(1);
  expect(suggestPlanningSlots(s, { from: start, to: end, durationMinutes: 60, limit: 2 }, autumnNow)).toHaveLength(2);
  expect(() => suggestPlanningSlots(s, { from: start, to: end, durationMinutes: 60, stepMinutes: 0 }, autumnNow)).toThrow();
  expect(() => suggestPlanningSlots(s, { from: start, to: '2026-12-01T00:00:00Z', durationMinutes: 60 }, autumnNow)).toThrow('31 jours');
});
it('duplique Google observé sans adopter sa propriété externe et bloque suppression en attente', () => {
  const s = snapshot([], [item({ ownership: 'EXTERNAL', source: 'GOOGLE', external: true, editable: false })]);
  const draft = proposeSessionDuplicate(s, { source: 'google', id: 'live' }, slot, now).confirm(s, now);
  expect(draft.ownership).toBe('LOCAL'); expect(draft.external).toBeUndefined();
  s[1].items[0].deletionPending = true;
  expect(() => inspectPlanningSlot(s, slot, now)).toThrow('Suppression');
});
