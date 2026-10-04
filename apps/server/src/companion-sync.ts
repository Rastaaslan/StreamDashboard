import { tagMetadata, tagPreferences } from '../../../packages/core/src/tags.js';
import { publicationContent } from '../../mobile/shared/publication-content.js';
import type { CalendarItem, ChecklistItem } from '../../../packages/contracts/src/index.js';

export const COMPANION_SYNC_SCHEMA_VERSION = 3;
const MAX_JOURNAL = 5_000;
const EVENT_FIELDS = new Set(['id', 'localId', 'title', 'description', 'startAtUtc', 'endAtUtc', 'allDay', 'category', 'kind', 'draft', 'twitchCategoryId', 'twitchCategoryName', 'tags', 'tagPreferences', 'desiredPublication', 'providerLinks', 'providers', 'recurrence']);

export interface CompanionEntity { id: string; revision: number; updatedAt: string; [key: string]: unknown }
export interface CompanionConflict { operationId: string; entityType: string; entityId: string; fields: string[]; pc: unknown; android: unknown; baseRevision: number }
export interface CompanionProviderWork {
  item: CalendarItem;
  provider: 'twitch' | 'google';
  action: 'publish' | 'delete';
  status: 'queued' | 'running' | 'error';
  error?: string;
  uncertain?: boolean;
}
export interface CompanionState {
  providerWork: Record<string, CompanionProviderWork>;
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
  return { providerWork: {}, serverRevision: 0, eventRevisions: {}, eventHistory: {}, tombstones: {}, notes: [], templates: [], checklist: [], journal: {}, journalOrder: [], conflicts: {} };
}

const clone = <T>(value: T): T => structuredClone(value);
const plain = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const canonical = (value: unknown) => JSON.stringify(value, (_key, part) => plain(part) ? Object.fromEntries(Object.keys(part).sort().map(key => [key, part[key]])) : part);
const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const validId = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);

function validatePatch(patch: unknown, allowed: Set<string>) {
  if (!plain(patch)) throw Object.assign(new Error('Patch compagnon invalide.'), { code: 'COMPANION_PAYLOAD_INVALID' });
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!allowed.has(key) || ['__proto__', 'prototype', 'constructor'].includes(key)) throw Object.assign(new Error(`Champ compagnon interdit: ${key}`), { code: 'COMPANION_PAYLOAD_INVALID' });
    if (typeof value === 'string' && value.length > (key === 'description' ? 4_000 : 500)) throw Object.assign(new Error('Champ compagnon trop long.'), { code: 'COMPANION_PAYLOAD_INVALID' });
    output[key] = key === 'recurrence' ? validateRecurrence(value) : key === 'tags' ? tagMetadata(value) : key === 'tagPreferences' ? tagPreferences(value) : clone(value);
  }
  return output;
}

function validateRecurrence(value: unknown) {
  if (value === null) return null;
  if (!plain(value) || Object.keys(value).some(key => !['frequency', 'interval', 'timeZone', 'until', 'exceptions'].includes(key))) throw Object.assign(new Error('Récurrence compagnon invalide.'), { code: 'COMPANION_PAYLOAD_INVALID' });
  if (!['daily', 'weekly', 'monthly'].includes(String(value.frequency)) || ![1, 2].includes(Number(value.interval)) || (value.frequency !== 'weekly' && value.interval !== 1)) throw Object.assign(new Error('Règle compagnon invalide.'), { code: 'COMPANION_PAYLOAD_INVALID' });
  const timeZone = String(value.timeZone ?? ''); try { new Intl.DateTimeFormat('fr-FR', { timeZone }).format(); } catch { throw Object.assign(new Error('Fuseau compagnon invalide.'), { code: 'COMPANION_PAYLOAD_INVALID' }); }
  if (value.until != null && !Number.isFinite(Date.parse(String(value.until)))) throw Object.assign(new Error('Fin de série invalide.'), { code: 'COMPANION_PAYLOAD_INVALID' });
  if (value.exceptions !== undefined && (!plain(value.exceptions) || Object.keys(value.exceptions).length > 500)) throw Object.assign(new Error('Exceptions compagnon invalides.'), { code: 'COMPANION_PAYLOAD_INVALID' });
  for (const [key, exception] of Object.entries(value.exceptions || {})) {
    if (!/^[A-Za-z0-9._:-]{1,128}:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(key) || !plain(exception) || Object.keys(exception).some(field => !['cancelled', 'patch'].includes(field)) || (exception.patch !== undefined && (!plain(exception.patch) || Object.keys(exception.patch).some(field => !['title', 'description', 'startAtUtc', 'endAtUtc', 'category', 'kind', 'twitchCategoryId', 'twitchCategoryName', 'tags', 'tagPreferences', 'desiredPublication'].includes(field))))) throw Object.assign(new Error('Exception compagnon invalide.'), { code: 'COMPANION_PAYLOAD_INVALID' });
  }
  const normalized = clone(value);
  for (const exception of Object.values(normalized.exceptions ?? {})) {
    if (exception.patch?.tags !== undefined) exception.patch.tags = tagMetadata(exception.patch.tags);
    if (exception.patch?.tagPreferences !== undefined) exception.patch.tagPreferences = tagPreferences(exception.patch.tagPreferences);
  }
  return normalized;
}

// Translate the Android wire representation into the Desktop provider model.
function normalizeEventPatch(patch: Record<string, unknown>) {
  const links = patch.providerLinks ?? patch.providers;
  delete patch.providerLinks;
  if (links !== undefined) {
    if (!plain(links) || Object.keys(links).some(key => !['twitch', 'google'].includes(key)))
      throw Object.assign(new Error('Liens provider invalides.'), { code: 'COMPANION_PAYLOAD_INVALID' });
    patch.providers = Object.fromEntries(Object.entries(links).map(([name, value]) => {
      if (!plain(value)) throw Object.assign(new Error('Lien provider invalide.'), { code: 'COMPANION_PAYLOAD_INVALID' });
      const { revision, lastProviderSyncAt, ...link } = value;
      return [name, { ...link, ...(revision !== undefined ? { remoteRevision: revision } : {}),
        ...(lastProviderSyncAt ? { lastSyncedAt: lastProviderSyncAt } : {}),
        status: link.status === 'syncing' ? 'pending' : link.status === 'deleted' ? 'not-published' : link.status,
        ...(link.status === 'deleted' ? { remoteId: undefined, remoteRevision: undefined } : {}) }];
    }));
  }
  delete patch.id; delete patch.localId;
  return patch;
}

function mergeEvent(current: CalendarItem, patch: Record<string, unknown>) {
  const providers = { ...current.providers };
  for (const [name, link] of Object.entries((patch.providers as CalendarItem['providers']) ?? {})) {
    const provider = name as 'twitch' | 'google';
    providers[provider] = { ...providers[provider], ...link };
  }
  const merged = { ...current, ...patch, providers };
  const twitch = (patch.providers as CalendarItem['providers'])?.twitch;
  if (twitch?.status === 'not-published' && !twitch.remoteId) delete merged.twitchSegmentId;
  else if (twitch?.remoteId) merged.twitchSegmentId = twitch.remoteId;
  return merged;
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

function syncDesktopChecklist(state: CompanionState, desktopChecklist: ChecklistItem[]) {
  const currentById = new Map(state.checklist.map(item => [item.id, item]));
  const updatedAt = new Date().toISOString();
  let changed = state.checklist.length !== desktopChecklist.length;
  const next = desktopChecklist.map(item => {
    const current = currentById.get(item.id);
    if (!current) {
      changed = true;
      return { id: item.id, label: item.label, done: item.done, revision: 1, updatedAt };
    }
    if (String(current.label ?? '') !== item.label || current.done === true !== item.done) {
      changed = true;
      return { ...current, label: item.label, done: item.done, revision: (current.revision ?? 0) + 1, updatedAt };
    }
    return current;
  });
  if (changed) state.serverRevision++;
  state.checklist = next;
}

/** Applies a complete companion batch in memory. The caller persists the returned state before returning ACKs. */
export function reconcileCompanionBatch(planning: CalendarItem[], desktopChecklist: ChecklistItem[], state: CompanionState, operations: SyncOperation[]) {
  if (!Array.isArray(operations) || operations.length > 500) throw Object.assign(new Error('Lot compagnon invalide.'), { code: 'COMPANION_PAYLOAD_INVALID' });
  const nextPlanning = clone(planning); const nextState = clone(state); const acknowledged: string[] = []; const conflicts: CompanionConflict[] = [];
  if (!nextState.serverRevision) nextState.serverRevision = 0;
  nextState.providerWork ??= {};
  syncDesktopChecklist(nextState, desktopChecklist);
  for (const raw of operations) {
    if (!plain(raw)) throw Object.assign(new Error('Opération compagnon invalide.'), { code: 'COMPANION_PAYLOAD_INVALID' });
    const operationIdValue = raw.operationId ?? raw.id; const type = String(raw.type ?? ''); const entityIdValue = raw.eventId ?? raw.entityId;
    if (!validId(operationIdValue) || !validId(entityIdValue) || !Number.isInteger(raw.baseRevision) || Number(raw.baseRevision) < 0) throw Object.assign(new Error('Identité ou révision compagnon invalide.'), { code: 'COMPANION_PAYLOAD_INVALID' });
    const operationId = operationIdValue as string; const entityId = entityIdValue as string; const baseRevision = raw.baseRevision as number;
    if (nextState.journal[operationId]) { acknowledged.push(operationId); continue; }
    if (nextState.conflicts[operationId]) { conflicts.push(clone(nextState.conflicts[operationId])); continue; }
    const blocked = Object.values(nextState.conflicts).find(conflict => conflict.entityId === entityId);
    if (blocked) { if (!conflicts.some(value => value.operationId === blocked.operationId)) conflicts.push(clone(blocked)); continue; }
    const collectionMatch = /^(notes|checklist|templates)\.(upsert|delete)$/.exec(type);
    if (collectionMatch) {
      const kind = collectionMatch[1] as 'notes' | 'checklist' | 'templates';
      const list = nextState[kind]; const index = list.findIndex(item => item.id === entityId); const current = index < 0 ? undefined : list[index];
      if ((current?.revision ?? 0) !== baseRevision) {
        const conflict = { operationId, entityType: kind, entityId, fields: ['value'], pc: clone(current), android: collectionMatch[2] === 'delete' ? null : clone(raw.patch), baseRevision: baseRevision };
        nextState.conflicts[operationId] = conflict; conflicts.push(conflict); continue;
      }
      if (collectionMatch[2] === 'delete') { if (index >= 0) list.splice(index, 1); }
      else {
        const patch = validatePatch(raw.patch, new Set(kind === 'notes' ? ['text'] : kind === 'checklist' ? ['label', 'done'] : ['title', 'description', 'twitchCategoryId', 'twitchCategoryName', 'tags', 'tagPreferences', 'desiredPublication']));
        const item = { ...(current ?? {}), ...patch, id: entityId, revision: (current?.revision ?? 0) + 1, updatedAt: new Date().toISOString() };
        if (index < 0) list.push(item); else list[index] = item;
      }
      nextState.serverRevision++; acknowledge(nextState, operationId); acknowledged.push(operationId); continue;
    }
    if (!['create', 'update', 'delete'].includes(type)) throw Object.assign(new Error('Type opération compagnon invalide.'), { code: 'COMPANION_PAYLOAD_INVALID' });
    const index = nextPlanning.findIndex(item => item.id === entityId); const current = index < 0 ? undefined : nextPlanning[index]; const currentRevision = nextState.eventRevisions[entityId] ?? (current ? 1 : 0);
    const previousDeletedItem = nextState.tombstones[entityId]?.item as CalendarItem | undefined;
    const patch = normalizeEventPatch(validatePatch(raw.patch ?? {}, EVENT_FIELDS));
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
      nextState.eventRevisions[entityId] = revision; nextState.tombstones[entityId] = { id: entityId, revision, updatedAt: new Date().toISOString(), ...(current ? { item: clone(current), providerLinks: clone(current.providers ?? {}) } : {}) }; delete nextState.eventHistory[entityId];
    } else {
      if (!current || nextState.tombstones[entityId]) {
        const conflict = { operationId, entityType: 'planning', entityId, fields: ['deleted'], pc: clone(nextState.tombstones[entityId]), android: patch, baseRevision: baseRevision };
        nextState.conflicts[operationId] = conflict; conflicts.push(conflict); continue;
      }
      let merged = { ...current } as Record<string, unknown>;
      if (currentRevision !== baseRevision || (plain(raw.base) && Object.keys(raw.base).length)) {
        const base = plain(raw.base) && Object.keys(raw.base).length ? normalizeEventPatch(clone(raw.base)) : undefined;
        const pcFields = Object.keys(current).filter(key => base && !equal(base[key], (current as unknown as Record<string, unknown>)[key]));
        const recoveringCreate = base && plain(base.providers) && plain(patch.providers)
          && Object.entries(patch.providers).every(([name, incoming]) => {
            const pcLink = current.providers?.[name as 'google' | 'twitch'];
            const baseLink = (base.providers as Record<string, any>)[name];
            return plain(incoming) && !pcLink?.remoteId && pcLink?.uncertainCreate && baseLink?.uncertainCreate
              && equal(pcLink.uncertainCreate, baseLink.uncertainCreate)
              && (equal(incoming.uncertainCreate, baseLink.uncertainCreate) || (incoming.remoteId && incoming.uncertainCreate === null));
          });
        const overlap = Object.keys(patch).filter(key => !(key === 'providers' && recoveringCreate) && (!base || (pcFields.includes(key) && !equal(patch[key], base[key]) && !equal(patch[key], (current as unknown as Record<string, unknown>)[key]))));
        if (overlap.length) {
          const conflict = { operationId, entityType: 'planning', entityId, fields: overlap, pc: clone(current), android: patch, baseRevision: baseRevision };
          nextState.conflicts[operationId] = conflict; conflicts.push(conflict); continue;
        }
      }
      nextState.eventHistory[entityId] = clone(current as unknown as Record<string, unknown>); merged = mergeEvent(current, patch) as unknown as Record<string, unknown>; validateEvent(merged); nextPlanning[index] = merged as unknown as CalendarItem; nextState.eventRevisions[entityId] = currentRevision + 1;
    }
    const resultItem = nextPlanning.find(item => item.id === entityId);
    const providerItem = resultItem ?? (current ? mergeEvent(current, patch) : previousDeletedItem ? mergeEvent(previousDeletedItem, patch) : undefined);
    if (providerItem) {
      if (!resultItem) { nextState.tombstones[entityId].item = clone(providerItem); nextState.tombstones[entityId].providerLinks = clone(providerItem.providers ?? {}); }
      for (const provider of ['twitch', 'google'] as const) {
        const key = entityId + ':' + provider;
        const metadataOnly = type === 'update' && Object.keys(patch).every(key => key === 'providers');
        const link = providerItem.providers?.[provider];
        const suppliedLink = (patch.providers as CalendarItem['providers'])?.[provider];
        if (link?.uncertainCreate && !link.remoteId) {
          nextState.providerWork[key] = { item: clone(providerItem), provider, action: 'publish', status: 'running', uncertain: true };
          continue;
        }
        if (suppliedLink?.createNotStarted === true && !link?.remoteId) {
          if (providerItem.desiredPublication?.[provider])
            nextState.providerWork[key] = { item: clone(providerItem), provider, action: 'publish', status: 'queued' };
          else delete nextState.providerWork[key];
          continue;
        }
        if (metadataOnly) {
          if (suppliedLink?.status === 'pending' && !suppliedLink.remoteId) {
            nextState.providerWork[key] = { item: clone(providerItem), provider, action: 'publish', status: 'running', uncertain: true };
          }
          if (suppliedLink?.status === 'synced' || (suppliedLink?.status === 'pending' && suppliedLink.remoteId)) {
            const currentContent = publicationContent(providerItem, provider);
            if (suppliedLink.publishedContent === currentContent) delete nextState.providerWork[key];
            else {
              // An old completion only confirms remote identity, never a newer edit.
              link!.status = 'pending';
              nextState.providerWork[key] = { item: clone(providerItem), provider,
                action: providerItem.desiredPublication?.[provider] ? 'publish' : 'delete', status: 'queued' };
            }
          }
          if (suppliedLink?.status === 'not-published' && !providerItem.desiredPublication?.[provider]) delete nextState.providerWork[key];
          continue;
        }
        if (type === 'create' && link?.status === 'synced') continue;
        const action = !resultItem || !providerItem.desiredPublication?.[provider] ? 'delete' : 'publish';
        if (action === 'delete' && !link?.remoteId) { delete nextState.providerWork[key]; continue; }
        const previousWork = nextState.providerWork[key];
        nextState.providerWork[key] = previousWork?.uncertain && !link?.remoteId
          ? { ...previousWork, item: clone(providerItem) }
          : { item: clone(providerItem), provider, action, status: 'queued' };
      }
    }
    nextState.serverRevision++; acknowledge(nextState, operationId); acknowledged.push(operationId);
  }
  // A provider refresh may import an Android publication before its journal
  // arrives. Keep the Android identity and retire only the external projection.
  for (let index = nextPlanning.length - 1; index >= 0; index--) {
    const imported = nextPlanning[index];
    if (imported.ownership !== 'EXTERNAL') continue;
    const canonicalItem = nextPlanning.find(item => item.id !== imported.id && item.ownership !== 'EXTERNAL'
      && (['twitch', 'google'] as const).some(provider => {
        const left = imported.providers?.[provider]; const right = item.providers?.[provider];
        return left?.remoteId && left.remoteId === right?.remoteId
          && (provider !== 'google' || left.calendarId === right.calendarId);
      }));
    if (!canonicalItem) continue;
    nextPlanning.splice(index, 1);
    const revision = (nextState.eventRevisions[imported.id] ?? 1) + 1;
    nextState.eventRevisions[imported.id] = revision;
    nextState.tombstones[imported.id] = { id: imported.id, revision, updatedAt: new Date().toISOString() };
    delete nextState.eventHistory[imported.id]; nextState.serverRevision++;
  }
  return { planning: nextPlanning, checklist: nextState.checklist.map(item => ({ id: item.id, label: String(item.label ?? ''), done: item.done === true })), companion: nextState, acknowledged, conflicts };
}

function companionProviderLinks(links: CalendarItem['providers']) {
  return Object.fromEntries(Object.entries(links ?? {}).map(([name, link]) => [name, {
    ...clone(link), revision: link.remoteRevision, lastProviderSyncAt: link.lastSyncedAt,
  }]));
}

export function companionSnapshot(planning: CalendarItem[], state: CompanionState) {
  return { schemaVersion: COMPANION_SYNC_SCHEMA_VERSION, serverRevision: state.serverRevision,
    providerWork: clone(state.providerWork ?? {}),
    planning: planning.map(item => ({ ...clone(item), revision: state.eventRevisions[item.id] ?? 1,
      providerLinks: companionProviderLinks(item.providers) })),
    tombstones: Object.values(state.tombstones).map(item => ({ ...clone(item),
      providerLinks: companionProviderLinks(item.providerLinks as CalendarItem['providers']) })),
    notes: clone(state.notes), checklist: clone(state.checklist), templates: clone(state.templates) };
}

export function resolveCompanionConflict(planning: CalendarItem[], state: CompanionState, operationId: string, strategy: 'pc' | 'android') {
  const conflict = state.conflicts[operationId];
  if (!conflict && state.journal[operationId]) return { planning: clone(planning), companion: clone(state), acknowledged: [operationId] };
  if (!conflict) throw Object.assign(new Error('Conflit compagnon introuvable.'), { code: 'NOT_FOUND' });
  planning = clone(planning); state = clone(state);
  if (strategy === 'android') {
    const isPlanning = conflict.entityType === 'planning';
    const kind = conflict.entityType as 'notes' | 'checklist' | 'templates';
    const list = isPlanning ? planning : state[kind];
    const index = list.findIndex(item => item.id === conflict.entityId);
    const current = list[index];
    if (conflict.android == null) {
      if (index >= 0) list.splice(index, 1);
      if (isPlanning) {
        const revision = (state.eventRevisions[conflict.entityId] ?? 1) + 1;
        state.eventRevisions[conflict.entityId] = revision;
        state.tombstones[conflict.entityId] = { id: conflict.entityId, revision, updatedAt: new Date().toISOString(), item: clone(current), providerLinks: clone((current as CalendarItem)?.providers ?? {}) };
        delete state.eventHistory[conflict.entityId];
      }
    } else if (isPlanning) {
      if (!current) throw Object.assign(new Error('Événement supprimé : conservez la suppression puis créez un nouvel événement.'), { code: 'COMPANION_CONFLICT_INVALID' });
      const patch = normalizeEventPatch(validatePatch(conflict.android, EVENT_FIELDS));
      const merged = mergeEvent(current as CalendarItem, patch);
      validateEvent(merged as unknown as Record<string, unknown>); planning[index] = merged;
      state.eventRevisions[conflict.entityId] = (state.eventRevisions[conflict.entityId] ?? 1) + 1;
      state.eventHistory[conflict.entityId] = clone(merged as unknown as Record<string, unknown>);
    } else {
      const patch = validatePatch(conflict.android, new Set(kind === 'notes' ? ['text'] : kind === 'checklist' ? ['label', 'done'] : ['title', 'description', 'twitchCategoryId', 'twitchCategoryName', 'tags', 'tagPreferences', 'desiredPublication']));
      const item = { ...current, ...patch, id: conflict.entityId, revision: Number((current as CompanionEntity | undefined)?.revision ?? 0) + 1, updatedAt: new Date().toISOString() };
      if (index < 0) state[kind].push(item); else state[kind][index] = item;
    }
    if (isPlanning) {
      const item = planning.find(item => item.id === conflict.entityId) ?? current as CalendarItem;
      if (item) for (const provider of ['twitch', 'google'] as const) {
        const action = conflict.android == null || !item.desiredPublication?.[provider] ? 'delete' : 'publish';
        if (action === 'publish' || item.providers?.[provider]?.remoteId)
          state.providerWork[item.id + ':' + provider] = { item: clone(item), provider, action, status: 'queued' };
      }
    }
    state.serverRevision++;
  }
  delete state.conflicts[operationId]; acknowledge(state, operationId);
  return { planning, companion: state, acknowledged: [operationId] };
}
