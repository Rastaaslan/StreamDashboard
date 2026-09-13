import { describe, expect, it } from 'vitest';
import { filterPlanningTemporal, paginatePlanning, TEMPORAL_FILTERS } from '../apps/mobile/planning-model.js';

const now = new Date('2026-09-13T10:00:00.000Z');
const event = (id: string, startAtUtc: string, endAtUtc: string) => ({ id, title: id, startAtUtc, endAtUtc, category: 'live' });
const items = [
  event('old', '2026-09-10T18:00:00.000Z', '2026-09-10T20:00:00.000Z'),
  event('recent', '2026-09-12T18:00:00.000Z', '2026-09-12T20:00:00.000Z'),
  event('ongoing', '2026-09-13T09:00:00.000Z', '2026-09-13T11:00:00.000Z'),
  event('next', '2026-09-14T18:00:00.000Z', '2026-09-14T20:00:00.000Z'),
];

describe('planning temporal filters and pagination', () => {
  it('shows ongoing and future events by default', () => {
    expect(filterPlanningTemporal(items, TEMPORAL_FILTERS.UPCOMING, now).map(item => item.id)).toEqual(['ongoing', 'next']);
  });

  it('shows history from most recent to oldest', () => {
    expect(filterPlanningTemporal(items, TEMPORAL_FILTERS.PAST, now).map(item => item.id)).toEqual(['recent', 'old']);
  });

  it('keeps useful events first when all temporalities are requested', () => {
    expect(filterPlanningTemporal(items, TEMPORAL_FILTERS.ALL, now).map(item => item.id)).toEqual(['ongoing', 'next', 'recent', 'old']);
  });

  it('paginates and clamps an out-of-range page', () => {
    const ten = Array.from({ length: 10 }, (_, index) => ({ id: String(index) }));
    expect(paginatePlanning(ten, 1, 8)).toMatchObject({ page: 1, totalPages: 2, total: 10 });
    expect(paginatePlanning(ten, 1, 8).items).toHaveLength(8);
    expect(paginatePlanning(ten, 99, 8)).toMatchObject({ page: 2, totalPages: 2 });
    expect(paginatePlanning(ten, 99, 8).items.map(item => item.id)).toEqual(['8', '9']);
  });
});
