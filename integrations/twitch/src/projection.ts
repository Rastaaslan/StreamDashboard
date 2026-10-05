import { reconcileProviderProjection, summarizeProjection, projectionContent } from '../../../packages/core/src/provider-projection.js';
import type { CalendarItem, ProviderLink } from '../../../packages/contracts/src/index.js';
import type { PlanningProvider } from '../../../packages/core/src/planning.js';
import { expandRecurringItems } from '../../../packages/core/src/recurrence.js';
import { assertTwitchRecurrence } from './recurrence.js';

export type OccurrenceEngine = typeof expandRecurringItems;
export function needsTwitchMaterialization(item: CalendarItem) {
  if (!item.recurrence) return false;
  try { assertTwitchRecurrence(item); return false; } catch { return true; }
}

function request(event: CalendarItem, link: ProviderLink): CalendarItem {
  // A projected occurrence is a one-off on Twitch, with identity kept locally.
  const { recurrence, seriesId, occurrenceKey, providers, conflict, twitchSegmentId, ...body } = event;
  return { ...body, twitchRecurring: false, providers: { twitch: link } };
}

export async function reconcileTwitchProjection(item: CalendarItem, provider: PlanningProvider | undefined, persist: () => Promise<void>, options: { now?: number; retry?: boolean; expand?: OccurrenceEngine } = {}) {
 try { return await reconcileProviderProjection(item, provider, persist, { ...options, name: 'twitch', materialized: needsTwitchMaterialization(item), expand: options.expand ?? expandRecurringItems }); }
 catch (error) { const link = (item.providers ??= {}).twitch ??= { status: 'error' }; link.status = 'error'; link.lastError = (error as Error).message; await persist(); return true; }
}
/** Resolve exactly one managed occurrence. A retry never authorizes overwriting
 * remote edits; both choices first read the current body and preconditions. */
export async function resolveTwitchOccurrenceConflict(
  item: CalendarItem, key: string, strategy: 'local' | 'remote',
  provider: PlanningProvider | undefined, persist: () => Promise<void>,
) {
  const link = item.providers?.twitch;
  const entry = link?.projections?.[key];
  if (item.ownership !== 'LOCAL' || !entry || entry.managedBy !== 'StreamDashboard' || entry.status !== 'conflict') {
    throw new Error('Aucun conflit Twitch à résoudre pour cette occurrence.');
  }
  try {
    if (!item.recurrence || !link?.projectionWindow || !item.desiredPublication?.twitch) throw new Error('Occurrence inactive : actualisez la projection Twitch.');
    if (!provider?.read || !entry.remoteId) throw new Error('Lecture distante Twitch requise pour résoudre cette occurrence.');
    const latest = await provider.read(entry.remoteId, request(entry.event, entry));
    if (latest.deleted) throw Object.assign(new Error('Occurrence supprimée à distance — retry explicite requis.'), { code: 'DELETED_REMOTELY' });
    if (!latest.remote || !latest.fingerprint) throw new Error('Version ou empreinte distante indisponible.');
    const occurrence = expandRecurringItems([{ ...item, providers: undefined }], link.projectionWindow).find(value => value.occurrenceKey === key);
    if (!occurrence) throw new Error('Occurrence hors fenêtre : actualisez la projection Twitch.');
    entry.fingerprint = latest.fingerprint;
    entry.remoteRevision = latest.revision;
    // Keep conflict durable until success, including crashes after this save or a failed PATCH.
    await persist();
    let event = request(occurrence, { status: 'pending', projectionOwned: true });
    if (strategy === 'local') {
      const result = await provider.update(entry.remoteId, request(event, entry), entry.remoteRevision);
      entry.fingerprint = result.fingerprint;
      entry.remoteRevision = result.revision;
    } else {
      const remote = latest.remote;
      const patch = { title: remote.title, startAtUtc: remote.startAtUtc, endAtUtc: remote.endAtUtc,
        twitchCategoryId: remote.twitchCategoryId ?? '', twitchCategoryName: remote.twitchCategoryName ?? '' };
      const exceptions = item.recurrence.exceptions ??= {};
      exceptions[key] = { ...exceptions[key], patch: { ...exceptions[key]?.patch, ...patch } };
      event = { ...event, ...patch };
    }
    entry.event = event;
    entry.appliedContent = projectionContent(event);
    entry.status = 'synced'; entry.deletedRemotely = false;
    entry.lastSyncedAt = new Date().toISOString(); delete entry.lastError;
    summarizeProjection(item, 'twitch');
    await persist();
  } catch (error) {
    const deleted = (error as { code?: string }).code === 'DELETED_REMOTELY';
    entry.status = deleted ? 'error' : 'conflict';
    if (deleted) entry.deletedRemotely = true;
    entry.lastError = error instanceof Error ? error.message : String(error);
    summarizeProjection(item, 'twitch');
    await persist();
    throw error;
  }
}
