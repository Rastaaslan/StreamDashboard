import { AsyncLocalStorage } from 'node:async_hooks';

type Provider = 'twitch' | 'google';
type Phase = 'total' | 'rolling' | 'read' | 'create' | 'update' | 'delete' | 'identity' | 'retry' | 'http' | 'reused' | 'session' | 'request-read' | 'request-create' | 'request-update' | 'request-delete';
// Fixed labels only: never retain URLs, IDs, titles, request bodies or errors.
const metrics = new Map<string, { count: number; milliseconds: number; failed: number }>();
export function syncDiagnostics() { return Object.fromEntries([...metrics].map(([key, value]) => [key, { ...value }])); }
export async function measureSync<T>(provider: Provider, phase: Phase, work: () => Promise<T>): Promise<T> {
  const start = performance.now();
  const metric = metrics.get(`${provider}.${phase}`) ?? { count: 0, milliseconds: 0, failed: 0 };
  metrics.set(`${provider}.${phase}`, metric); metric.count++;
  try { return await work(); }
  catch (error) { metric.failed++; throw error; }
  finally { metric.milliseconds += performance.now() - start; }
}
const batches = new AsyncLocalStorage<Map<object, Map<string, Promise<unknown>>>>();
export function syncBatch<T>(work: () => Promise<T>) { return batches.run(new Map(), work); }
/** Cache only inside one reconciliation, isolated by client, never across requests/accounts. */
export function batchRead<T>(owner: object, key: string, work: () => Promise<T>, provider?: Provider): Promise<T> {
  const batch = batches.getStore();
  if (!batch) return work();
  let cache = batch.get(owner);
  if (!cache) { cache = new Map(); batch.set(owner, cache); }
  const existing = cache.get(key);
  if (existing) return provider ? measureSync(provider, 'reused', () => existing as Promise<T>) : existing as Promise<T>;
  const result = work().catch(error => { cache!.delete(key); throw error; });
  cache.set(key, result);
  return result;
}
export async function boundedMap<T>(values: T[], work: (value: T) => Promise<void>, concurrency = 3) {
  let next = 0;
  // Drain every started worker before propagating a persistence failure.
  const outcomes = await Promise.allSettled(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (next < values.length) await work(values[next++]);
  }));
  const failed = outcomes.find(result => result.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
}

/** Shared per-client cooldown; never replay ambiguous mutations on 5xx/network errors. */
export class SyncHttp {
  private notBefore = 0;
  constructor(private provider: Provider) {}
  async request(work: () => Promise<Response>, method: string, signal: AbortSignal): Promise<Response> {
    let mutationNotStarted = true;
    try {
      for (let attempt = 0; ; attempt++) {
        while (this.notBefore > Date.now()) {
          await measureSync(this.provider, 'retry', () => new Promise<void>((resolve, reject) => {
            signal.throwIfAborted();
            const abort = () => { clearTimeout(timer); reject(signal.reason); };
            const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, Math.min(this.notBefore - Date.now(), 2_147_483_647));
            signal.addEventListener('abort', abort, { once: true });
          }));
        }
        signal.throwIfAborted();
        const phase = method === 'POST' ? 'request-create' : method === 'DELETE' ? 'request-delete' : method === 'PATCH' || method === 'PUT' ? 'request-update' : 'request-read';
        mutationNotStarted = false;
        const response = await measureSync(this.provider, phase, () => measureSync(this.provider, 'http', work));
        if (response.status === 429) mutationNotStarted = true;
        if (response.status === 429 || (method === 'GET' && response.status >= 500)) {
          const header = response.headers.get('retry-after');
          const seconds = header === null ? NaN : Number(header);
          const delay = Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : Math.max(0, Date.parse(header ?? '') - Date.now());
          this.notBefore = Math.max(this.notBefore, Date.now() + (Number.isFinite(delay) ? delay : 250 * 2 ** attempt));
          if (attempt < 2) { await response.body?.cancel(); continue; }
        }
        return response;
      }
    } catch (error) {
      if (mutationNotStarted && error instanceof Error) Object.assign(error, { mutationNotStarted: true });
      throw error;
    }
  }
}
