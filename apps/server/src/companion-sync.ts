import type { CalendarItem, ChecklistItem } from '../../../packages/contracts/src/index.js';

export const COMPANION_SYNC_SCHEMA_VERSION = 2;
const MAX_JOURNAL = 5_000;
const EVENT_FIELDS = new Set(['id', 'localId', 'title', 'description', 'startAtUtc', 'endAtUtc', 'allDay', 'category', 'kind', 'draft', 'twitchCategoryId', 'twitchCategoryName', 'desiredPublication', 'providerLinks', 'providers']);

export interface CompanionEntity { id: string; revision: number; updatedAt: string; [key: string]: unknown }
export interface CompanionConflict { operationId: string; entityType: string; entityId: string; fields: string[]; pc: unknown; android: unknown; baseRevision: number }
export interface CompanionState {
  serverRevision: number;
  eventRevisions: Record<string, number>;
  eventHistory: Record<string, Record<string, unknown>>;
  tombstones: Record<string, CompanionEntity>;
  notes: CompanionEntity[];
  templates: CompanionEntity[];
  checklist: CompanionEntity[];
  journal: Record<string, { at: string; revision: number }>;
  journalOrder: string[];
  conflicts: Record<string, CompanionConflict>;
}

export interface SyncOperation {
  operationId?: string; id?: string; type?: string; eventId?: string; entityId?: string;
  baseRevision?: number; timestamp?: string; patch?: Record<string, unknown>; base?: Record<string, unknown>;
  desiredPublication?: Record<string, unknown>;
}

export function emptyCompanionState(): CompanionState {
  return { serverRevision: 0, eventRevisions: {}, eventHistory: {}, tombstones: {}, notes: [], templates: [], checklist: [], journal: {}, journalOrder: [], conflicts: {} };
}

const clone = <T>(value: T): T => structuredClone(value);
const plain = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const validId = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);

function validatePatch(patch: unknown, allowed: Set<string>) {
  if (!plain(patch)) throw Object.assign(new Error('Patch compagnon invalide.'), { code: 'COMPANION_PAYLOAD_INVALID' });
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!allowed.has(key) || ['__proto__', 'prototype', 'constructor'].includes(key)) throw Object.assign(new Error(`Champ compagnon interdit: ${key}`), { code: 'COMPANION_PAYLOAD_INVALID' });
    if (typeof value === 'string' && value.length > (key === 'description' ? 4_000 : 500)) throw Object.assign(new Error('Champ compagnon trop long.'), { code: 'COMPANION_PAYLOAD_INVALID' });
    output[key] = clone(value);
  }
  return output;
}

function validateEvent(value: Record<string, unknown>) {
  if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 140) throw Object.assign(new Error('Titre compagnon invalide.'), { code: 'COMPANION_PAYLOAD_INVALID' });
  const start = Date.parse(String(value.startAtUtc ?? '')); const end = Date.parse(String(value.endAtUtc ?? ''));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw Object.assign(new Error('Période compagnon invalide.'), { code: 'COMPANION_PAYLOAD_INVALID' });
  if (value.category !== undefined && !['live', 'production', 'personal'].includes(String(value.category))) throw Object.assign(new Error('Type compagnon invalide.'), { code: 'COMPANION_PAYLOAD_INVALID' });
}

function acknowledge(state: CompanionState, id: string) {
  state.journal[id] = { at: new Date().toISOString(), revision: state.serverRevision };
  state.journalOrder.push(id);
  while (state.journalOrder.length > MAX_JOURNAL) delete state.journal[state.journalOrder.shift()!];
}

/** Applies a complete companion batch in memory. The caller persists the returned state before returning ACKs. */
export function reconcileCompanionBatch(planning: CalendarItem[], desktopChecklist: ChecklistItem[], state: CompanionState, operations: SyncOperation[]) {
  if (!Array.isArray(operations) || operations.length > 500) throw Object.assign(new Error('Lot compagnon invalide.'), { code: 'COMPANION_PAYLOAD_INVALID' });
  const nextPlanning = clone(planning); const nextState = clone(state); const acknowledged: string[] = []; const conflicts: CompanionConflict[] = [];
  if (!nextState.serverRevision) nextState.serverRevision = 0;
  for (const raw of operations) {
    if (!plain(raw)) throw Object.assign(new Error('Opération compagnon invalide.'), { code: 'COMPANION_PAYLOAD_INVALID' });
    const operationIdValue = raw.operationId ?? raw.id; const type = String(raw.type ?? ''); const entityIdValue = raw.eventId ?? raw.entityId;
    if (!validId(operationIdValue) || !validId(entityIdValue) || !Number.isInteger(raw.baseRevision) || Number(raw.baseRevision) < 0) throw Object.assign(new Error('Identité ou révision compagnon invalide.'), { code: 'COMPANION_PAYLOAD_INVALID' });
    const operationId = operationIdValue as string; const entityId = entityIdValue as string; const baseRevision = raw.baseRevision as number;
    if (nextState.journal[operationId]) { acknowledged.push(operationId); continue; }
    if (nextState.conflicts[operationId]) { conflicts.push(clone(nextState.conflicts[operationId])); continue; }
    const collectionMatch = /^(notes|checklist|templates)\.(upsert|delete)$/.exec(type);
    if (collectionMatch) {
      const kind = collectionMatch[1] as 'notes' | 'checklist' | 'templates';
      const list = nextState[kind]; const index = list.findIndex(item => item.id === entityId); const current = index < 0 ? undefined : list[index];
      if ((current?.revision ?? 0) !== baseRevision) {
        const conflict = { operationId, entityType: kind, entityId, fields: ['value'], pc: clone(current), android: clone(raw.patch), baseRevision: baseRevision };
        nextState.conflicts[operationId] = conflict; conflicts.push(conflict); continue;
      }
      if (collectionMatch[2] === 'delete') { if (index >= 0) list.splice(index, 1); }
      else {
        const patch = validatePatch(raw.patch, new Set(kind === 'notes' ? ['text'] : kind === 'checklist' ? ['label', 'done'] : ['title', 'description', 'twitchCategoryId', 'twitchCategoryName', 'desiredPublication']));
        const item = { ...(current ?? {}), ...patch, id: entityId, revision: (current?.revision ?? 0) + 1, updatedAt: new Date().toISOString() };
        if (index < 0) list.push(item); else list[index] = item;
      }
      nextState.serverRevision++; acknowledge(nextState, operationId); acknowledged.push(operationId); continue;
    }
    if (!['create', 'update', 'delete'].includes(type)) throw Object.assign(new Error('Type opération compagnon invalide.'), { code: 'COMPANION_PAYLOAD_INVALID' });
    const index = nextPlanning.findIndex(item => item.id === entityId); const current = index < 0 ? undefined : nextPlanning[index]; const currentRevision = nextState.eventRevisions[entityId] ?? (current ? 1 : 0);
    const patch = validatePatch(raw.patch ?? {}, EVENT_FIELDS);
    if (type === 'create') {
      if (current || nextState.tombstones[entityId]) {
        const conflict = { operationId, entityType: 'planning', entityId, fields: ['identity'], pc: clone(current ?? nextState.tombstones[entityId]), android: patch, baseRevision: baseRevision };
        nextState.conflicts[operationId] = conflict; conflicts.push(conflict); continue;
      }
      const item = { ...patch, id: entityId, localId: entityId } as unknown as CalendarItem; validateEvent(item as unknown as Record<string, unknown>);
      nextPlanning.push(item); nextState.eventRevisions[entityId] = 1; nextState.eventHistory[entityId] = clone(item as unknown as Record<string, unknown>);
    } else if (type === 'delete') {
      if (!current) { nextState.eventRevisions[entityId] = Math.max(currentRevision, baseRevision) + 1; }
      else if (currentRevision !== baseRevision) {
        const conflict = { operationId, entityType: 'planning', entityId, fields: ['delete'], pc: clone(current), android: null, baseRevision: baseRevision };
        nextState.conflicts[operationId] = conflict; conflicts.push(conflict); continue;
      } else nextPlanning.splice(index, 1);
      const revision = Math.max(currentRevision, baseRevision) + 1;
      nextState.eventRevisions[entityId] = revision; nextState.tombstones[entityId] = { id: entityId, revision, updatedAt: new Date().toISOString() }; delete nextState.eventHistory[entityId];
    } else {
      if (!current || nextState.tombstones[entityId]) {
        const conflict = { operationId, entityType: 'planning', entityId, fields: ['deleted'], pc: clone(nextState.tombstones[entityId]), android: patch, baseRevision: baseRevision };
        nextState.conflicts[operationId] = conflict; conflicts.push(conflict); continue;
      }
      let merged = { ...current } as Record<string, unknown>;
      if (currentRevision !== baseRevision) {
        const base = plain(raw.base) ? raw.base : nextState.eventHistory[entityId];
        const pcFields = Object.keys(current).filter(key => base && !equal(base[key], (current as unknown as Record<string, unknown>)[key]));
        const overlap = Object.keys(patch).filter(key => pcFields.includes(key) && base && !equal(patch[key], base[key]));
        if (overlap.length) {
          const conflict = { operationId, entityType: 'planning', entityId, fields: overlap, pc: clone(current), android: patch, baseRevision: baseRevision };
          nextState.conflicts[operationId] = conflict; conflicts.push(conflict); continue;
        }
      }
      nextState.eventHistory[entityId] = clone(current as unknown as Record<string, unknown>); merged = { ...merged, ...patch }; validateEvent(merged); nextPlanning[index] = merged as unknown as CalendarItem; nextState.eventRevisions[entityId] = currentRevision + 1;
    }
    nextState.serverRevision++; acknowledge(nextState, operationId); acknowledged.push(operationId);
  }
  return { planning: nextPlanning, checklist: nextState.checklist.length ? nextState.checklist.map(item => ({ id: item.id, label: String(item.label ?? ''), done: item.done === true })) : desktopChecklist, companion: nextState, acknowledged, conflicts };
}

export function companionSnapshot(planning: CalendarItem[], state: CompanionState) {
  return { schemaVersion: COMPANION_SYNC_SCHEMA_VERSION, serverRevision: state.serverRevision, planning: planning.map(item => ({ ...clone(item), revision: state.eventRevisions[item.id] ?? 1, providerLinks: clone(item.providers ?? {}) })), tombstones: Object.values(state.tombstones).map(clone), notes: clone(state.notes), checklist: clone(state.checklist), templates: clone(state.templates) };
}

export function resolveCompanionConflict(planning: CalendarItem[], state: CompanionState, operationId: string, strategy: 'pc' | 'android') {
  const conflict = state.conflicts[operationId];
  if (!conflict) throw Object.assign(new Error('Conflit compagnon introuvable.'), { code: 'NOT_FOUND' });
  if (strategy === 'android' && conflict.entityType === 'planning') {
    const index = planning.findIndex(item => item.id === conflict.entityId);
    if (index < 0 || !plain(conflict.android)) throw Object.assign(new Error('Résolution Android impossible pour un événement supprimé.'), { code: 'COMPANION_CONFLICT_INVALID' });
    const patch = validatePatch(conflict.android, EVENT_FIELDS);
    const merged = { ...planning[index], ...patch }; validateEvent(merged as unknown as Record<string, unknown>); planning[index] = merged;
    state.eventRevisions[conflict.entityId] = (state.eventRevisions[conflict.entityId] ?? 1) + 1;
    state.eventHistory[conflict.entityId] = clone(merged as unknown as Record<string, unknown>);
    state.serverRevision++;
  }
  delete state.conflicts[operationId]; acknowledge(state, operationId);
  return { planning, companion: state, acknowledged: [operationId] };
}
