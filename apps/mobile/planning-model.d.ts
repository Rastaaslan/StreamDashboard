export const DEFAULT_FILTERS: Record<string, boolean>;
export function periodBounds(period: 'today' | 'next-week', now?: Date): { start: number; end: number };
export function filterPlanning(items: unknown[], filters?: Record<string, boolean>, period?: 'today' | 'next-week' | null, now?: Date): unknown[];
