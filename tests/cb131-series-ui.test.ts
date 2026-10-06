import { expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { startDashboardServer } from '../apps/server/src/index.js';
import { expandRecurringItems } from '../packages/core/src/recurrence.js';

it('Desktop occurrence → scope series → confirmation → API → durable local deletion + idempotent DELETE', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'cb131-ui-'));
  let server = await startDashboardServer({ port: 0, dataDir, logger: { info() {}, warn() {}, error() {} } });
  const calls: string[] = [];
  const request = async (route: string, options: RequestInit = {}) => {
    calls.push(`${options.method || 'GET'} ${route}`);
    const response = await fetch(server.url + route, { ...options, headers: { 'Content-Type': 'application/json' } });
    expect(response.ok).toBe(true); return response.json();
  };
  try {
    const created = await request('/api/v1/planning', { method: 'POST', body: JSON.stringify({ title: 'Delete series', startAtUtc: '2030-06-02T19:00:00Z', endAtUtc: '2030-06-02T20:00:00Z', recurrence: { frequency: 'daily', interval: 1, timeZone: 'UTC' } }) });
    const series = created.planning[0];
    const occurrence = expandRecurringItems([series], { from: Date.parse(series.startAtUtc), nextCount: 7 })[0];
    const source = await readFile('apps/web/preview/preview.js', 'utf8');
    const nodes: Record<string, any> = {};
    const node = (key: string) => nodes[key] ??= { close: vi.fn(), value: 'series' };
    const context = { document: { querySelector: node }, state: { eventEdit: { occurrence, series, scope: 'occurrence' } }, dialogCompletion: () => () => true,
      dialogCreation: () => ({ isCurrent: () => true, finish: vi.fn() }), closeDialog: (dialog: any) => dialog.close(),
      populateEventForm: vi.fn(), confirm: vi.fn(() => true), request, refreshRuntime: vi.fn(), toast: vi.fn() };
    runInNewContext(source.slice(source.indexOf("document.querySelector('#event-scope').onchange="), source.indexOf("document.querySelector('#event-form').onsubmit=")) + source.slice(source.indexOf("document.querySelector('#event-delete').onclick="), source.indexOf("document.querySelector('#event-dialog').addEventListener('close'")), context);
    node('#event-scope').onchange();
    await node('#event-delete').onclick();
    expect(context.confirm).toHaveBeenCalledWith('Supprimer toute la série ?');
    expect(calls).toContain(`DELETE /api/v1/planning/${series.id}`);
    expect(calls.some(call => call.endsWith('/occurrence'))).toBe(false);
    expect(node('#event-dialog').close).toHaveBeenCalled();
    expect((await request('/api/v1/state')).planning).toEqual([]);
    await request(`/api/v1/planning/${series.id}`, { method: 'DELETE', body: '{}' });
    await server.stop(); server = await startDashboardServer({ port: 0, dataDir, logger: { info() {}, warn() {}, error() {} } });
    expect((await request('/api/v1/state')).planning).toEqual([]);
  } finally { await server.stop(); await rm(dataDir, { recursive: true, force: true }); }
});
