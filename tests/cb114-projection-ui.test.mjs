import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('desktop projection conflict choices send the provider and stable occurrence key', async () => {
  const source = readFileSync('apps/web/preview/preview.js', 'utf8');
  const body = source.slice(source.indexOf('function renderEventProviderStatus('), source.indexOf('async function searchEventCategory('));
  const calls = [];
  const button = { dataset: { providerConflict: 'google', strategy: 'remote', occurrenceKey: 'series:2026-10-04T20:00:00' } };
  const host = { innerHTML: '', querySelectorAll: selector => selector === '[data-provider-conflict]' ? [button] : [] };
  const context = { document: { querySelector: selector => selector === '#event-provider-status' ? host : { close() {} } },
    esc: value => String(value).replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
    request: async (...args) => { calls.push(args); return {}; }, applyDashboard() {}, toast() {}, render() {} };
  vm.createContext(context); vm.runInContext(body, context);
  context.renderEventProviderStatus({ id: 'series', providers: { google: { status: 'error', projectionMode: 'materialized', projections: {
    [button.dataset.occurrenceKey]: { status: 'conflict', lastError: '<remote>' },
  } } } });
  assert.match(host.innerHTML, /occurrences sur 28 jours/);
  assert.match(host.innerHTML, /&lt;remote>/);
  await button.onclick();
  assert.equal(calls[0][0], '/api/v1/planning/series/conflict/google');
  assert.deepEqual(JSON.parse(calls[0][1].body), { strategy: 'remote', occurrenceKey: button.dataset.occurrenceKey });
});
