export const DEFAULT_FILTERS: Record<string, boolean>;
export function periodBounds(period: 'today' | 'next-week', now?: Date): { start: number; end: number };
export function filterPlanning(items: any[], filters?: Record<string, boolean>, period?: 'today' | 'next-week' | null, now?: Date): any[];
export function weekAgenda(items: any[], filters?: Record<string, boolean>, now?: Date): Array<{ date: Date; events: any[] }>;
