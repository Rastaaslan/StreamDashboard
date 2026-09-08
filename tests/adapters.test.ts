import { describe, expect, it, vi } from 'vitest';
import { DamPlannerClient, nextLive } from '../integrations/damplanner/src/client.js';
import { StreamToolClient } from '../integrations/streamtool/src/client.js';

const json = (value: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(value), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );

const makeFetcher = (value: unknown) =>
  vi.fn<typeof fetch>(async (_input, _init) => json(value));

describe('contrats réels', () => {
  it('consomme directement CalendarHub.load', async () => {
    const payload = { rows: [], warnings: [], fetchedAt: 1, fromCache: false, items: [] };
    const fetcher = makeFetcher(payload);

    expect(
      await new DamPlannerClient('http://127.0.0.1:47831', fetcher).calendar(true),
    ).toEqual(payload);

    expect(String(fetcher.mock.calls[0]![0])).toContain('/api/calendar?refresh=true');
  });

  it.each([
    ['intro', '/api/intro/start'],
    ['pause', '/api/pause/start'],
    ['resume', '/api/pause/return'],
    ['end', '/api/end/start'],
    ['cancel', '/api/sequence/cancel'],
  ] as const)('%s utilise la route réelle', async (action, route) => {
    const fetcher = makeFetcher({ mode: 'idle' });
    await new StreamToolClient('http://x', '', fetcher).action(action);
    expect(String(fetcher.mock.calls[0]![0])).toContain(route);
  });

  it('timer transmet seconds', async () => {
    const fetcher = makeFetcher({});
    await new StreamToolClient('http://x', '', fetcher).timer('add', 60);

    expect(fetcher.mock.calls[0]![1]).toMatchObject({
      method: 'POST',
      body: '{"seconds":60}',
    });
  });

  it('calcule et déduplique le prochain live par résultat calendrier', () => {
    const live = {
      id: '1',
      source: 'DAMPLANNER',
      ownership: 'LOCAL',
      title: 'A',
      startAtUtc: '2030-01-01',
      endAtUtc: '2030-01-02',
      editable: true,
      kind: 'LIVE',
    } as const;

    expect(nextLive([live, live], 0)?.id).toBe('1');
  });
});
