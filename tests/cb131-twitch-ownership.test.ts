import { afterEach, expect, it, vi } from 'vitest';
import { TwitchClient } from '../integrations/twitch/src/client.js';
import { PlanningOrchestrator, type PlanningProvider } from '../packages/core/src/planning.js';
import type { CalendarItem } from '../packages/contracts/src/index.js';

afterEach(() => vi.useRealTimers());
it.each([false, true])('uncertain Twitch CREATE never delivered cannot own a later foreign match; materialized=%s', async materialized => {
  vi.useFakeTimers(); vi.setSystemTime('2030-01-01T00:00:00Z');
  const remote = new Map<string, any>();
  let lostRequest: any;
  let creates = 0;
  const deletes: string[] = [];
  const request: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/validate')) return Response.json({ client_id: 'client', user_id: '42', scopes: ['channel:manage:schedule'] });
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      const segment = { id: `owned-${++creates}`, title: body.title, start_time: body.start_time,
        end_time: new Date(Date.parse(body.start_time) + Number(body.duration) * 60000).toISOString(), is_recurring: body.is_recurring };
      if (!lostRequest) {
        lostRequest = segment;
        // The application cannot distinguish this failure from a lost response,
        // but Twitch never accepted this POST and no remote object was created.
        throw new Error('connection lost before delivery');
      }
      remote.set(segment.id, segment);
      return Response.json({ data: { segments: [segment] } });
    }
    if (init?.method === 'DELETE') {
      const id = url.searchParams.get('id')!; deletes.push(id); remote.delete(id);
      return new Response(null, { status: 204 });
    }
    const id = url.searchParams.get('id');
    return Response.json({ data: { segments: [...remote.values()].filter(segment => !id || segment.id === id) } });
  };
  const client = new TwitchClient({ clientId: 'client', accessToken: 'token', refreshToken: '', broadcasterId: '42', userName: 'user', displayName: 'User' }, async () => {}, request);
  expect(await client.validateSession()).toBe(true);
  const provider: PlanningProvider = {
    create: item => client.createSegment(item), update: (id, item) => client.updateSegment(id, item),
    delete: id => client.deleteSegment(id), recoverCreation: item => client.recoverSegmentCreation(item),
  };
  let disk: CalendarItem[] = [];
  const restart = () => new PlanningOrchestrator(structuredClone(disk), { twitch: provider }, async items => { disk = structuredClone(items); });
  await restart().create({ id: 'series', title: 'Live', category: 'live', startAtUtc: '2030-01-02T12:00:00Z', endAtUtc: '2030-01-02T13:00:00Z',
    recurrence: { frequency: materialized ? 'daily' : 'weekly', interval: 1, timeZone: 'UTC' }, desiredPublication: { local: true, twitch: true, google: false } });
  expect(creates).toBe(materialized ? 7 : 1);
  const createCount = creates;
  const uncertain = materialized ? Object.values(disk[0].providers!.twitch!.projections!).find(entry => entry.uncertainCreate)! : disk[0].providers!.twitch!;
  expect(uncertain.uncertainCreate).toBeTruthy();
  // Even persisted inventory evidence from the previous release cannot prove
  // ownership: a different application creates the unique exact match later.
  uncertain.uncertainCreate!.recovery = { accountId: '42', remoteIds: [] };
  const foreign = { ...lostRequest, id: 'foreign' }; remote.set(foreign.id, foreign);
  const originalIntent = structuredClone(uncertain.uncertainCreate);
  await expect(restart().remove('series', { local: true, confirmRecurring: true })).rejects.toThrow(/Identité Twitch non prouvée/);
  expect(remote.get('foreign')).toEqual(foreign);
  expect(deletes).toHaveLength(materialized ? 6 : 0); // acknowledged owned projections still drain
  for (let retry = 0; retry < 2; retry++) {
    await restart().refreshTwitch();
    disk = await client.sync(structuredClone(disk));
    await expect(restart().retry('series', 'twitch')).rejects.toThrow(/Identité Twitch non prouvée/);
    expect(disk).toHaveLength(1);
    expect(disk[0].deletionPending).toBe(true);
    expect(disk[0].desiredPublication?.twitch).toBe(false);
    const retained = materialized ? Object.values(disk[0].providers!.twitch!.projections!)[0] : disk[0].providers!.twitch!;
    expect(retained.uncertainCreate).toEqual(originalIntent);
    expect(retained.remoteId).toBeUndefined();
    expect(disk[0].providers!.twitch!.lastError).toContain('Vérifiez le planning dans Twitch');
    expect(remote.get('foreign')).toEqual(foreign);
    expect(deletes).not.toContain('foreign');
    expect(creates).toBe(createCount);
  }
});
