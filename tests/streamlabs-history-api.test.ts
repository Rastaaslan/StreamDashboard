import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startDashboardServer, type DashboardServerHandle } from '../apps/server/src/index.js';
import { MemorySecretStore } from '../apps/server/src/storage.js';
import { isManagementApiAllowed, isRemoteApiAllowed } from '../apps/server/src/remote-api-policy.js';

describe('Streamlabs history API', () => {
  it('makes cloud history readable with local reception without replaying donations or automations', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'sl-history-api-'));
    const secrets = new MemorySecretStore();
    await secrets.setStreamlabsToken('socket-test-credential');
    let receive: ((event: unknown) => void) | undefined;
    const cloudRead = vi.fn(async (input: unknown, init?: RequestInit) => {
      expect(String(input)).toBe('https://streamlabs.com/api/v5/slobs/recentevents/widget_test_credential_123456789');
      expect(init?.method).toBe('GET');
      return Response.json({
        data: {
          follows: [{ id: 123, type: 'follow', platform: 'twitch_account', name: 'Cloud follow', created_at: '2026-10-19 12:00:00' }],
          donations: [{ id: 456, type: 'donation', platform: 'streamlabs', name: 'Cloud donor', created_at: '2020-01-02 03:04:05', amount: '5', formatted_amount: '5,00 €', message: 'Old donation; do not replay' }],
          platformcredentials: [{ access_token: 'must-never-be-cached' }],
        },
        platforms: { refresh_token: 'must-never-be-returned' },
      });
    });
    let host: DashboardServerHandle | undefined;
    try {
      host = await startDashboardServer({
        port: 0, dataDir: directory, obsEnabled: false, secretStore: secrets,
        streamlabsFetch: cloudRead as typeof fetch,
        streamlabsTransport: { connect: async (_token, _tip, _disconnect, event) => { receive = event; return async () => {}; } },
        logger: { info() {}, warn() {}, error() {} },
      });
      const read = (route: string) => fetch(host!.url + route).then(response => response.json());
      await vi.waitFor(() => expect(receive).toBeTypeOf('function'));
      receive!({ for: 'twitch_account', type: 'raid', message: [{ _id: 'live-raid', name: 'Live visitor', raiders: 3 }] });
      await vi.waitFor(async () => expect((await read('/api/v1/streamlabs/events')).items).toHaveLength(1));
      expect(cloudRead).not.toHaveBeenCalled();
      const localBefore = await readFile(path.join(directory, 'streamlabs-events.json'), 'utf8');

      const configured = await fetch(host.url + '/api/v1/supports/streamlabs/history/config', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ widgetUrl: 'https://streamlabs.com/widgets/event-list?token=widget_test_credential_123456789' }),
      });
      expect(configured.status).toBe(200);
      expect(await configured.json()).toMatchObject({ configured: true, status: 'SYNCED', count: 2 });
      const [regie, gamePC] = await Promise.all([read('/api/v1/streamlabs/events'), read('/api/v1/streamlabs/events?refresh=1')]);
      expect(gamePC).toEqual(regie);
      expect(regie.items).toHaveLength(3);
      expect(regie.items.find((row: { type: string }) => row.type === 'follow')).toMatchObject({ origin: 'cloud', occurredAt: '2026-10-19T12:00:00.000Z' });
      expect(regie.provider.status).toBe('CONNECTED');
      expect(cloudRead).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(regie)).not.toMatch(/widget_test_credential|socket-test-credential|must-never/);
      expect(await readFile(path.join(directory, 'streamlabs-events.json'), 'utf8')).toBe(localBefore);
      expect((await read('/api/v1/events?type=support.received')).items).toEqual([]);
      expect((await read('/api/v1/events?type=test.support')).items).toEqual([]);
      expect(JSON.stringify(await read('/api/v1/supports'))).not.toContain('Cloud donor');

      const disconnected = await fetch(host.url + '/api/v1/supports/streamlabs/history/config', { method: 'DELETE' });
      expect(await disconnected.json()).toMatchObject({ configured: false, status: 'NOT_CONFIGURED', count: 0 });
      const remaining = await read('/api/v1/streamlabs/events');
      expect(remaining.items).toHaveLength(1);
      expect(remaining.items[0].displayName).toBe('Live visitor');
      expect(remaining.provider.status).toBe('CONNECTED');
    } finally {
      await host?.stop();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('reserves history credentials for management while paired readers can read the merged feed', () => {
    expect(isRemoteApiAllowed('GET', '/v1/streamlabs/events')).toBe(true);
    for (const [method, route] of [
      ['GET', '/v1/supports/streamlabs/history/status'],
      ['PUT', '/v1/supports/streamlabs/history/config'],
      ['DELETE', '/v1/supports/streamlabs/history/config'],
    ]) {
      expect(isManagementApiAllowed(method, route)).toBe(true);
      expect(isRemoteApiAllowed(method, route)).toBe(false);
    }
    for (const method of ['POST', 'PATCH', 'GET']) expect(isManagementApiAllowed(method, '/v1/supports/streamlabs/history/config')).toBe(false);
    expect(isManagementApiAllowed('PUT', '/v1/supports/streamlabs/history/config/other')).toBe(false);
  });
});
