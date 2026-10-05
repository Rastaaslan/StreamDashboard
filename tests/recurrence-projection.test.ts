import { describe, expect, it } from 'vitest';
import type { CalendarItem, RecurrenceRule } from '../packages/contracts/src/index.js';
import { projectRecurrence } from '../packages/core/src/recurrence.js';
import { occurrenceIdentity, planRecurrenceReconciliation, type ExpectedMaterialization, type MaterializedOccurrence } from '../packages/core/src/recurrence-reconciliation.js';

function master(start = '2026-03-20T19:00:00.000Z', rule: Partial<RecurrenceRule> = {}): CalendarItem {
  return { id: 'alias', localId: 'series', title: 'Live', startAtUtc: start, endAtUtc: new Date(Date.parse(start) + 3600000).toISOString(), recurrence: { frequency: 'daily', interval: 1, timeZone: 'Europe/Paris', ...rule } };
}
const window = { windowStart: '2026-03-20T00:00:00Z', windowEnd: '2026-04-17T00:00:00Z' };
const project = (item: CalendarItem, start: string, end: string) => projectRecurrence(item, { windowStart: start, windowEnd: end });

describe('window and counted recurrence projection', () => {
  it('preserves explicit calendar windows across DST and overlapping queries', () => {
    const source = master(), before = structuredClone(source);
    const result = projectRecurrence(source, window);
    expect(result).toHaveLength(28);
    expect(new Set(result.map(item => item.occurrenceKey)).size).toBe(28);
    expect(result[8].startAtUtc).toBe('2026-03-28T19:00:00.000Z');
    expect(result[9].startAtUtc).toBe('2026-03-29T18:00:00.000Z');
    expect(projectRecurrence(JSON.parse(JSON.stringify(source)), window)).toEqual(result);
    const rolled = project(source, '2026-03-21', '2026-04-18');
    expect(rolled.slice(0, 27)).toEqual(result.slice(1));
    expect(source).toEqual(before);
    expect(projectRecurrence({ ...source, id: 'changed-alias' }, window).map(v => v.occurrenceKey)).toEqual(result.map(v => v.occurrenceKey));
  });
  it.each([1, 2] as const)('supports weekly interval %s and inclusive until', interval => {
    const source = master('2026-01-06T19:00:00Z', { frequency: 'weekly', interval, until: '2026-02-03T19:00:00Z' });
    const result = project(source, '2026-01-01', '2026-03-01');
    expect(result.map(v => v.startAtUtc.slice(0, 10))).toEqual(interval === 1 ? ['2026-01-06', '2026-01-13', '2026-01-20', '2026-01-27', '2026-02-03'] : ['2026-01-06', '2026-01-20', '2026-02-03']);
  });
  it('clamps monthly dates without drift including leap years', () => {
    expect(project(master('2024-01-31T19:00:00Z', { frequency: 'monthly' }), '2024-01-01', '2024-05-01').map(v => v.startAtUtc.slice(0, 10))).toEqual(['2024-01-31', '2024-02-29', '2024-03-31', '2024-04-30']);
  });
  it.each([
    ['Europe/Paris', '2026-03-28T01:30:00Z', '2026-03-29', '2026-03-30', '2026-03-29T01:30:00.000Z'],
    ['Europe/Paris', '2026-10-24T00:30:00Z', '2026-10-25', '2026-10-26', '2026-10-25T00:30:00.000Z'],
    ['America/New_York', '2026-03-07T07:30:00Z', '2026-03-08', '2026-03-09', '2026-03-08T07:30:00.000Z'],
    ['Australia/Lord_Howe', '2026-10-02T15:45:00Z', '2026-10-03T14:00:00Z', '2026-10-04T14:00:00Z', '2026-10-03T15:45:00.000Z'],
  ])('resolves DST gaps/folds in %s', (timeZone, anchor, start, end, expected) => {
    const result = project(master(anchor, { timeZone }), start, end);
    expect(result).toHaveLength(1);
    expect(result[0].startAtUtc).toBe(expected);
    expect(Date.parse(result[0].endAtUtc) - Date.parse(result[0].startAtUtc)).toBe(3600000);
  });
  it('selects effective patched ranges, including moves from beyond both window edges', () => {
    const source = master('2026-03-01T19:00:00Z');
    const key = (day: string) => `series:2026-03-${day}T20:00:00`;
    source.recurrence!.exceptions = {
      [key('01')]: { patch: { title: 'Moved in', startAtUtc: '2026-03-21T10:00:00Z', endAtUtc: '2026-03-21T11:00:00Z' } },
      [key('30')]: { patch: { startAtUtc: '2026-03-21T11:00:00Z', endAtUtc: '2026-03-21T12:00:00Z' } },
      [key('21')]: { cancelled: true },
      [key('22')]: { patch: { startAtUtc: '2026-05-01T10:00:00Z', endAtUtc: '2026-05-01T11:00:00Z' } },
      'series:2026-03-21T21:00:00': { patch: { title: 'Not a real slot' } },
    };
    const result = project(source, '2026-03-21', '2026-03-23');
    expect(result.map(v => v.occurrenceKey)).toEqual([key('01'), key('30')]);
    expect(result[0].title).toBe('Moved in');
    source.recurrence!.until = '2026-03-25T00:00:00Z';
    expect(project(source, '2026-03-21', '2026-03-23').map(v => v.occurrenceKey)).toEqual([key('01')]);
  });
  it('includes overlapping durations and excludes exact end/start boundaries', () => {
    const source = master();
    expect(project(source, '2026-03-20T19:30:00Z', '2026-03-20T20:00:00Z')).toHaveLength(1);
    expect(project(source, '2026-03-20T20:00:00Z', '2026-03-21T19:00:00Z')).toHaveLength(0);
  });
  it('seeks decades-old series without truncation', () => {
    expect(projectRecurrence(master('1900-01-01T19:00:00Z', { timeZone: 'UTC' }), window)).toHaveLength(28);
  });
  it('preserves nominal gap keys for cancellation and patched content', () => {
    const source = master('2026-03-28T01:30:00Z');
    const occurrenceKey = 'series:2026-03-29T02:30:00';
    source.recurrence!.exceptions = { [occurrenceKey]: { patch: { title: 'Gap slot' } } };
    const result = project(source, '2026-03-29', '2026-03-30');
    expect(result[0].occurrenceKey).toBe(occurrenceKey);
    expect(result[0].title).toBe('Gap slot');
    source.recurrence!.exceptions[occurrenceKey].cancelled = true;
    expect(project(source, '2026-03-29', '2026-03-30')).toEqual([]);
  });
  it('supports version two intervals for daily and monthly rules', () => {
    expect(project(master('2026-01-01T19:00:00Z', { version: 2, interval: 2 }), '2026-01-01', '2026-01-06').map(v => v.startAtUtc.slice(0, 10))).toEqual(['2026-01-01', '2026-01-03', '2026-01-05']);
    expect(project(master('2026-01-31T19:00:00Z', { version: 2, frequency: 'monthly', interval: 2 }), '2026-01-01', '2026-06-01').map(v => v.startAtUtc.slice(0, 10))).toEqual(['2026-01-31', '2026-03-31', '2026-05-31']);
  });
  it('rejects invalid input instead of silently producing an incomplete projection', () => {
    expect(() => projectRecurrence(master(), { ...window, windowEnd: window.windowStart })).toThrow();
    expect(() => projectRecurrence({ ...master(), startAtUtc: 'invalid' }, window)).toThrow();
    expect(() => projectRecurrence(master(undefined, { timeZone: 'invalid' }), window)).toThrow();
    expect(() => projectRecurrence(master(undefined, { interval: 0 as 1 }), window)).toThrow();
    expect(() => projectRecurrence(master(undefined, { until: 'invalid' }), window)).toThrow();
  });
});

const scope = { provider: 'example', seriesIds: ['series'] };
const expected = (key: string, title = 'Live'): ExpectedMaterialization => ({ seriesId: 'series', occurrenceKey: key, provider: 'example', content: { title, start: key } });
const saved = (key: string, remoteId: string, title = 'Live'): MaterializedOccurrence => ({ ...expected(key, title), remoteId });
describe('recurrence reconciliation', () => {
  it('creates, updates, deletes, noops, removes duplicates and converges after persisted results', () => {
    const desired = ['new', 'changed', 'same', 'duplicate'].map(key => expected(key));
    const inventory = [saved('changed', '1', 'Old'), saved('same', '2'), saved('expired', '3'), saved('duplicate', '5'), saved('duplicate', '4', 'Old')];
    const plan = planRecurrenceReconciliation(desired, inventory, scope);
    expect(plan.map(v => v.type).sort()).toEqual(['create', 'delete', 'delete', 'noop', 'noop', 'update']);
    expect(plan).toEqual(planRecurrenceReconciliation([...desired].reverse(), [...inventory].reverse(), scope));
    const next = structuredClone(inventory);
    for (const action of plan) {
      if (action.type === 'delete') next.splice(next.findIndex(v => v.remoteId === action.materialized.remoteId), 1);
      if (action.type === 'update') next[next.findIndex(v => v.remoteId === action.materialized.remoteId)] = { ...action.expected, remoteId: action.materialized.remoteId };
      if (action.type === 'create') next.push({ ...action.expected, remoteId: 'new-id' });
    }
    expect(planRecurrenceReconciliation(desired, JSON.parse(JSON.stringify(next)), scope).map(v => v.type)).toEqual(['noop', 'noop', 'noop', 'noop']);
  });
  it('keeps identities collision-free and provider-specific', () => {
    expect(occurrenceIdentity({ seriesId: 'a:b', occurrenceKey: 'c', provider: 'p' })).not.toBe(occurrenceIdentity({ seriesId: 'a', occurrenceKey: 'b:c', provider: 'p' }));
    expect(occurrenceIdentity(expected('key'))).not.toBe(occurrenceIdentity({ ...expected('key'), provider: 'other' }));
  });
  it('limits deletions to explicit scope and ignores JSON property order', () => {
    const current = saved('same', '1');
    current.content = { start: 'same', title: 'Live' };
    expect(planRecurrenceReconciliation([expected('same')], [current], scope)[0].type).toBe('noop');
    expect(planRecurrenceReconciliation([], [current, { ...saved('x', '2'), provider: 'other' }, { ...saved('y', '3'), seriesId: 'other' }], scope).map(v => v.type)).toEqual(['delete']);
    expect(() => planRecurrenceReconciliation([expected('x'), expected('x')], [], scope)).toThrow('Duplicate');
    expect(() => planRecurrenceReconciliation([], [current, current], scope)).toThrow('Ambiguous');
  });
  it('rolls seven materialized occurrences with only one create and one delete', () => {
    const target = (start: string) => projectRecurrence(master(), { windowStart: start, nextCount: 7 }).map(v => ({ seriesId: master().localId!, occurrenceKey: v.occurrenceKey, provider: 'example', content: { title: v.title, startAtUtc: v.startAtUtc, endAtUtc: v.endAtUtc } }));
    const prior = target('2026-03-20').map((v, index) => ({ ...v, remoteId: `${index}` }));
    const plan = planRecurrenceReconciliation(target('2026-03-21'), prior, scope);
    expect(plan.filter(v => v.type === 'noop')).toHaveLength(6);
    expect(plan.filter(v => v.type === 'create')).toHaveLength(1);
    expect(plan.filter(v => v.type === 'delete')).toHaveLength(1);
  });
});
