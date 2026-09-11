import type { CalendarItem, ProviderLink } from '../../contracts/src/index.js';

export type ProviderName = 'twitch' | 'google';
export interface PlanningProvider {
  create(item: CalendarItem): Promise<{ id: string; revision?: string; calendarId?: string }>;
  update(id: string, item: CalendarItem, revision?: string): Promise<{ revision?: string }>;
  delete(id: string, item: CalendarItem, revision?: string): Promise<void>;
}

export interface PlanningUpdateOptions {
  desiredPublication?: Partial<NonNullable<CalendarItem['desiredPublication']>>;
  confirmRecurring?: boolean;
}

/**
 * Coordinates durable local intent with independent remote providers.
 *
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
    changes: Pick<CalendarItem, 'title' | 'description' | 'startAtUtc' | 'endAtUtc' | 'allDay' | 'twitchCategoryId' | 'twitchCategoryName'>,
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
        if (!remoteId) continue;
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
      const desired = item.desiredPublication?.[provider] ?? false;
      if (item.conflict?.provider === provider && desired) {
        throw new Error(`Conflit ${provider} non résolu — choisissez d’abord la version locale ou distante.`);
      }
      if (!desired && this.remoteId(item, provider)) {
        if (provider === 'twitch' && item.twitchRecurring && !options.confirmRecurring) {
          throw new Error('Suppression explicite de la série Twitch récurrente requise.');
        }
        if (!await this.unpublishOne(item, provider)) {
          throw new Error(item.providers?.[provider]?.lastError ?? `Impossible de retirer la publication ${provider}.`);
        }
      } else {
        await this.publishOne(item, provider, true);
        if (item.providers?.[provider]?.status !== 'synced') {
          throw new Error(item.providers?.[provider]?.lastError ?? `Impossible de republier sur ${provider}.`);
        }
      }
      return structuredClone(item);
    });
  }

  resolveConflict(id: string, provider: ProviderName, strategy: 'local' | 'remote') {
    return this.serial(async () => {
      const item = this.required(id);
      const conflict = item.conflict;
      if (!conflict || conflict.provider !== provider) throw new Error(`Aucun conflit ${provider} à résoudre.`);
      item.providers ??= {};
      const link = item.providers[provider] ??= { status: 'conflict' };

      if (strategy === 'remote') {
        if (!conflict.remote) throw new Error('Version distante indisponible pour résoudre ce conflit.');
        Object.assign(item, conflict.remote);
        delete item.conflict;
        link.status = 'synced';
        link.deletedRemotely = false;
        link.lastSyncedAt = new Date().toISOString();
        delete link.lastError;
        await this.persist(this.items);
        return structuredClone(item);
      }

      // The user explicitly chose the local version. Removing the stale revision is
      // intentional: optimistic concurrency must no longer reject that explicit choice.
      delete item.conflict;
      delete link.remoteRevision;
      link.deletedRemotely = false;
      link.status = 'pending';
      await this.persist(this.items);
      await this.publishOne(item, provider, true);
      if (link.status !== 'synced') throw new Error(link.lastError ?? `Impossible d’appliquer la version locale sur ${provider}.`);
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
      const remoteId = this.remoteId(item, name);

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
        await this.publishOne(item, name, true);
        continue;
      }
      if (updateLinked) await this.publishOne(item, name, false, true);
    }
  }

  private async publishOne(item: CalendarItem, name: ProviderName, explicitRetry = false, forceUpdate = false) {
    const desired = item.desiredPublication?.[name] ?? false;
    item.providers ??= {};
    const link = item.providers[name] ??= { status: desired ? 'pending' : 'not-published' };

    if (!desired) {
      if (!this.remoteId(item, name)) link.status = 'not-published';
      return;
    }
    if (link.deletedRemotely && !explicitRetry) return;
    if (explicitRetry && link.deletedRemotely) {
      this.clearRemoteIdentity(item, name);
      link.deletedRemotely = false;
    }

    link.status = 'pending';
    await this.persist(this.items);
    await this.attempt(item, name, async provider => {
      const remoteId = this.remoteId(item, name);
      if (remoteId && (forceUpdate || link.remoteId)) {
        const result = await provider.update(remoteId, item, link.remoteRevision);
        link.remoteRevision = result.revision;
      } else {
        const result = await provider.create(item);
        link.remoteId = result.id;
        link.remoteRevision = result.revision;
        link.calendarId = result.calendarId ?? link.calendarId;
        if (name === 'twitch') item.twitchSegmentId = result.id;
      }
    });
  }

  private async unpublishOne(item: CalendarItem, name: ProviderName) {
    const remoteId = this.remoteId(item, name);
    if (!remoteId) return true;
    const link = this.ensureLink(item, name, remoteId);
    link.status = 'pending';
    await this.persist(this.items);
    const ok = await this.attempt(item, name, provider => provider.delete(remoteId, item, link.remoteRevision));
    if (ok) {
      this.clearRemoteIdentity(item, name);
      link.status = 'not-published';
      link.deletedRemotely = false;
      delete link.lastError;
      if (item.conflict?.provider === name) delete item.conflict;
      await this.persist(this.items);
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
      await this.persist(this.items);
      return true;
    } catch (error) {
      link.status = 'error';
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
    if (name === 'twitch') delete item.twitchSegmentId;
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
