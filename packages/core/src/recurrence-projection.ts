import type { CalendarItem, RecurrenceProjectionIdentity } from '../../contracts/src/index.js';

export interface RecurrenceWindow { from: string | number | Date; to?: string | number | Date; nextCount?: number; accept?: (item: CalendarItem) => boolean }
/** Engines return canonical occurrences (stable keys, until and exceptions applied).
 * Window overlap uses the final patched dates, including exceptions whose anchors
 * lie outside the window. Until is inclusive and constrains the original anchor.
 * nextCount selects at most N effective future occurrences per series, including
 * ongoing occurrences, after exceptions and the optional provider eligibility filter.
 * Supply either to (window overlap) or nextCount (counted selection).
 * Custom engines must honor this contract and fail explicitly if their scan cannot
 * finish. A rolling core owns persisted links, deletion policy and checkpoints.
 */
export interface OccurrenceSource {
  expand(items: CalendarItem[], window: RecurrenceWindow): CalendarItem[];
}
export interface RecurrenceProjection<T> {
  mode: 'master' | 'materialized';
  window?: RecurrenceWindow;
  entries: Array<{ identity: RecurrenceProjectionIdentity; input: T }>;
}

/** Persist independently after each successful provider operation. A master etag
 * must never be shared with a materialized occurrence or another calendar. */
export interface RecurrenceProjectionLink {
  identity: RecurrenceProjectionIdentity;
  calendarId: string;
  remoteId: string;
  etag: string;
}

import { expandRecurringItems } from './recurrence.js';
export interface ProjectionWindow { windowStart: string | number | Date; windowEnd?: string | number | Date; nextCount?: number; accept?: (item: CalendarItem) => boolean }
export type ProjectedOccurrence = CalendarItem & { seriesId: string; occurrenceKey: string };
/** Compatibility facade over the single shared occurrence engine. */
export function projectRecurrence(item: CalendarItem, window: ProjectionWindow): ProjectedOccurrence[] {
 if (!item.recurrence || item.occurrenceKey) throw new Error('Expected a canonical recurring master');
 return expandRecurringItems([item], { from: window.windowStart, to: window.windowEnd, nextCount: window.nextCount, accept: window.accept }) as ProjectedOccurrence[];
}
