import { afterEach, expect, it, vi } from 'vitest';
import { TwitchClient } from '../integrations/twitch/src/client.js';
import { PlanningOrchestrator } from '../packages/core/src/planning.js';
import type { CalendarItem } from '../packages/contracts/src/index.js';

const weekly = { frequency: 'weekly', interval: 1, timeZone: 'Europe/Paris' } as const;
const event = (recurrence?: CalendarItem['recurrence']): CalendarItem => ({ id: 'local', title: 'Live', startAtUtc: '2030-06-04T18:00:00Z', endAtUtc: '2030-06-04T19:00:00Z', category: 'live', recurrence, desiredPublication: { local: true, twitch: true, google: false } });
afterEach(() => vi.unstubAllGlobals());
async function setup() {
  let segments: any[] = [];
  let failDelete = false;
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).includes('/validate')) return Response.json({ client_id: 'client', user_id: '42', scopes: ['channel:manage:schedule'] });
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (init?.method === 'POST') segments.push({ ...body, id: 'remote', end_time: new Date(Date.parse(body.start_time) + Number(body.duration) * 60000).toISOString() });
    if (init?.method === 'PATCH') Object.assign(segments[0], body);
    if (init?.method === 'DELETE') {
      if (failDelete) { failDelete = false; return Response.json({ message: 'unavailable' }, { status: 503 }); }
      segments = []; return new Response(null, { status: 204 });
    }
    return Response.json({ data: { segments } });
  });
  vi.stubGlobal('fetch', fetcher);
  const client = new TwitchClient({ clientId: 'client', accessToken: 'token', refreshToken: '', broadcasterId: '42', userName: 'user', displayName: 'User' });
  await client.validateSession();
  const provider = { create: client.createSegment.bind(client), update: client.updateSegment.bind(client), delete: client.deleteSegment.bind(client) };
  return { client, fetcher, provider, failDelete: () => { failDelete = true; } };
}
it.each([false, true])('syncs create/update/reconcile/delete/retry, weekly=%s', async recurring => {
  const { client, fetcher, provider, failDelete } = await setup();
  const planning = new PlanningOrchestrator([], { twitch: provider }, async () => {});
  const created = await planning.create(event(recurring ? weekly : undefined));
  expect(created.providers?.twitch?.status).toBe('synced');
  expect(created.twitchRecurring).toBe(recurring);
  expect(JSON.parse(String(fetcher.mock.calls.find(([, init]) => init?.method === 'POST')![1]!.body))).toMatchObject({ is_recurring: recurring });
  const updated = await planning.update(created.id, { ...created, title: 'Updated' });
  expect(updated.providers?.twitch?.status).toBe('synced');
  expect(JSON.parse(String(fetcher.mock.calls.find(([, init]) => init?.method === 'PATCH')![1]!.body))).toEqual({ title: 'Updated' });
  const reconciled = await client.sync(planning.all());
  expect(reconciled).toHaveLength(1);
  expect(reconciled[0].providers?.twitch?.fingerprint).toBeTruthy();
  if (recurring) await expect(planning.remove(created.id, { twitch: true })).rejects.toThrow(/récurrente/);
  failDelete();
  await planning.remove(created.id, { twitch: true, confirmRecurring: true });
  expect(planning.all()[0].desiredPublication?.twitch).toBe(false);
  const retried = await planning.retry(created.id, 'twitch', { confirmRecurring: true });
  expect(retried.providers?.twitch?.status).toBe('not-published');
  expect(await client.sync(planning.all())).toHaveLength(1);
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
});
it.each([{ frequency: 'daily', interval: 1 }, { frequency: 'weekly', interval: 2 }, { frequency: 'monthly', interval: 1 }] as const)('routes $frequency/$interval to materialization while direct native writes remain guarded', async recurrence => {
  const { client, provider, fetcher } = await setup();
  const item = event({ ...recurrence, timeZone: 'UTC' });
  await expect(client.createSegment(item)).rejects.toThrow(/récurrence/);
  await expect(client.updateSegment('remote', item)).rejects.toThrow(/récurrence/);
  expect(await client.sync([item])).toEqual([item]);
  const planning = new PlanningOrchestrator([], { twitch: provider }, async () => {});
  const created = await planning.create(item);
  expect(created.providers?.twitch?.projectionMode).toBe('materialized');
  expect(created.providers?.twitch?.status).toBe('synced');
  await planning.retry(item.id, 'twitch');
  await planning.update(item.id, item);
  expect(fetcher.mock.calls.filter(([, init]) => ['POST', 'PATCH', 'DELETE'].includes(init?.method ?? ''))).toHaveLength(0);
});
it('refuses moving a recurring series before PATCH and keeps one identity on retry', async () => {
  const { client, provider, fetcher } = await setup();
  const planning = new PlanningOrchestrator([], { twitch: provider }, async () => {});
  const created = await planning.create(event(weekly));
  const changed = await planning.update(created.id, { ...created, startAtUtc: '2030-06-04T18:30:00Z' });
  expect(changed.providers?.twitch?.status).toBe('error');
  await expect(planning.retry(created.id, 'twitch')).rejects.toThrow(/déplacer/);
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(0);
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  expect((await client.sync([created]))[0].providers?.twitch?.status).toBe('synced');
});
it.each([false, true])('recreates only on explicit retry after remote deletion, weekly=%s', async recurring => {
  const { client, provider, fetcher } = await setup();
  const planning = new PlanningOrchestrator([], { twitch: provider }, async () => {});
  const created = await planning.create(event(recurring ? weekly : undefined));
  await client.deleteSegment(created.twitchSegmentId!);
  const reconciled = await client.sync(planning.all());
  expect(reconciled[0].providers?.twitch?.deletedRemotely).toBe(true);
  expect(reconciled[0].syncError).toBeTruthy();
  let saved: CalendarItem[] = [];
  const restarted = new PlanningOrchestrator(reconciled, { twitch: provider }, async rows => { saved = structuredClone(rows); });
  const edited = await restarted.update(created.id, { ...reconciled[0], title: 'Edited after deletion' });
  expect(edited.title).toBe('Edited after deletion');
  expect(edited.providers?.twitch?.deletedRemotely).toBe(true);
  expect(edited.providers?.twitch?.status).toBe('error');
  expect(edited.syncError).toBeTruthy();
  expect(saved[0].providers?.twitch?.deletedRemotely).toBe(true);
  await client.sync(restarted.all());
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  const retried = await restarted.retry(created.id, 'twitch');
  const posts = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(JSON.parse(String(posts[1][1]!.body))).toMatchObject({ title: 'Edited after deletion', is_recurring: recurring });
  expect(retried.providers?.twitch?.status).toBe('synced');
  expect(retried.syncError).toBeUndefined();
  expect(retried.twitchRecurring).toBe(recurring);
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2);
  expect((await client.sync(restarted.all()))[0].providers?.twitch?.status).toBe('synced');
});
it('does not adopt a simple segment as the identity of a weekly series', async () => {
  const { client, fetcher } = await setup();
  await client.createSegment(event());
  await client.createSegment(event(weekly));
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2);
});
it('preserves external ownership across repeated reconciliation', async () => {
  const { client } = await setup();
  await client.createSegment(event(weekly));
  const imported = await client.sync([]);
  const refreshed = await client.sync(imported);
  expect(refreshed).toHaveLength(1);
  expect(refreshed[0]).toMatchObject({ ownership: 'EXTERNAL', external: true, twitchRecurring: true });
});
it('republishes an imported native series as recurring after remote deletion', async () => {
  const { client, provider, fetcher } = await setup();
  await client.createSegment(event(weekly));
  const imported = await client.sync([]);
  expect(imported[0].recurrence).toBeUndefined();
  expect(imported[0].twitchRecurring).toBe(true);
  const planning = new PlanningOrchestrator(imported, { twitch: provider }, async () => {});
  await client.deleteSegment(imported[0].twitchSegmentId!);
  await planning.markRemoteDeleted(imported[0].id, 'twitch');
  const retried = await planning.retry(imported[0].id, 'twitch');
  const posts = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(posts).toHaveLength(2);
  expect(JSON.parse(String(posts[1][1]!.body))).toMatchObject({ is_recurring: true });
  expect(retried).toMatchObject({ twitchRecurring: true, providers: { twitch: { status: 'synced' } } });
  expect((await client.sync(planning.all()))[0].twitchRecurring).toBe(true);
});
it.each([false, true])('persists withdrawal without remote identity before retry, weekly=%s', async recurring => {
  const { client, provider, fetcher } = await setup();
  const planning = new PlanningOrchestrator([], { twitch: provider }, async () => {});
  const created = await planning.create(event(recurring ? weekly : undefined));
  await client.deleteSegment(created.twitchSegmentId!);
  const reconciled = await client.sync(planning.all());
  expect(reconciled[0].providers?.twitch?.remoteId).toBeUndefined();
  expect(reconciled[0].twitchSegmentId).toBeUndefined();
  let saved: CalendarItem[] = [];
  const restarted = new PlanningOrchestrator(reconciled, { twitch: provider }, async rows => { saved = structuredClone(rows); });
  await restarted.remove(created.id, { twitch: true });
  expect(saved[0].desiredPublication?.twitch).toBe(false);
  const afterWithdrawal = new PlanningOrchestrator(saved, { twitch: provider }, async () => {});
  const retried = await afterWithdrawal.retry(created.id, 'twitch');
  expect(retried.providers?.twitch?.status).toBe('not-published');
  await client.sync(afterWithdrawal.all());
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
});
