import { needsGoogleMaterialization, reconcileGoogleProjection, resolveGoogleOccurrenceConflict } from '../../../integrations/google-calendar/src/projection.js';
import { needsTwitchMaterialization, reconcileTwitchProjection } from '../../../integrations/twitch/src/projection.js';
import { assertTwitchRecurrence } from '../../../integrations/twitch/src/recurrence.js';
import { googleRecurrence } from '../../../integrations/google-calendar/src/recurrence.js';
import { createWithDurableIntent, isDefinitiveCreateFailure } from '../../../packages/core/src/provider-identity.js';
import { publicationContent } from '../../mobile/shared/publication-content.js';
import type { CalendarItem } from '../../../packages/contracts/src/index.js';
import type { PlanningProvider } from '../../../packages/core/src/planning.js';
import type { CompanionState } from './companion-sync.js';

/** Call under the planning queue. Intent and in-flight state must reach disk before I/O. */
export async function drainCompanionProviders(
  planning: CalendarItem[], state: CompanionState,
  providers: Partial<Record<'twitch' | 'google', PlanningProvider>>,
  persist: () => Promise<void>,
  onlyKey?: string,
) {
  for (const [key, work] of Object.entries(state.providerWork ?? {})) {
    if (onlyKey && onlyKey !== key) continue;
    if (work.status === 'error') continue;
    const item = planning.find(item => item.id === work.item.id) ?? work.item;
    item.providers ??= {};
    const link = item.providers[work.provider] ??= { status: 'pending' };
    const updateTombstone = () => {
      const tombstone = state.tombstones[item.id];
      if (!tombstone) return;
      tombstone.providerLinks = { ...(tombstone.providerLinks as CalendarItem['providers']), [work.provider]: structuredClone(link) };
      const deletedItem = tombstone.item as CalendarItem | undefined;
      if (deletedItem) deletedItem.providers = structuredClone(tombstone.providerLinks as CalendarItem['providers']);
    };
    const fail = async (message: string) => {
      state.providerWork[key] = work;
      work.status = 'error'; work.error = message;
      link.status = link.status === 'conflict' || item.conflict?.provider === work.provider ? 'conflict' : 'error'; link.lastError = message;
      updateTombstone();
      await persist();
    };
    if ((work.provider === 'twitch' ? needsTwitchMaterialization(item) : needsGoogleMaterialization(item)) || link.projections) {
      item.desiredPublication ??= { local: true, twitch: false, google: false };
      item.desiredPublication[work.provider] = work.action === 'publish';
      const handled = await (work.provider === 'twitch' ? reconcileTwitchProjection : reconcileGoogleProjection)(item, providers[work.provider], persist);
      updateTombstone();
      if (handled) {
        if (link.status === 'error') await fail(link.lastError ?? 'Projection Twitch incomplète.');
        else { delete state.providerWork[key]; await persist(); }
        continue;
      }
      // Cleanup completed a materialized-to-native transition. The native write
      // below still needs its durable intent and identity before work can be ACKed.
    }
    // A create may have succeeded just before the process died. Providers without
    // idempotency keys cannot safely be retried until the remote object is reconciled.
    if (work.status === 'running' && work.action === 'publish' && !link.remoteId) {
      work.uncertain = true;
      await fail('Création distante incertaine après interruption. Réconciliez le provider avant de republier.');
      continue;
    }
    if (work.action === 'publish' && work.provider === 'google') {
      try { googleRecurrence(item); } catch (error) { await fail((error as Error).message); continue; }
    }
    if (work.action === 'publish' && work.provider === 'twitch') {
      try { assertTwitchRecurrence(item); } catch (error) { await fail((error as Error).message); continue; }
    }
    if (work.action === 'delete' && work.provider === 'twitch' && item.twitchRecurring) {
      await fail('Suppression explicite de la série Twitch récurrente requise.');
      continue;
    }
    if ((work.action !== 'delete' && link.deletedRemotely) || link.status === 'conflict' || item.conflict?.provider === work.provider) {
      await fail('Conflit ou suppression distante : une résolution explicite est requise.');
      continue;
    }
    const provider = providers[work.provider];
    if (!provider) { await fail(work.provider + ' non connecté. Réessayez ce provider après connexion.'); continue; }
    work.uncertain = work.action === 'publish' && !link.remoteId;
    work.status = 'running'; link.status = 'pending';
    await persist();
    try {
      if (work.action === 'delete') {
        if (link.remoteId) await provider.delete(link.remoteId, item, link.remoteRevision);
        delete link.remoteId; delete link.remoteRevision;
        if (work.provider === 'twitch') { delete item.twitchSegmentId; item.twitchRecurring = false; }
        link.status = 'not-published';
      } else if (link.remoteId) {
        const result = await provider.update(link.remoteId, item, link.remoteRevision);
        delete link.uncertainCreate;
        if (result.revision !== undefined) link.remoteRevision = result.revision;
        if (work.provider === 'twitch') link.fingerprint = result.fingerprint;
        link.status = 'synced';
      } else {
        const result = await createWithDurableIntent(item, work.provider, persist, request => provider.create(request), provider.prepareCreate);
        link.remoteId = result.id; link.remoteRevision = result.revision;
        link.calendarId = result.calendarId ?? link.calendarId;
        if (work.provider === 'twitch') { link.projectionMode = 'native'; link.projectionOwned = result.owned !== false; item.twitchSegmentId = result.id; link.fingerprint = result.fingerprint; item.twitchRecurring = Boolean(item.recurrence) || item.twitchRecurring === true; }
        link.status = 'synced';
      }
      work.uncertain = false;
      if (work.action === 'publish') link.publishedContent = publicationContent(item, work.provider);
      link.lastSyncedAt = new Date().toISOString(); delete link.lastError;
      updateTombstone();
      delete state.providerWork[key];
      await persist();
    } catch (error) {
      if (work.action === 'publish' && !link.remoteId && isDefinitiveCreateFailure(error)) work.uncertain = false;
      await fail(error instanceof Error ? error.message : String(error));
      const failure = error as { code?: string; remote?: NonNullable<CalendarItem['conflict']>['remote']; fingerprint?: string; status?: number };
      if (failure.code === 'DELETED_REMOTELY' || failure.status === 404 || failure.status === 410) link.deletedRemotely = true;
      if (failure.code === 'CONFLICT' || failure.status === 412) {
        link.status = 'conflict';
        if (failure.fingerprint) link.fingerprint = failure.fingerprint;
        item.conflict = { provider: work.provider, detectedAt: new Date().toISOString(), remote: failure.remote };
      }
      updateTombstone();
      await persist();
    }
  }
}

/** Resolve a deletion without losing its journal or requiring a live planning row.
 * 'local' refreshes the precondition and arms a targeted retry; 'remote' restores
 * the remote event and cancels this provider's deletion. No write uses a stale ETag.
 */
export async function resolveCompanionDeletion(
  planning: CalendarItem[], state: CompanionState, id: string, provider: 'twitch' | 'google',
  strategy: 'local' | 'remote', adapters: Partial<Record<'twitch' | 'google', PlanningProvider>>, occurrenceKey?: string,
) {
  const key = id + ':' + provider;
  const work = state.providerWork[key];
  const tombstone = state.tombstones[id];
  if (!work || work.action !== 'delete' || !tombstone) throw new Error('Suppression distante introuvable.');
  const item = structuredClone(work.item);
  item.providers = { ...item.providers, ...(tombstone.providerLinks as CalendarItem['providers']) };
  const link = item.providers[provider];
  if (provider === 'google' && occurrenceKey && link?.projections?.[occurrenceKey]) {
    // Older tombstones predate the per-occurrence marker; the delete work is authoritative.
    link.projections[occurrenceKey].pendingDeletion = true;
    await resolveGoogleOccurrenceConflict(item, occurrenceKey, strategy, adapters.google, async () => {}, restored => planning.push(restored));
    state.providerWork[key] = { item, provider, action: 'delete', status: 'queued' };
    tombstone.item = structuredClone(item); tombstone.providerLinks = structuredClone(item.providers);
    state.serverRevision++;
    return;
  }
  if (!link?.remoteId) throw new Error('Identité distante introuvable.');
  const adapter = adapters[provider];
  if (!adapter?.read) throw new Error(provider + ' non connecté. Reconnectez-le pour résoudre la suppression.');
  let latest: Awaited<ReturnType<NonNullable<PlanningProvider['read']>>>;
  try { latest = await adapter.read(link.remoteId, item); }
  catch (error) {
    if ([404, 410].includes((error as { status?: number }).status ?? 0)) latest = { deleted: true };
    else throw error;
  }
  if (latest.deleted && strategy === 'remote') throw new Error('Événement déjà supprimé à distance. Confirmez la suppression locale.');
  if (latest.revision !== undefined) link.remoteRevision = latest.revision;
  if (latest.fingerprint !== undefined) link.fingerprint = latest.fingerprint;
  delete item.conflict; delete link.lastError; delete link.deletedRemotely;
  if (strategy === 'local') {
    link.status = 'pending';
    state.providerWork[key] = { item, provider, action: 'delete', status: 'queued' };
    tombstone.item = structuredClone(item);
    tombstone.providerLinks = structuredClone(item.providers);
  } else {
    if (!latest.remote) throw new Error('Version distante indisponible.');
    Object.assign(item, latest.remote);
    link.status = 'synced';
    link.lastSyncedAt = new Date().toISOString();
    item.desiredPublication = { twitch: false, google: false, ...item.desiredPublication, local: true, [provider]: true,
      ...Object.fromEntries(Object.values(state.providerWork)
        .filter(value => value.item.id === id && value.provider !== provider && value.action === 'delete')
        .map(value => [value.provider, false])) };
    link.publishedContent = publicationContent(item, provider);
    planning.push(item);
    delete state.tombstones[id];
    delete state.providerWork[key];
    state.eventRevisions[id] = (state.eventRevisions[id] ?? tombstone.revision) + 1;
    state.eventHistory[id] = structuredClone(item) as unknown as Record<string, unknown>;
  }
  state.serverRevision++;
}
