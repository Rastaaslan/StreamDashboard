import { createHash } from 'node:crypto';
import type { CalendarItem, RecurrenceProjectionIdentity } from '../../../packages/contracts/src/index.js';
import { expandRecurringItems, migrateRecurrence } from '../../../packages/core/src/recurrence.js';
import type { OccurrenceSource, RecurrenceProjection, RecurrenceWindow } from '../../../packages/core/src/recurrence-projection.js';
import type { GoogleEventInput } from './client.js';
import { assertGoogleMaterializedAllDay, googleRecurrence } from './recurrence.js';

export function googleProjectionLocalId(identity: RecurrenceProjectionIdentity): string {
  return identity.mode === 'master' ? identity.seriesLocalId : `sd-occ-${createHash('sha256')
    .update(JSON.stringify([identity.seriesLocalId, identity.occurrenceKey])).digest('hex')}`;
}

/** Pure projection seam for a rolling reconciler. No remote mutation or mode switch.
 * Native masters must be explicitly retired before activating materialized links.
 */
export function projectGoogleSeries(item: CalendarItem, window: RecurrenceWindow,
  source: OccurrenceSource = { expand: expandRecurringItems }): RecurrenceProjection<GoogleEventInput> {
  if (item.seriesId || item.occurrenceKey) throw new Error('Une projection exige une série canonique.');
  const seriesLocalId = item.localId || item.id;
  if (!seriesLocalId) throw new Error('Identité de série manquante.');
  if (item.recurrence) migrateRecurrence(item.recurrence); // refuse unknown versions, even with an injected engine
  if (!Number.isFinite(Date.parse(item.startAtUtc)) || !Number.isFinite(Date.parse(item.endAtUtc))
    || Date.parse(item.endAtUtc) <= Date.parse(item.startAtUtc)) throw new Error('Dates de série invalides.');
  if (item.recurrence) {
    if (!item.recurrence.timeZone) throw new Error('Fuseau de série requis.');
    new Intl.DateTimeFormat('en', { timeZone: item.recurrence.timeZone });
    if (item.recurrence.until && (!Number.isFinite(Date.parse(item.recurrence.until))
      || Date.parse(item.recurrence.until) < Date.parse(item.startAtUtc))) throw new Error('Fin de série invalide.');
  }
  try {
    googleRecurrence(item);
    const identity: RecurrenceProjectionIdentity = { mode: 'master', seriesLocalId };
    return { mode: 'master', entries: [{ identity, input: { ...item, localId: seriesLocalId, projection: identity } }] };
  } catch (error) {
    if (!item.recurrence) throw error;
  }
  const from = +new Date(window.from); const to = +new Date(window.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) throw new Error('Fenêtre de projection invalide.');
  const keys = new Set<string>();
  const entries = source.expand([structuredClone(item)], window).map(occurrence => {
    const key = occurrence.occurrenceKey;
    const start = Date.parse(occurrence.startAtUtc); const end = Date.parse(occurrence.endAtUtc);
    if (!key || occurrence.seriesId !== item.id || keys.has(key)
      || !Number.isFinite(start) || !Number.isFinite(end) || end <= start || start >= to || end <= from) {
      throw new Error('Occurrence de projection invalide ou dupliquée.');
    }
    keys.add(key);
    assertGoogleMaterializedAllDay(occurrence);
    const identity: RecurrenceProjectionIdentity = { mode: 'materialized', seriesLocalId, occurrenceKey: key };
    // Never reuse a master link or its etag for an occurrence.
    const input: GoogleEventInput = {
      localId: googleProjectionLocalId(identity), projection: identity,
      title: occurrence.title, description: occurrence.description,
      startAtUtc: occurrence.startAtUtc, endAtUtc: occurrence.endAtUtc, allDay: occurrence.allDay,
    };
    return { identity, input };
  });
  return { mode: 'materialized', window: structuredClone(window), entries };
}

import type { PlanningProvider } from '../../../packages/core/src/planning.js';
import { reconcileProviderProjection } from '../../../packages/core/src/provider-projection.js';

export function needsGoogleMaterialization(item: CalendarItem) {
  if (!item.recurrence) return false;
  try { googleRecurrence(item); return false; } catch { return true; }
}

export async function reconcileGoogleProjection(item: CalendarItem, provider: PlanningProvider | undefined,
  persist: () => Promise<void>, options: { now?: number; retry?: boolean } = {}) {
  try {
    return await reconcileProviderProjection(item, provider, persist, {
      ...options, name: 'google', materialized: needsGoogleMaterialization(item),
      expand: (items, window) => items.flatMap(master => projectGoogleSeries(master, window).entries.map(({ input, identity }) => ({
        ...master, ...input, recurrence: undefined, seriesId: undefined,
        occurrenceKey: identity.mode === 'materialized' ? identity.occurrenceKey : undefined,
      }))),
    });
  } catch (error) {
    const link = (item.providers ??= {}).google ??= { status: 'error' };
    link.status = 'error'; link.lastError = (error as Error).message;
    await persist(); return true;
  }
}

import { projectionContent, summarizeProjection } from '../../../packages/core/src/provider-projection.js';

export async function resolveGoogleOccurrenceConflict(item: CalendarItem, key: string, strategy: 'local' | 'remote',
  provider: PlanningProvider | undefined, persist: () => Promise<void>) {
  const link = item.providers?.google;
  const entry = link?.projections?.[key];
  if (item.ownership !== 'LOCAL' || !entry || entry.managedBy !== 'StreamDashboard' || entry.status !== 'conflict') throw new Error('Aucun conflit Google pour cette occurrence.');
  try {
    if (!item.recurrence || !link?.projectionWindow || !item.desiredPublication?.google || !entry.remoteId || !provider?.read) throw new Error('Occurrence Google inactive ou lecture indisponible.');
    const latest = await provider.read(entry.remoteId, { ...entry.event, providers: { google: entry } });
    if (latest.deleted) throw Object.assign(new Error('Occurrence supprimée à distance — retry explicite requis.'), { code: 'DELETED_REMOTELY' });
    if (!latest.remote || !latest.revision) throw new Error('Version Google distante indisponible.');
    const projected = projectGoogleSeries(item, link.projectionWindow).entries.find(value => value.identity.mode === 'materialized' && value.identity.occurrenceKey === key);
    if (!projected) throw new Error('Occurrence hors fenêtre : actualisez la projection.');
    let event: CalendarItem = { ...entry.event, ...projected.input };
    entry.remoteRevision = latest.revision;
    await persist();
    if (strategy === 'local') {
      const result = await provider.update(entry.remoteId, { ...event, providers: { google: entry } }, latest.revision);
      entry.remoteRevision = result.revision;
    } else {
      const patch = { title: latest.remote.title, description: latest.remote.description, startAtUtc: latest.remote.startAtUtc,
        endAtUtc: latest.remote.endAtUtc, allDay: latest.remote.allDay };
      assertGoogleMaterializedAllDay({ ...event, ...patch });
      const exceptions = item.recurrence.exceptions ??= {};
      exceptions[key] = { ...exceptions[key], patch: { ...exceptions[key]?.patch, ...patch } };
      event = { ...event, ...patch };
    }
    entry.event = event; entry.appliedContent = projectionContent(event);
    entry.status = 'synced'; entry.deletedRemotely = false; delete entry.lastError;
    summarizeProjection(item, 'google'); await persist();
  } catch (error) {
    entry.deletedRemotely = (error as { code?: string }).code === 'DELETED_REMOTELY';
    entry.status = entry.deletedRemotely ? 'error' : 'conflict'; entry.lastError = (error as Error).message;
    summarizeProjection(item, 'google'); await persist(); throw error;
  }
}
