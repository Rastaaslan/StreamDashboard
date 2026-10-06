import { boundedMap } from './sync-performance.js';
import type { CalendarItem, ProviderLink } from '../../contracts/src/index.js';
import type { PlanningProvider, ProviderName } from './planning.js';

/** Recover the exact persisted request, not a subsequently edited series. */
async function recoverIdentity(identity: ProviderLink, name: ProviderName, provider: PlanningProvider | undefined, persist: () => Promise<void>) {
  if (!identity.uncertainCreate) return;
  if (!provider?.recoverCreation) throw new Error(`${name} : récupération en lecture seule indisponible. Reconnectez le provider puis réessayez la suppression.`);
  const original = structuredClone(identity.uncertainCreate.event) as unknown as CalendarItem;
  const recovered = await provider.recoverCreation({ ...original, providers: { [name]: identity } });
  if (!recovered.id || recovered.owned !== true) throw new Error(`${name} : ownership non établi. Vérifiez l’identité distante avant de réessayer.`);
  identity.remoteId = recovered.id;
  identity.remoteRevision = recovered.revision;
  identity.fingerprint = recovered.fingerprint;
  identity.calendarId = recovered.calendarId ?? identity.calendarId;
  identity.projectionOwned = true;
  identity.status = 'pending';
  // Preserve the CREATE incarnation for the later read/DELETE, including after restart.
  if ('event' in identity) identity.event = original;
  delete identity.uncertainCreate;
  delete identity.lastError;
  await persist();
}

/** Maintenance may recover identities while deleting, but must never publish. */
export async function recoverSeriesDeletionIdentities(item: CalendarItem, providers: Partial<Record<ProviderName, PlanningProvider>>, persist: () => Promise<void>) {
  for (const name of ['twitch', 'google'] as const) {
    const link = item.providers?.[name];
    if (!link) continue;
    let recovered = false;
    for (const identity of [link, ...Object.values(link.projections ?? {}).filter(entry => entry.managedBy === 'StreamDashboard' && entry.projectionOwned !== false)]) {
      if (!identity.uncertainCreate) continue;
      try { await recoverIdentity(identity, name, providers[name], persist); recovered = true; }
      catch (error) { identity.status = 'error'; identity.lastError = (error as Error).message; link.status = 'error'; link.lastError = `Suppression en attente : ${identity.lastError}`; await persist(); }
    }
    if (recovered && ![link, ...Object.values(link.projections ?? {})].some(identity => identity.uncertainCreate)) {
      link.status = 'error';
      link.lastError = 'Suppression en attente : identité retrouvée. Réessayez la suppression pour terminer le nettoyage distant.';
      await persist();
    }
  }
}

/** Drain only proven owned identities. Never CREATE to recover an uncertain write. */
export async function deleteSeriesProjections(item: CalendarItem, providers: Partial<Record<ProviderName, PlanningProvider>>, save: () => Promise<void>, retry = false) {
  let saves = Promise.resolve();
  let queued: Promise<void> | undefined;
  const persist = () => {
    if (!queued) { queued = saves.then(() => { queued = undefined; return save(); }); saves = queued; }
    return queued;
  };
  const failures: string[] = [];
  for (const name of ['twitch', 'google'] as const) {
    const link = item.providers?.[name];
    if (!link) continue;
    if (name === 'twitch' && link.projectionOwned && !link.remoteId) link.remoteId = item.twitchSegmentId;
    const remove = async (identity: ProviderLink, event: CalendarItem) => {
      if (identity.uncertainCreate) {
        const original = structuredClone(identity.uncertainCreate.event) as unknown as CalendarItem;
        await recoverIdentity(identity, name, providers[name], persist);
        event = { ...original, providers: { [name]: identity } };
      }
      if (!identity.remoteId) return;
      const provider = providers[name];
      if (!provider) throw new Error(`${name} non connecté.`);
      // A second explicit deletion/retry authorizes deleting the current remote
      // version, but still uses its current precondition and never a blind write.
      if (identity.status === 'conflict') {
        if (!retry) throw Object.assign(new Error('Conflit distant : réessayez explicitement la suppression pour confirmer le retrait courant.'), { status: 412 });
        if (!provider.read) throw new Error('Lecture distante requise pour confirmer la suppression en conflit.');
        const latest = await provider.read(identity.remoteId, event, { resolveConflict: true });
        if (latest.deleted) { delete identity.remoteId; delete identity.remoteRevision; await persist(); return; }
        if (name === 'google' && !latest.revision) throw new Error('ETag courant requis pour supprimer.');
        if (name === 'twitch' && !latest.fingerprint) throw new Error('Empreinte courante requise pour supprimer.');
        identity.remoteRevision = latest.revision;
        identity.fingerprint = latest.fingerprint;
      }
      identity.status = 'pending';
      try { await provider.delete(identity.remoteId, event, identity.remoteRevision); }
      catch (error) {
        const failure = error as { status?: number; code?: string };
        if (![404, 410].includes(failure.status ?? 0) && failure.code !== 'DELETED_REMOTELY') throw error;
      }
      delete identity.remoteId; delete identity.remoteRevision; delete identity.fingerprint;
      identity.status = 'not-published'; delete identity.lastError;
      await persist();
    };
    const attempt = async (identity: ProviderLink, event: CalendarItem) => {
      try { await remove(identity, event); return true; }
      catch (error) {
        const failure = error as { status?: number; code?: string };
        identity.status = identity.status === 'conflict' || failure.status === 412 || ['CONFLICT', 'GOOGLE_PROJECTION_CONFLICT'].includes(failure.code ?? '') ? 'conflict' : 'error';
        identity.lastError = (error as Error).message;
        failures.push(`${name}: ${identity.lastError}`);
        await persist(); return false;
      }
    };
    if (link.projectionOwned === true || link.uncertainCreate) {
      if (await attempt(link, { ...item, providers: { [name]: link } })) {
        if (name === 'twitch') delete item.twitchSegmentId;
      }
    }
    await boundedMap(Object.entries(link.projections ?? {}), async ([key, entry]) => {
      if (entry.managedBy !== 'StreamDashboard' || entry.projectionOwned === false) return;
      entry.pendingDeletion = true;
      const { recurrence, seriesId, occurrenceKey, providers: ignored, conflict, twitchSegmentId, ...body } = entry.event;
      const event = { ...body, twitchRecurring: false, providers: { [name]: entry } };
      if (await attempt(entry, event)) delete link.projections![key];
    });
    if (failures.some(value => value.startsWith(name + ':'))) {
      if (link.status !== 'conflict') link.status = 'error'; link.lastError = `Suppression de série en attente. Réessayez la suppression : ${failures.filter(value => value.startsWith(name + ':')).join('; ')}`;
    } else {
      delete item.providers![name];
      if (item.conflict?.provider === name) delete item.conflict;
    }
    await persist();
  }
  if (failures.length) throw new Error(`Suppression de série incomplète. Réessayez la suppression : ${failures.join('; ')}`);
}
