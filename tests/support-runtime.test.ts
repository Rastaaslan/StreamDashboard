import { describe, expect, it, vi } from 'vitest';
import { SupportRuntime } from '../apps/server/src/support-runtime.js';
import { StreamlabsAdapter, normalizeStreamlabsTip } from '../integrations/streamlabs/src/adapter.js';

const support = (externalId: string, receivedAt: string, amountMinor = 500) => ({ id: `streamlabs:${externalId}`, provider: 'streamlabs', externalId, displayName: 'User', amountMinor, currency: 'EUR', message: 'GG', receivedAt });
describe('Support runtime', () => {
  it('persiste, déduplique et agrège session/jour/mois en unités mineures', async () => { const persist = vi.fn(async () => undefined), publish = vi.fn(); const runtime = new SupportRuntime([], persist, publish); expect((await runtime.record(support('ABC', '2026-09-17T10:00:00Z'))).inserted).toBe(true); expect((await runtime.record(support('ABC', '2026-09-17T10:00:00Z'))).inserted).toBe(false); await runtime.record(support('OLD', '2026-08-01T10:00:00Z', 1_000)); expect(runtime.snapshot('2026-09-17T09:00:00Z', new Date('2026-09-17T12:00:00Z')).totals).toMatchObject({ session: { EUR: 500 }, day: { EUR: 500 }, month: { EUR: 500 }, all: { EUR: 1500 } }); expect(persist).toHaveBeenCalledTimes(2); expect(publish).toHaveBeenCalledTimes(2); });
  it('refuse les floats et normalise un tip Streamlabs', () => { expect(normalizeStreamlabsTip({ id: 'one', amountMinor: 500, currency: 'eur', name: 'User' })).toMatchObject({ amountMinor: 500, currency: 'EUR' }); expect(() => normalizeStreamlabsTip({ id: 'bad', amountMinor: 5.5, currency: 'EUR' })).toThrow(); });
  it('reste NOT_CONFIGURED sans secret et ERROR sans transport au lieu de simuler', async () => { const adapter = new StreamlabsAdapter('', async () => undefined); await adapter.connect(); expect(adapter.state().status).toBe('NOT_CONFIGURED'); adapter.configure('secret-in-memory'); await adapter.connect(); expect(adapter.state()).toMatchObject({ status: 'ERROR', lastError: { code: 'STREAMLABS_TRANSPORT_UNAVAILABLE' } }); });
});
