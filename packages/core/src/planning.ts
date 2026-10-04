import { reconcileGoogleProjection, needsGoogleMaterialization, resolveGoogleOccurrenceConflict } from '../../../integrations/google-calendar/src/projection.js';
import { reconcileTwitchProjection, needsTwitchMaterialization, resolveTwitchOccurrenceConflict } from '../../../integrations/twitch/src/projection.js';
import { assertTwitchRecurrence } from '../../../integrations/twitch/src/recurrence.js';
import { googleRecurrence } from '../../../integrations/google-calendar/src/recurrence.js';
import { assertProviderCreationCertain, createWithDurableIntent } from './provider-identity.js';
import type { CalendarItem, ProviderLink } from '../../contracts/src/index.js';

export type ProviderName = 'twitch' | 'google';
export interface PlanningProvider {
  read?(id: string, item: CalendarItem): Promise<{ remote?: NonNullable<CalendarItem['conflict']>['remote']; revision?: string; fingerprint?: string; deleted?: boolean }>;
  create(item: CalendarItem): Promise<{ id: string; revision?: string; calendarId?: string; fingerprint?: string; owned?: boolean }>;
  update(id: string, item: CalendarItem, revision?: string): Promise<{ revision?: string; fingerprint?: string }>;
  delete(id: string, item: CalendarItem, revision?: string): Promise<void>;
}

function providerSupportsRecurrence(provider: ProviderName, item: CalendarItem) {
  if (provider === 'google') {
    try { googleRecurrence(item); return true; } catch { return false; }
  }
  try { assertTwitchRecurrence(item); return true; } catch { return false; }
}

export interface PlanningUpdateOptions {
  desiredPublication?: Partial<NonNullable<CalendarItem['desiredPublication']>>;
  confirmRecurring?: boolean;
}

/**
 * Coordinates durable local intent with independent remote providers.
 * Provider failures never discard the local item. `desiredPublication` records what
 * the user wants, while each ProviderLink records what actually happened remotely.
 */
export class PlanningOrchestrator {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private items: CalendarItem[],
    private providers: Partial<Record<ProviderName, PlanningProvider>>,
    private persist: (items: CalendarItem[]) => Promise<void>,
  ) {}

  refreshTwitch(now = Date.now()) {
    return this.serial(async () => {
      for (const item of this.items) {
        const transitioning = item.providers?.twitch?.projectionMode === 'materialized' && !needsTwitchMaterialization(item);
        const handled = await reconcileTwitchProjection(item, this.providers.twitch, () => this.persist(this.items), { now });
        if (!handled && transitioning && item.ownership === 'LOCAL' && item.desiredPublication?.twitch
          && !this.remoteId(item, 'twitch') && item.conflict?.provider !== 'twitch') {
          await this.publishOne(item, 'twitch');
        }
      }
      for (const item of this.items) {
        const transitioning = item.providers?.google?.projectionMode === 'materialized' && !needsGoogleMaterialization(item);
        const handled = await reconcileGoogleProjection(item, this.providers.google, () => this.persist(this.items), { now });
        if (!handled && transitioning && item.ownership === 'LOCAL' && item.desiredPublication?.google && !this.remoteId(item, 'google')) await this.publishOne(item, 'google');
      }
      return this.all();
    });
  }

  all() { return structuredClone(this.items); }

  create(input: Omit<CalendarItem, 'id'> & { id?: string }) {
    return this.serial(async () => {
      const id = input.id ?? crypto.randomUUID();
      const item: CalendarItem = {
        ...input,
        id,
        localId: input.localId ?? id,
        ownership: 'LOCAL',
        editable: true,
        desiredPublication: input.desiredPublication ?? { local: true, twitch: false, google: false },
        providers: input.providers ?? {},
      };
      this.items.push(item);
      await this.persist(this.items);
      await this.reconcileDesiredPublication(item);
      return structuredClone(item);
    });
  }

  update(
    id: string,
    changes: Pick<CalendarItem, 'title' | 'description' | 'startAtUtc' | 'endAtUtc' | 'allDay' | 'category' | 'kind' | 'twitchCategoryId' | 'twitchCategoryName' | 'tags' | 'tagPreferences'> & { recurrence?: CalendarItem['recurrence'] },
    options: PlanningUpdateOptions = {},
  ) {
    return this.serial(async () => {
      const item = this.required(id);
      Object.assign(item, changes);
      if (options.desiredPublication) {
        item.desiredPublication = {
          local: true,
          twitch: options.desiredPublication.twitch ?? item.desiredPublication?.twitch ?? false,
          google: options.desiredPublication.google ?? item.desiredPublication?.google ?? false,
        };
      }
      await this.persist(this.items);
      await this.reconcileDesiredPublication(item, options.confirmRecurring === true, true);
      return structuredClone(item);
    });
  }

  remove(id: string, destinations: { local?: boolean; twitch?: boolean; google?: boolean; confirmRecurring?: boolean }) {
    return this.serial(async () => {
      const item = this.required(id);
      const failed: ProviderName[] = [];

      for (const name of ['twitch', 'google'] as const) {
        if (!destinations[name]) continue;
        const remoteId = this.remoteId(item, name);
        if (!remoteId) {
          if (!await this.unpublishOne(item, name)) failed.push(name);
          continue;
        }
        if (name === 'twitch' && item.twitchRecurring && !destinations.confirmRecurring) {
          throw new Error('Suppression explicite de la série Twitch récurrente requise.');
        }
        if (!await this.unpublishOne(item, name)) failed.push(name);
      }

      if (failed.length && destinations.local) {
        await this.persist(this.items);
        throw new Error(`Suppression distante incomplète (${failed.join(', ')}). L’événement local est conservé pour permettre un retry.`);
      }
      if (destinations.local) this.items = this.items.filter(value => value.id !== id);
      await this.persist(this.items);
      return this.all();
    });
  }

  retry(id: string, provider: ProviderName, options: { confirmRecurring?: boolean } = {}) {
    return this.serial(async () => {
      const item = this.required(id);
      if (provider === 'twitch' && await reconcileTwitchProjection(item, this.providers.twitch, () => this.persist(this.items), { retry: true })) {
        if (item.providers?.twitch?.status === 'error') throw new Error(item.providers.twitch.lastError);
        return structuredClone(item);
      }
      if (provider === 'google' && await reconcileGoogleProjection(item, this.providers.google, () => this.persist(this.items), { retry: true })) {
        if (item.providers?.google?.status === 'error') throw new Error(item.providers.google.lastError);
        return structuredClone(item);
      }
      if (!this.remoteId(item, provider)) assertProviderCreationCertain(item, provider);
      const desired = item.desiredPublication?.[provider] ?? false;
      if (desired && !providerSupportsRecurrence(provider, item)) {
        item.providers ??= {}; const link = item.providers[provider] ??= { status: 'error' };
        link.status = 'error'; link.lastError = `La récurrence locale ne peut pas encore être représentée fidèlement sur ${provider}. L’événement local est conservé.`;
        await this.persist(this.items); throw new Error(link.lastError);
      }
      if (desired && (item.conflict?.provider === provider || item.providers?.[provider]?.status === 'conflict')) {
        throw new Error(`Conflit ${provider} non résolu — choisissez d’abord la version locale ou distante.`);
      }

      if (!desired) {
        const remoteId = this.remoteId(item, provider);
        if (!remoteId) {
          item.providers ??= {};
          const link = item.providers[provider] ??= { status: 'not-published' };
          link.status = 'not-published';
          link.deletedRemotely = false;
          delete link.lastError;
          await this.persist(this.items);
          return structuredClone(item);
        }
        if (provider === 'twitch' && item.twitchRecurring && !options.confirmRecurring) {
          throw new Error('Suppression explicite de la série Twitch récurrente requise.');
        }
        if (!await this.unpublishOne(item, provider)) {
          throw new Error(item.providers?.[provider]?.lastError ?? `Impossible de retirer la publication ${provider}.`);
        }
        return structuredClone(item);
      }

      await this.publishOne(item, provider, true);
      const currentLink = item.providers?.[provider];
      if (currentLink?.status !== 'synced') {
        throw new Error(currentLink?.lastError ?? `Impossible de republier sur ${provider}.`);
      }
      return structuredClone(item);
    });
  }

  resolveConflict(id: string, provider: ProviderName, strategy: 'local' | 'remote', occurrenceKey?: string) {
    return this.serial(async () => {
      const item = this.required(id);
      if (occurrenceKey !== undefined) {
        await (provider === 'twitch' ? resolveTwitchOccurrenceConflict : resolveGoogleOccurrenceConflict)(item, occurrenceKey, strategy, this.providers[provider], () => this.persist(this.items));
        return structuredClone(item);
      }
      // Android persists conflicts per provider. Its native snapshot is not a
      // Desktop CalendarItem: materialize a conflict and fetch the authoritative
      // remote body below instead of trusting or requiring that snapshot.
      const conflict = item.conflict?.provider === provider ? item.conflict
        : item.providers?.[provider]?.status === 'conflict' ? { provider, detectedAt: new Date().toISOString() } as NonNullable<CalendarItem['conflict']> : undefined;
      if (conflict) item.conflict = conflict;
      if (!conflict || conflict.provider !== provider) throw new Error(`Aucun conflit ${provider} à résoudre.`);
      item.providers ??= {};
      const link = item.providers[provider] ??= { status: 'conflict' };
      const remoteId = this.remoteId(item, provider);
      const remoteProvider = this.providers[provider];
      // A 412 may contain neither the current body nor its ETag. Read both at
      // resolution time, including after restart, before adopting or overwriting.
      if (remoteId && remoteProvider?.read) {
        try {
          const latest = await remoteProvider.read(remoteId, item);
          if (latest.deleted) {
            link.deletedRemotely = true;
            throw new Error('Événement supprimé à distance. Confirmez explicitement sa republication.');
          }
          if (!latest.remote) throw new Error('Version distante indisponible pour résoudre ce conflit.');
          conflict.remote = latest.remote;
          if (latest.revision !== undefined) link.remoteRevision = latest.revision;
          if (latest.fingerprint !== undefined) link.fingerprint = latest.fingerprint;
          await this.persist(this.items);
        } catch (error) {
          link.status = 'conflict';
          link.lastError = error instanceof Error ? error.message : String(error);
          await this.persist(this.items);
          throw error;
        }
      }

      if (strategy === 'remote') {
        if (!conflict.remote) throw new Error('Version distante indisponible pour résoudre ce conflit.');
        Object.assign(item, conflict.remote);
        delete link.uncertainCreate;
        delete item.conflict;
        link.status = 'synced';
        link.deletedRemotely = false;
        link.lastSyncedAt = new Date().toISOString();
        delete link.lastError;
        await this.persist(this.items);
        return structuredClone(item);
      }

      if (!remoteId) throw new Error(`Objet distant ${provider} introuvable pour appliquer la version locale.`);
      if (!remoteProvider) {
        link.status = 'conflict';
        link.lastError = `${provider} non connecté. Le conflit reste ouvert.`;
        await this.persist(this.items);
        throw new Error(link.lastError);
      }

      // Keep the latest remote revision/ETag and the conflict itself until the
      // provider confirms the write. This prevents a blind overwrite and ensures a
      // failed If-Match/update cannot make the UI believe the conflict was resolved.
      link.deletedRemotely = false;
      link.status = 'pending';
      await this.persist(this.items);
      try {
        const result = await remoteProvider.update(remoteId, item, link.remoteRevision);
        delete link.uncertainCreate;
        if (result.revision !== undefined) link.remoteRevision = result.revision;
        if (provider === 'twitch') link.fingerprint = result.fingerprint;
        link.status = 'synced';
        link.lastSyncedAt = new Date().toISOString();
        link.deletedRemotely = false;
        delete link.lastError;
        delete item.conflict;
        await this.persist(this.items);
      } catch (error) {
        link.status = 'conflict';
        link.lastError = error instanceof Error ? error.message : String(error);
        await this.persist(this.items);
        throw error;
      }
      return structuredClone(item);
    });
  }

  markRemoteDeleted(id: string, provider: ProviderName) {
    return this.serial(async () => {
      const item = this.required(id);
      item.providers ??= {};
      const link = item.providers[provider] ??= { status: 'error' };
      link.deletedRemotely = true;
      link.status = 'error';
      link.lastError = 'Événement supprimé à distance — action utilisateur requise.';
      await this.persist(this.items);
      return structuredClone(item);
    });
  }

  markConflict(id: string, provider: ProviderName, remote: NonNullable<CalendarItem['conflict']>['remote']) {
    return this.serial(async () => {
      const item = this.required(id);
      item.conflict = { provider, detectedAt: new Date().toISOString(), remote };
      item.providers ??= {};
      const link = item.providers[provider] ??= { status: 'conflict' };
      link.status = 'conflict';
      link.lastError = 'Conflit avec une modification distante.';
      await this.persist(this.items);
      return structuredClone(item);
    });
  }

  private async reconcileDesiredPublication(item: CalendarItem, confirmRecurring = false, updateLinked = false) {
    for (const name of ['twitch', 'google'] as const) {
      const desired = item.desiredPublication?.[name] ?? false;
      if (name === 'twitch' && await reconcileTwitchProjection(item, this.providers.twitch, () => this.persist(this.items))) continue;
      if (name === 'google' && await reconcileGoogleProjection(item, this.providers.google, () => this.persist(this.items))) continue;
      const remoteId = this.remoteId(item, name);

      if (!remoteId && item.providers?.[name]?.uncertainCreate) {
        const link = item.providers[name]!;
        link.status = 'error';
        link.lastError = 'Création distante incertaine. Réconciliez son identité avant de republier.';
        await this.persist(this.items);
        continue;
      }
      // Reject unsupported recurrence before creating an intent or mutating a provider.
      if (desired && !providerSupportsRecurrence(name, item)) {
        item.providers ??= {};
        const link = item.providers[name] ??= { status: 'error' };
        link.status = 'error';
        link.lastError = `La récurrence locale ne peut pas encore être représentée fidèlement sur ${name}. L’événement local est conservé.`;
        await this.persist(this.items);
        continue;
      }

      if (!desired) {
        if (!remoteId) {
          item.providers ??= {};
          const link = item.providers[name] ??= { status: 'not-published' };
          link.status = 'not-published';
          link.deletedRemotely = false;
          delete link.lastError;
          await this.persist(this.items);
          continue;
        }
        if (name === 'twitch' && item.twitchRecurring && !confirmRecurring) {
          const link = this.ensureLink(item, name, remoteId);
          link.status = 'error';
          link.lastError = 'Cette publication Twitch appartient à une série récurrente. Confirmation requise pour la retirer.';
          await this.persist(this.items);
          continue;
        }
        await this.unpublishOne(item, name);
        continue;
      }

      const link = item.providers?.[name];
      if (item.conflict?.provider === name) {
        if (link) {
          link.status = 'conflict';
          link.lastError = 'Conflit distant non résolu — choisissez la version à conserver.';
          await this.persist(this.items);
        }
        continue;
      }

      if (!remoteId) {
        // Ordinary Twitch edits must preserve the remote-deletion guard.
        // Only retry() may explicitly authorize recreating a deleted segment.
        await this.publishOne(item, name, name !== 'twitch');
        continue;
      }
      if (updateLinked) await this.publishOne(item, name);
    }
  }

  private async publishOne(item: CalendarItem, name: ProviderName, explicitRetry = false) {
    const desired = item.desiredPublication?.[name] ?? false;
    item.providers ??= {};
    const existingRemoteId = this.remoteId(item, name);
    const link = item.providers[name] ??= { status: desired ? 'pending' : 'not-published' };
    if (existingRemoteId && !link.remoteId) link.remoteId = existingRemoteId;

    if (!desired) {
      if (!existingRemoteId) link.status = 'not-published';
      return;
    }
    if (link.deletedRemotely && !explicitRetry) return;

    if (!this.remoteId(item, name)) {
      try { assertProviderCreationCertain(item, name); }
      catch (error) {
        link.status = 'error';
        link.lastError = (error as Error).message;
        await this.persist(this.items);
        return;
      }
    }
    link.status = 'pending';
    // This retry passed the current guards. Do not expose a previous rejection
    // (including the old weekly Twitch gate) while the provider is in flight.
    if (explicitRetry) delete link.lastError;
    await this.persist(this.items);
    await this.attempt(item, name, async remoteProvider => {
      if (explicitRetry && link.deletedRemotely) {
        const previousId = this.remoteId(item, name);
        // A failed request can leave a stale deletion marker. Verify the linked
        // object before discarding its identity; otherwise retry can duplicate it
        // or adopt old content as a successful publication. Keep the original
        // ETag/fingerprint so a concurrent edit still requires conflict resolution.
        const remote = previousId && remoteProvider.read ? await remoteProvider.read(previousId, item) : undefined;
        if (!remote || remote.deleted) this.clearRemoteIdentity(item, name);
        link.deletedRemotely = false;
        await this.persist(this.items);
      }
      const remoteId = this.remoteId(item, name);
      if (remoteId) {
        const result = await remoteProvider.update(remoteId, item, link.remoteRevision);
        delete link.uncertainCreate;
        if (result.revision !== undefined) link.remoteRevision = result.revision;
        if (name === 'twitch') link.fingerprint = result.fingerprint;
      } else {
        const result = await createWithDurableIntent(item, name, () => this.persist(this.items), request => remoteProvider.create(request));
        link.projectionOwned = result.owned !== false;
        link.projectionMode = 'native';
        link.remoteId = result.id;
        if (result.revision !== undefined) link.remoteRevision = result.revision;
        if (name === 'twitch') link.fingerprint = result.fingerprint;
        link.calendarId = result.calendarId ?? link.calendarId;
        if (name === 'twitch') {
          link.projectionMode = 'native';
          link.projectionOwned = result.owned !== false;
          item.twitchSegmentId = result.id;
          item.twitchRecurring = item.recurrence ? item.recurrence.frequency === 'weekly' && item.recurrence.interval === 1 : item.twitchRecurring === true;
        }
      }
    });
  }

  private async unpublishOne(item: CalendarItem, name: ProviderName) {
    const remoteId = this.remoteId(item, name);
    if (name === 'twitch') {
      item.desiredPublication ??= { local: true, twitch: false, google: false };
      item.desiredPublication.twitch = false;
      // Withdrawal is durable even when reconciliation already cleared the identity.
      await this.persist(this.items);
    }
    if (name === 'twitch' && (!remoteId || item.providers?.twitch?.projectionOwned) && (needsTwitchMaterialization(item) || item.providers?.twitch?.projections)) {
      await reconcileTwitchProjection(item, this.providers.twitch, () => this.persist(this.items));
      return item.providers?.twitch?.status !== 'error';
    }
    if (name === 'google' && item.providers?.google?.projections) {
      item.desiredPublication ??= { local: true, twitch: false, google: false };
      item.desiredPublication.google = false;
      await this.persist(this.items);
      await reconcileGoogleProjection(item, this.providers.google, () => this.persist(this.items));
      return item.providers.google.status !== 'error';
    }
    if (!remoteId) {
      if (name === 'twitch') { assertProviderCreationCertain(item, name); item.twitchRecurring = false; }
      return true;
    }
    const link = this.ensureLink(item, name, remoteId);
    link.status = 'pending';
    await this.persist(this.items);
    const ok = await this.attempt(item, name, remoteProvider => remoteProvider.delete(remoteId, item, link.remoteRevision));
    if (ok) {
      delete link.deletionPeriod;
      if (name === 'twitch') item.twitchRecurring = false;
      this.clearRemoteIdentity(item, name);
      link.status = 'not-published';
      link.deletedRemotely = false;
      delete link.lastError;
      if (item.conflict?.provider === name) delete item.conflict;
      await this.persist(this.items);
      if (name === 'twitch' && item.providers?.twitch?.projections) {
        await reconcileTwitchProjection(item, this.providers.twitch, () => this.persist(this.items));
        return item.providers.twitch.status !== 'error';
      }
    }
    return ok;
  }

  private async attempt(item: CalendarItem, name: ProviderName, operation: (provider: PlanningProvider) => Promise<void>): Promise<boolean> {
    const link = item.providers![name] as ProviderLink;
    const provider = this.providers[name];
    if (!provider) {
      link.status = 'error';
      link.lastError = `${name} non connecté.`;
      await this.persist(this.items);
      return false;
    }
    try {
      await operation(provider);
      link.status = 'synced';
      link.lastSyncedAt = new Date().toISOString();
      link.deletedRemotely = false;
      delete link.lastError;
      if (name === 'twitch') delete item.syncError;
      await this.persist(this.items);
      return true;
    } catch (error) {
      const failure = error as { code?: string; status?: number; fingerprint?: string; remote?: NonNullable<CalendarItem['conflict']>['remote'] };
      link.status = failure.code === 'CONFLICT' || failure.status === 412 ? 'conflict' : 'error';
      if (link.status === 'conflict') {
        item.conflict = { provider: name, detectedAt: new Date().toISOString(), remote: failure.remote };
        if (failure.fingerprint) link.fingerprint = failure.fingerprint;
      }
      if ((failure.code === 'DELETED_REMOTELY' || failure.status === 404 || failure.status === 410) && (name !== 'twitch' || this.remoteId(item, name))) link.deletedRemotely = true;
      link.lastError = error instanceof Error ? error.message : String(error);
      await this.persist(this.items);
      return false;
    }
  }

  private remoteId(item: CalendarItem, name: ProviderName) {
    return item.providers?.[name]?.remoteId ?? (name === 'twitch' ? item.twitchSegmentId : undefined);
  }

  private ensureLink(item: CalendarItem, name: ProviderName, remoteId?: string) {
    item.providers ??= {};
    const link = item.providers[name] ??= { status: remoteId ? 'synced' : 'not-published' };
    if (remoteId && !link.remoteId) link.remoteId = remoteId;
    return link;
  }

  private clearRemoteIdentity(item: CalendarItem, name: ProviderName) {
    const link = item.providers?.[name];
    if (link) {
      delete link.remoteId;
      delete link.remoteRevision;
    }
    if (name === 'twitch') { delete item.twitchSegmentId; delete link?.fingerprint; }
  }

  private required(id: string) {
    const item = this.items.find(value => value.id === id);
    if (!item) throw new Error('Événement introuvable.');
    return item;
  }

  private serial<T>(fn: () => Promise<T>) {
    const result = this.queue.then(fn);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }
}
