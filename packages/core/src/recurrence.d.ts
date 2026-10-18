import type { CalendarItem } from '../../contracts/src/index.js';
export function migrateRecurrence(rule: NonNullable<CalendarItem['recurrence']>): NonNullable<CalendarItem['recurrence']> & { version: 2 };
export function expandRecurringItems(items: CalendarItem[], bounds: import('./recurrence-projection.js').RecurrenceWindow): CalendarItem[];
export function recurrenceSummary(item: CalendarItem, locale?: string): string;

export { projectRecurrence } from './recurrence-projection.js';

export function mergeOccurrencePatch(previous: {patch?: Partial<CalendarItem>} | undefined, changes: unknown): {patch: Partial<CalendarItem>};
export function recurrenceForNewSeries(rule: CalendarItem['recurrence'], id: string): CalendarItem['recurrence'];
export function expandEditableRecurringItems(items: CalendarItem[], bounds: import('./recurrence-projection.js').RecurrenceWindow): CalendarItem[];
