import { AtomicJsonStore } from './storage.js';
import { isStreamlabsActivityType, normalizeStreamlabsEvents, type StreamlabsEvent } from '../../../integrations/streamlabs/src/events.js';
import type { Support } from '../../../packages/core/src/live-control-domains.js';

export const STREAMLABS_HISTORY_LIMIT = 1_000;
export class StreamlabsFeed {
  private tail: Promise<void> = Promise.resolve();
  private constructor(private items: StreamlabsEvent[], private readonly store: AtomicJsonStore<{ items: StreamlabsEvent[] }>) {}
  static async open(file: string, legacy: Support[] = []) {
    const store = new AtomicJsonStore<{ items: StreamlabsEvent[] }>(file);
    const initial = legacy.filter(s => s.provider === 'streamlabs').flatMap(s => normalizeStreamlabsEvents({ type: 'donation', message: [{ _id: s.externalId, name: s.displayName, amount: s.amountMinor / 100, currency: s.currency, message: s.message, createdAt: s.receivedAt }] }, new Date(s.receivedAt)));
    const state = await store.read({ items: initial });
    if (!Array.isArray(state.items)) throw new Error('Historique Streamlabs invalide.');
    // Repair history written by older clients before applying retention: control
    // traffic must not evict genuine activity that is still present on disk.
    const feed = new StreamlabsFeed(state.items.filter(item => isStreamlabsActivityType(item?.type)).slice(-STREAMLABS_HISTORY_LIMIT), store);
    await store.write({ items: feed.items });
    return feed;
  }
  record(events: StreamlabsEvent[]) {
    const work = this.tail.then(async () => {
      const known = new Set(this.items.map(x => x.id));
      const additions = events.filter(x => { if (!isStreamlabsActivityType(x?.type) || known.has(x.id)) return false; known.add(x.id); return true; });
      if (!additions.length) return;
      const items = [...this.items, ...additions].slice(-STREAMLABS_HISTORY_LIMIT);
      await this.store.write({ items });
      this.items = items; // Only acknowledge data that reached disk.
    });
    this.tail = work.catch(() => undefined);
    return work;
  }
  list() { return structuredClone(this.items).reverse(); }
  async stop() { await this.tail; }
}
