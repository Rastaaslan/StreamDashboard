import type { CalendarItem, ProviderLink } from '../../contracts/src/index.js';
import type { PlanningProvider } from './planning.js';
import { expandRecurringItems } from './recurrence.js';
import { createWithDurableIntent } from './provider-identity.js';
export function projectionContent(item: CalendarItem) {
  return JSON.stringify([item.title, item.description, item.allDay, item.startAtUtc, item.endAtUtc, item.twitchCategoryId ?? '']);
}
function request(event: CalendarItem, link: ProviderLink, name: 'twitch' | 'google'): CalendarItem {
  // A projected occurrence is a provider one-off, with identity kept locally.
  const { recurrence, seriesId, occurrenceKey, providers, conflict, twitchSegmentId, ...body } = event;
  if (name === 'google' && body.projection?.mode === 'materialized') body.projection = { ...body.projection, creationId: link.creationId };
  return { ...body, twitchRecurring: false, providers: { [name]: link } };
}

/** Returns true when provider publication is fully handled by the projection path.
 * Persist each intent before I/O and each identity before the next occurrence.
 * An ambiguous CREATE remains blocked: Twitch has no idempotency key, so retrying
 * it blindly cannot guarantee both progress and absence of duplicates.
 */
export async function reconcileProviderProjection(
  item: CalendarItem, provider: PlanningProvider | undefined, persist: () => Promise<void>,
  options: { now?: number; retry?: boolean; explicitWithdrawal?: boolean; expand: typeof expandRecurringItems; name: 'twitch' | 'google'; materialized: boolean },
): Promise<boolean> {
  const { name, materialized } = options;
  if (name === 'google' && item.providers?.google?.nativeRetained && item.providers.google.remoteId && item.desiredPublication?.google) return true;
  if (!materialized && !item.providers?.[name]?.projections) return false;
  if (item.ownership !== 'LOCAL') return true;
  const link = (item.providers ??= {})[name] ??= { status: 'pending' };
  if (name === 'google' && options.explicitWithdrawal && item.desiredPublication?.google === false) {
    link.nativeWithdrawalRequested = true;
    await persist();
  }
  const entries = link.projections ??= {};
  const now = options.now ?? Date.now();
  const bounds = { from: new Date(now).toISOString(), to: new Date(now + 28 * 86400000).toISOString() };
  link.projectionWindow = bounds;
  const desired = item.desiredPublication?.[name] === true;
  const fail = (target: ProviderLink, error: unknown) => {
    const failure = error as { code?: string; status?: number };
    target.status = failure.code === 'CONFLICT' || failure.code === 'GOOGLE_PROJECTION_CONFLICT' || failure.status === 412 ? 'conflict' : 'error';
    target.lastError = error instanceof Error ? error.message : String(error);
    if (failure.code === 'GOOGLE_PROJECTION_RETIRED' || failure.code === 'DELETED_REMOTELY' || [404, 410].includes(failure.status ?? 0)) target.deletedRemotely = true;
  };
  if (link.uncertainCreate || (desired && link.deletedRemotely && !options.retry)) {
    fail(link, new Error(link.uncertainCreate
      ? 'Création native distante incertaine : réconciliez son identité avant de matérialiser.'
      : 'Série supprimée à distance — retry explicite requis.'));
    await persist(); return true;
  }
  const recover = async (entry: NonNullable<ProviderLink['projections']>[string]) => {
    if (!provider || !entry.uncertainCreate || name !== 'google' || entry.event.projection?.mode !== 'materialized') return;
    const original = request(entry.uncertainCreate.event as unknown as CalendarItem, { ...entry, uncertainCreate: undefined }, name);
    try {
      const recovered = await provider.create(original);
      entry.remoteId = recovered.id; entry.remoteRevision = recovered.revision; entry.calendarId = recovered.calendarId ?? entry.calendarId;
    } catch (error) {
      // A 409 followed by a confirmed tombstone settles this CREATE. Only an
      // explicit retry may authorize a new incarnation of this logical occurrence.
      if ((error as { code?: string }).code !== 'GOOGLE_PROJECTION_RETIRED') throw error;
      entry.deletedRemotely = true;
      delete entry.remoteId; delete entry.remoteRevision;
    }
    delete entry.uncertainCreate;
    await persist();
  };
  const expected = new Map<string, CalendarItem>();
  if (desired && materialized) {
    for (const occurrence of (options.expand ?? expandRecurringItems)([{ ...item, providers: undefined }], bounds)) {
      if (occurrence.occurrenceKey && expected.has(occurrence.occurrenceKey)) throw new Error('Duplicate projected occurrence identity');
      if (!occurrence.occurrenceKey) throw new Error('Le moteur doit fournir une occurrenceKey stable.');
      if (name === 'google' && link.projectionRetirements?.[occurrence.occurrenceKey]?.retained) continue;
      if (occurrence.desiredPublication?.[name] !== false && Date.parse(occurrence.endAtUtc) > now && Date.parse(occurrence.startAtUtc) < Date.parse(bounds.to)) {
        expected.set(occurrence.occurrenceKey, request(occurrence, { status: 'pending', projectionOwned: true, calendarId: link.calendarId }, name));
      }
    }
  }
  // Only a native identity created by this projection-aware publisher is eligible
  // for automatic replacement. Legacy/imported identities require manual removal.
  if (link.remoteId || (name === 'twitch' && item.twitchSegmentId)) {
    if (name === 'google' && link.status === 'conflict') return true;
    if ((!link.projectionOwned && !(name === 'google' && !desired && link.nativeWithdrawalRequested)) || !provider) {
      fail(link, new Error(`Retirez explicitement la publication ${name} existante avant de matérialiser cette série.`));
      await persist(); return true;
    }
    try {
      await provider.delete(link.remoteId ?? item.twitchSegmentId!, item, link.remoteRevision);
      delete link.remoteId; delete link.remoteRevision; delete link.fingerprint; delete link.nativeWithdrawalRequested;
      if (name === 'twitch') { delete item.twitchSegmentId; item.twitchRecurring = false; }
      await persist();
    } catch (error) { fail(link, error); await persist(); return true; }
  }
  for (const [key, entry] of Object.entries(entries)) {
    if ((expected.has(key) && !entry.pendingDeletion) || entry.managedBy !== 'StreamDashboard') continue;
    try {
      if (name === 'google') {
        entry.pendingDeletion = true;
        await persist();
        if (entry.status === 'conflict') continue;
      }
      await recover(entry);
      if (entry.uncertainCreate) throw new Error('Création distante incertaine : identité à réconcilier avant nettoyage.');
      if (entry.remoteId) {
        if (!provider) throw new Error(`${name} non connecté.`);
        try { await provider.delete(entry.remoteId, request(entry.event, entry, name), entry.remoteRevision); }
        catch (error) { if (![404, 410].includes((error as { status?: number }).status ?? 0) && (error as { code?: string }).code !== 'DELETED_REMOTELY') throw error; }
      }
      if (name === 'google') (link.projectionRetirements ??= {})[key] = { calendarId: entry.calendarId, creationId: crypto.randomUUID() };
      delete entries[key];
      expected.delete(key); // A confirmed withdrawal never republishes in the same pass.
    } catch (error) { fail(entry, error); }
    await persist();
  }
  for (const [key, event] of expected) {
    let entry = entries[key];
    if (entry && entry.managedBy !== 'StreamDashboard') continue;
    if (!entry) {
      const retired = name === 'google' ? link.projectionRetirements?.[key] : undefined;
      entry = entries[key] = { occurrenceKey: key, managedBy: 'StreamDashboard', event, status: 'pending', projectionOwned: true,
        calendarId: retired?.calendarId ?? link.calendarId, creationId: retired?.creationId };
      if (retired) delete link.projectionRetirements![key];
    }
    try {
      if (entry.pendingDeletion) continue;
      if (entry.status === 'conflict') continue; // Only an explicit local/remote resolution releases this guard.
      if (!provider) throw new Error(`${name} non connecté.`);
      await recover(entry);
      if (entry.uncertainCreate) throw new Error('Création distante incertaine. Réconciliez son identité avant de republier.');
      if (entry.remoteId && provider.read) {
        const remote = await provider.read(entry.remoteId, request(entry.event, entry, name));
        if (remote.deleted) entry.deletedRemotely = true;
        else if ((entry.fingerprint && remote.fingerprint && entry.fingerprint !== remote.fingerprint) || (name === 'google' && entry.remoteRevision && remote.revision && entry.remoteRevision !== remote.revision)) {
          throw Object.assign(new Error(`Occurrence modifiée à distance : conflit ${name}.`), { code: 'CONFLICT' });
        }
      }
      if (entry.deletedRemotely) {
        if (!options.retry) throw new Error('Occurrence supprimée à distance — retry explicite requis.');
        // Verify the previous identity before authorizing a replacement.
        if (entry.remoteId && !provider.read) throw new Error('Lecture distante requise avant republication.');
        const remote = entry.remoteId ? await provider.read!(entry.remoteId, request(entry.event, entry, name)) : undefined;
        if (!remote || remote.deleted) {
          delete entry.remoteId; delete entry.fingerprint; delete entry.remoteRevision;
          if (name === 'google') entry.creationId = crypto.randomUUID();
        }
        entry.deletedRemotely = false;
      }
      if (!entry.remoteId || entry.appliedContent !== projectionContent(event) || entry.status !== 'synced') {
        entry.status = 'pending';
        await persist();
        const body = request(event, entry, name);
        if (entry.remoteId) {
          const result = await provider.update(entry.remoteId, body, entry.remoteRevision);
          entry.fingerprint = result.fingerprint; entry.remoteRevision = result.revision;
        } else {
          const result = await createWithDurableIntent(body, name, persist, value => provider.create(value), provider.prepareCreate);
          entry.calendarId = result.calendarId ?? entry.calendarId; entry.remoteId = result.id; entry.fingerprint = result.fingerprint; entry.remoteRevision = result.revision;
        }
        entry.event = { ...event, projection: body.projection }; entry.appliedContent = projectionContent(event);
        entry.status = 'synced'; entry.lastSyncedAt = new Date(now).toISOString(); delete entry.lastError;
      } else {
        // Tags belong to live preflight, not provider schedule content. Refresh
        // the local occurrence snapshot without issuing an unrelated remote write.
        entry.event = { ...entry.event, tags: event.tags, tagPreferences: event.tagPreferences };
      }
    } catch (error) { fail(entry, error); }
    await persist();
  }
  summarizeProjection(item, name, now);
  await persist();
  if (!materialized && !Object.keys(entries).length) { delete link.projections; delete link.projectionWindow; return false; }
  return true;
}

export function summarizeProjection(item: CalendarItem, name: 'twitch' | 'google', now = Date.now()) {
  const link = item.providers![name]!;
  const desired = item.desiredPublication?.[name] === true;
  link.projectionMode = 'materialized';
  const failures = Object.values(link.projections ?? {}).filter(entry => entry.status === 'error' || entry.status === 'conflict');
  link.status = failures.length ? 'error' : Object.values(link.projections ?? {}).some(entry => entry.status === 'pending') ? 'pending' : desired ? 'synced' : 'not-published';
  if (failures.length) link.lastError = `${failures.length} occurrence(s) ${name} en erreur : ${failures[0].lastError}`;
  else { delete link.lastError; link.deletedRemotely = false; link.lastSyncedAt = new Date(now).toISOString(); }
}
