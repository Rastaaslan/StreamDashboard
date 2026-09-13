export const DEFAULT_FILTERS: Record<string, boolean>;
export const TEMPORAL_FILTERS: Readonly<{ UPCOMING: 'upcoming'; PAST: 'past'; ALL: 'all' }>;
export type PlanningTemporalFilter = typeof TEMPORAL_FILTERS[keyof typeof TEMPORAL_FILTERS];
export function periodBounds(period: 'today' | 'next-week', now?: Date): { start: number; end: number };
export function filterPlanning(items: any[], filters?: Record<string, boolean>, period?: 'today' | 'next-week' | null, now?: Date): any[];
export function filterPlanningTemporal(items: any[], temporal?: PlanningTemporalFilter, now?: Date): any[];
export function paginatePlanning(items: any[], page?: number, pageSize?: number): { items: any[]; page: number; pageSize: number; total: number; totalPages: number };
export function weekAgenda(items: any[], filters?: Record<string, boolean>, now?: Date): Array<{ date: Date; events: any[] }>;
