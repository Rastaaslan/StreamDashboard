import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CalendarItem } from '../packages/contracts/src/index.js';
import { assertAssistedLocalSlot } from '../apps/server/src/streamcockpit-planning-assisted.js';
import { startDashboardServer, type DashboardServerHandle } from '../apps/server/src/index.js';

const at = Date.parse('2026-11-02T10:00:00Z');
const from = '2030-01-01T14:00:00.000Z', to = '2030-01-01T15:00:00.000Z';
const local = {
  title: 'Proposition locale', category: 'live' as const, startAtUtc: from, endAtUtc: to,
  desiredPublication: { local: true, twitch: false, google: false },
};
const busy = (patch: Partial<CalendarItem> = {}): CalendarItem => ({
  id: 'other', title: 'Occupé', category: 'live', startAtUtc: from, endAtUtc: to, ...patch,
});
describe('F06 authoritative assisted-local guard', () => {
  it('permits a free slot and rejects the newly inserted normal local event', () => {
    expect(() => assertAssistedLocalSlot(local, [], at)).not.toThrow();
    expect(() => assertAssistedLocalSlot(local, [busy()], at)).toThrow(/occupé/i);
  });
  it('honors imported Google rows and recurrent master occurrences', () => {
    expect(() => assertAssistedLocalSlot(local, [busy({source: 'GOOGLE'})], at)).toThrow(/occupé/i);
    const daily = busy({startAtUtc: '2029-12-31T14:00:00.000Z', endAtUtc: '2029-12-31T15:00:00.000Z',
      recurrence: { frequency: 'daily', interval: 1, timeZone: 'Europe/Paris' }});
    expect(() => assertAssistedLocalSlot(local, [daily], at)).toThrow(/occupé/i);
  });
  it('rejects corrupt/deleting and uncertain host rows, without mutating state', () => {
    const rows = [busy({deletionPending: true})], old = structuredClone(rows);
    expect(() => assertAssistedLocalSlot(local, rows, at)).toThrow(/incertain/i);
    expect(rows).toEqual(old);
    expect(() => assertAssistedLocalSlot(local, [busy({id: ''})], at)).toThrow(/incertain/i);
  });
  it('refuses provider flags, recurrence, expired/naive dates and excessive ranges', () => {
    const bad = [
      { ...local, desiredPublication: {local: true, google: true, twitch: false} },
      { ...local, category: 'personal' },
      { ...local, startAtUtc: '2030-01-01T14:00:00' },
      { ...local, startAtUtc: '2026-11-02T10:02:00Z', endAtUtc: '2026-11-02T11:02:00Z' },
      { ...local, endAtUtc: '2030-01-03T14:00:00Z' },
      { ...local, recurrence: {frequency: 'daily', interval: 1, timeZone: 'UTC'} },
    ];
    for (const input of bad) expect(() => assertAssistedLocalSlot(input as any, [], at)).toThrow();
  });
});

let server: DashboardServerHandle | undefined;
let folder = '';
afterEach(async () => { await server?.stop(); server = undefined; if (folder) await rm(folder, {recursive:true, force:true}); folder = ''; });
async function boot() {
  folder = await mkdtemp(join(tmpdir(), 'sc3-f06-queue-'));
  server = await startDashboardServer({port:0, dataDir:folder,
    logger:{info(){},warn(){},error(){}}});
}
async function post(item: unknown) {
  return fetch(server!.url + '/api/v2/planning', {
    method: 'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(item),
  });
}
async function state() {
  return (await (await fetch(server!.url + '/api/v1/state')).json()).planning as CalendarItem[];
}
it('F06 loopback: a second reviewed create cannot overlap an already committed FIXE event', async () => {
  await boot();
  const first = await post({...local,assistedLocalSlot:true});
  expect(first.status, await first.clone().text()).toBe(201);
  const second = await post({...local,title:'Second',assistedLocalSlot:true});
  expect(second.status).toBe(409);
  expect((await second.json()).error.code).toBe('REVISION_CONFLICT');
  expect(await state()).toHaveLength(1);
});
it('F06 loopback: two simultaneous confirmed requests are serialized; exactly one creates', async () => {
  await boot();
  const responses = await Promise.all([
    post({...local,title:'First',assistedLocalSlot:true}),
    post({...local,title:'Second',assistedLocalSlot:true}),
  ]);
  expect(responses.map(r=>r.status).sort()).toEqual([201,409]);
  expect(await state()).toHaveLength(1);
});
it('F06 loopback: regular event creation remains compatible, assisted remote requests fail closed', async () => {
  await boot();
  expect((await post({...local,title:'Regular'})).status).toBe(201);
  expect((await post({...local,title:'Overlapping regular'})).status).toBe(201);
  expect((await post({...local,title:'Assisted remote',assistedLocalSlot:true,
    desiredPublication:{local:true,google:true,twitch:false}})).status).toBe(400);
  expect(await state()).toHaveLength(2);
});
