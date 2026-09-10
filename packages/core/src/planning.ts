import type { CalendarItem, ProviderLink } from '../../contracts/src/index.js';

export type ProviderName = 'twitch' | 'google';
export interface PlanningProvider {
  create(item: CalendarItem): Promise<{ id: string; revision?: string; calendarId?: string }>;
  update(id: string, item: CalendarItem, revision?: string): Promise<{ revision?: string }>;
  delete(id: string, item: CalendarItem, revision?: string): Promise<void>;
}

/** Provider failures are deliberately isolated: local durable intent is never discarded silently. */
export class PlanningOrchestrator {
  private queue: Promise<void> = Promise.resolve();
  constructor(private items: CalendarItem[], private providers: Partial<Record<ProviderName, PlanningProvider>>, private persist: (items: CalendarItem[]) => Promise<void>) {}
  all() { return structuredClone(this.items); }
  create(input: Omit<CalendarItem, 'id'> & { id?: string }) {
    return this.serial(async () => {
      const id = input.id ?? crypto.randomUUID();
      const item: CalendarItem = { ...input, id, localId: input.localId ?? id, ownership: 'LOCAL', editable: true, providers: input.providers ?? {} };
      this.items.push(item);
      await this.persist(this.items);
      await this.publish(item);
      return structuredClone(item);
    });
  }
  update(id: string, changes: Pick<CalendarItem, 'title' | 'description' | 'startAtUtc' | 'endAtUtc' | 'twitchCategoryId' | 'twitchCategoryName'>) {
    return this.serial(async () => {
      const item = this.required(id);
      Object.assign(item, changes);
      delete item.conflict;
      for (const name of ['twitch', 'google'] as const) {
        const link = item.providers?.[name];
        if (!link?.remoteId || link.deletedRemotely) continue;
        link.status = 'pending';
        await this.persist(this.items);
        await this.attempt(item, name, async provider => {
          const result = await provider.update(link.remoteId!, item, link.remoteRevision);
          link.remoteRevision = result.revision;
        });
      }
      return structuredClone(item);
    });
  }
  remove(id: string, destinations: { local?: boolean; twitch?: boolean; google?: boolean; confirmRecurring?: boolean }) {
    return this.serial(async () => {
      const item = this.required(id);
      const failed: ProviderName[] = [];
      for (const name of ['twitch', 'google'] as const) {
        if (!destinations[name]) continue;
        const link = item.providers?.[name];
        const remoteId = link?.remoteId ?? (name === 'twitch' ? item.twitchSegmentId : undefined);
        if (!remoteId) continue;
        if (name === 'twitch' && item.twitchRecurring && !destinations.confirmRecurring) throw new Error('Suppression explicite de la série Twitch récurrente requise.');
        if (!link) {
          item.providers ??= {};
          item.providers[name] = { status: 'pending', remoteId };
        }
        const providerLink = item.providers![name]!;
        const ok = await this.attempt(item, name, provider => provider.delete(remoteId, item, providerLink.remoteRevision));
        if (ok) {
          providerLink.status = 'not-published';
          providerLink.deletedRemotely = false;
          delete providerLink.remoteId;
          delete providerLink.remoteRevision;
          if (name === 'twitch') delete item.twitchSegmentId;
        } else failed.push(name);
      }
      if (failed.length && destinations.local) {
        await this.persist(this.items);
        throw new Error(`Suppression distante incomplète (${failed.join(', ')}). L’événement local est conservé pour permettre un retry.`);
      }
      if (destinations.local) this.items = this.items.filter(x => x.id !== id);
      await this.persist(this.items);
      return this.all();
    });
  }
  retry(id: string, provider: ProviderName) { return this.serial(async () => { const item = this.required(id); await this.publishOne(item, provider, true); return structuredClone(item); }); }
  markRemoteDeleted(id: string, provider: ProviderName) {
    return this.serial(async () => {
      const item = this.required(id); item.providers ??= {};
      const link = item.providers[provider] ??= { status: 'error' };
      link.deletedRemotely = true; link.status = 'error'; link.lastError = 'Événement supprimé à distance — action utilisateur requise.';
      await this.persist(this.items); return structuredClone(item);
    });
  }
  markConflict(id: string, provider: ProviderName, remote: NonNullable<CalendarItem['conflict']>['remote']) {
    return this.serial(async () => {
      const item = this.required(id); item.conflict = { provider, detectedAt: new Date().toISOString(), remote };
      item.providers ??= {}; const link = item.providers[provider] ??= { status: 'conflict' }; link.status = 'conflict'; link.lastError = 'Conflit avec une modification distante.';
      await this.persist(this.items); return structuredClone(item);
    });
  }
  private async publish(item: CalendarItem) { for (const name of ['twitch', 'google'] as const) await this.publishOne(item, name); }
  private async publishOne(item: CalendarItem, name: ProviderName, explicitRetry = false) {
    const desired = item.desiredPublication?.[name] ?? false;
    item.providers ??= {};
    const link = item.providers[name] ??= { status: desired ? 'pending' : 'not-published' };
    if (!desired) { link.status = 'not-published'; return; }
    if (link.deletedRemotely && !explicitRetry) return;
    if (explicitRetry) link.deletedRemotely = false;
    link.status = 'pending';
    await this.persist(this.items);
    await this.attempt(item, name, async provider => {
      if (link.remoteId) {
        const result = await provider.update(link.remoteId, item, link.remoteRevision);
        link.remoteRevision = result.revision;
      } else {
        const result = await provider.create(item);
        link.remoteId = result.id; link.remoteRevision = result.revision; link.calendarId = result.calendarId;
        if (name === 'twitch') item.twitchSegmentId = result.id;
      }
    });
  }
  private async attempt(item: CalendarItem, name: ProviderName, operation: (provider: PlanningProvider) => Promise<void>): Promise<boolean> {
    const link = item.providers![name] as ProviderLink, provider = this.providers[name];
    if (!provider) { link.status = 'error'; link.lastError = `${name} non connecté.`; await this.persist(this.items); return false; }
    try {
      await operation(provider);
      link.status = 'synced'; link.lastSyncedAt = new Date().toISOString(); link.deletedRemotely = false; delete link.lastError;
      await this.persist(this.items); return true;
    } catch (error) {
      link.status = 'error'; link.lastError = error instanceof Error ? error.message : String(error);
      await this.persist(this.items); return false;
    }
  }
  private required(id: string) { const item = this.items.find(x => x.id === id); if (!item) throw new Error('Événement introuvable.'); return item; }
  private serial<T>(fn: () => Promise<T>) { const result = this.queue.then(fn); this.queue = result.then(() => undefined, () => undefined); return result; }
}
