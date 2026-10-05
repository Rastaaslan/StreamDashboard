import type { CalendarItem } from '../../contracts/src/index.js';
export function migrateRecurrence(rule: NonNullable<CalendarItem['recurrence']>): NonNullable<CalendarItem['recurrence']> & { version: 2 };
export function expandRecurringItems(items: CalendarItem[], bounds: { from: string | number | Date; to: string | number | Date }): CalendarItem[];
export function recurrenceSummary(item: CalendarItem, locale?: string): string;

export { projectRecurrence } from './recurrence-projection.js';
