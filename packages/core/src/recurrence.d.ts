import type { CalendarItem } from '../../contracts/src/index.js';
export function expandRecurringItems(items: CalendarItem[], bounds: { from: string | number | Date; to: string | number | Date }): CalendarItem[];
export function recurrenceSummary(item: CalendarItem, locale?: string): string;
