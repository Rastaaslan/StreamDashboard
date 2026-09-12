export const COMPANION_SCHEMA_VERSION: number;
export const COMPANION_KEY: string;
export const CompanionMode: Readonly<{ ONLINE_PC: 'ONLINE_PC'; ONLINE_STANDALONE: 'ONLINE_STANDALONE'; OFFLINE: 'OFFLINE' }>;
export function resolveMode(input: { pcAvailable: boolean; internetAvailable: boolean }): typeof CompanionMode[keyof typeof CompanionMode];
export function changedFields(base: Record<string, unknown>, value: Record<string, unknown>): string[];
export function reconcileEvent(base: any, pc: any, android: any): any;
export function createCompanionStore(storage?: Storage, clock?: () => string): {
  snapshot(): any;
  replaceServerSnapshot(snapshot: any): any;
  createEvent(input: any): any;
  updateEvent(id: string, patch: any, baseRevision?: number): any;
  deleteEvent(id: string, baseRevision?: number): any;
  upsertCollection(kind: 'notes' | 'checklist' | 'templates', input: any): any;
  removeCollection(kind: 'notes' | 'checklist' | 'templates', id: string): void;
  acknowledge(ids: string[]): void;
  applySyncResponse(response: { acknowledged: string[]; conflicts?: any[]; snapshot?: any }): any;
  conflicts(): any[];
};
