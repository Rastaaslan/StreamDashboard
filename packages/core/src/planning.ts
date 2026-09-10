import type { CalendarItem, ProviderLink } from '../../contracts/src/index.js';

export type ProviderName = 'twitch' | 'google';
export interface PlanningProvider {
  create(item: CalendarItem): Promise<{ id: string; revision?: string; calendarId?: string }>;
  update(id: string, item: CalendarItem, revision?: string): Promise<{ revision?: string }>;
  delete(id: string, item: CalendarItem): Promise<void>;
}

/** Provider failures are deliberately isolated: the durable local intent always wins. */
export class PlanningOrchestrator {
  private queue: Promise<void> = Promise.resolve();
  constructor(private items: CalendarItem[], private providers: Partial<Record<ProviderName, PlanningProvider>>, private persist: (items: CalendarItem[]) => Promise<void>) {}
  all() { return structuredClone(this.items); }
  create(input: Omit<CalendarItem, 'id'> & { id?: string }) { return this.serial(async () => { const id = input.id ?? crypto.randomUUID(); const item: CalendarItem = { ...input, id, localId: input.localId ?? id, ownership: 'LOCAL', editable: true, providers: input.providers ?? {} }; this.items.push(item); await this.persist(this.items); await this.publish(item); return structuredClone(item); }); }
  update(id: string, changes: Pick<CalendarItem, 'title' | 'description' | 'startAtUtc' | 'endAtUtc'>) { return this.serial(async () => { const item = this.required(id); Object.assign(item, changes); for (const name of ['twitch', 'google'] as const) { const link = item.providers?.[name]; if (!link?.remoteId || link.deletedRemotely) continue; link.status = 'pending'; await this.persist(this.items); await this.attempt(item, name, async provider => { const result = await provider.update(link.remoteId!, item, link.remoteRevision); link.remoteRevision = result.revision; }); } return structuredClone(item); }); }
  remove(id: string, destinations: { local?: boolean; twitch?: boolean; google?: boolean }) { return this.serial(async () => { const item = this.required(id); for (const name of ['twitch', 'google'] as const) { if (!destinations[name]) continue; const link = item.providers?.[name]; if (!link?.remoteId) continue; if (name === 'twitch' && item.twitchRecurring) throw new Error('Suppression explicite de la série Twitch récurrente requise.'); await this.attempt(item, name, provider => provider.delete(link.remoteId!, item)); if (link.status === 'synced') { link.status = 'not-published'; delete link.remoteId; } } if (destinations.local) this.items = this.items.filter(x => x.id !== id); await this.persist(this.items); return this.all(); }); }
  retry(id: string, provider: ProviderName) { return this.serial(async () => { const item = this.required(id); await this.publishOne(item, provider); return structuredClone(item); }); }
  markRemoteDeleted(id: string, provider: ProviderName) { return this.serial(async () => { const item = this.required(id), link = item.providers?.[provider]; if (link) { link.deletedRemotely = true; link.status = 'error'; link.lastError = 'Événement supprimé à distance — action utilisateur requise.'; } await this.persist(this.items); return structuredClone(item); }); }
  markConflict(id: string, provider: ProviderName, remote: NonNullable<CalendarItem['conflict']>['remote']) { return this.serial(async () => { const item = this.required(id); item.conflict = { provider, detectedAt: new Date().toISOString(), remote }; await this.persist(this.items); return structuredClone(item); }); }
  private async publish(item: CalendarItem) { for (const name of ['twitch', 'google'] as const) await this.publishOne(item, name); }
  private async publishOne(item: CalendarItem, name: ProviderName) { const desired = item.desiredPublication?.[name] ?? false; item.providers ??= {}; const link = item.providers[name] ??= { status: desired ? 'pending' : 'not-published' }; if (!desired || link.deletedRemotely) return; await this.attempt(item, name, async provider => { if (link.remoteId) { const result = await provider.update(link.remoteId, item, link.remoteRevision); link.remoteRevision = result.revision; } else { const result = await provider.create(item); link.remoteId = result.id; link.remoteRevision = result.revision; link.calendarId = result.calendarId; } }); }
  private async attempt(item: CalendarItem, name: ProviderName, operation: (provider: PlanningProvider) => Promise<void>) { const link = item.providers![name] as ProviderLink, provider = this.providers[name]; if (!provider) { link.status = 'error'; link.lastError = `${name} non connecté.`; await this.persist(this.items); return; } try { await operation(provider); link.status = 'synced'; link.lastSyncedAt = new Date().toISOString(); delete link.lastError; } catch (error) { link.status = 'error'; link.lastError = error instanceof Error ? error.message : String(error); } await this.persist(this.items); }
  private required(id: string) { const item = this.items.find(x => x.id === id); if (!item) throw new Error('Événement introuvable.'); return item; }
  private serial<T>(fn: () => Promise<T>) { const result = this.queue.then(fn); this.queue = result.then(() => undefined, () => undefined); return result; }
}
