import { afterEach, expect, it, vi } from 'vitest';
// @ts-expect-error Browser module is shipped as JavaScript.
import { createTransport, HttpError } from '../apps/mobile/transport.js';
import { normalizeServer } from '../apps/mobile/runtime.js';
afterEach(() => vi.unstubAllGlobals());
it('recovers HTTP and ticket access at a new LAN address without replacing the device credential', async () => {
  vi.stubGlobal('StreamDashboardNative', { isAndroid: () => true });
  let server = 'http://192.168.1.10:48132';
  const fetcher = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockResolvedValueOnce(new Response(JSON.stringify({ obs: { connected: true } })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ ticket: 'single-use' })));
  vi.stubGlobal('fetch', fetcher);
  const transport = createTransport(() => server, () => 'device-secret');
  await expect(transport.state()).rejects.toThrow(/Wi-Fi\/Ethernet.*Connexions/);
  server = normalizeServer('192.168.2.20:48132');
  await expect(transport.state()).resolves.toMatchObject({ obs: { connected: true } });
  await expect(transport.ticket()).resolves.toMatchObject({ ticket: 'single-use' });
  expect(fetcher.mock.calls[1][0]).toBe('http://192.168.2.20:48132/api/v1/state');
  expect(fetcher.mock.calls[1][1].headers.authorization).toBe('Device device-secret');
  expect(fetcher.mock.calls[2][0]).not.toContain('device-secret');
});
it('distinguishes revoked authentication from a disabled LAN service', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('{"error":{"message":"LAN désactivé"}}', { status: 403 }))
    .mockResolvedValueOnce(new Response('{}', { status: 401 })));
  const transport = createTransport(() => '', () => 'credential');
  await expect(transport.state()).rejects.toMatchObject({ status: 403, message: 'LAN désactivé' });
  await expect(transport.state()).rejects.toBeInstanceOf(HttpError);
});

it('rejects stale HTTP snapshots and never sends a planning fallback to the new connection', async () => {
  let generation = 0;
  let finish!: (response: Response) => void;
  const fetcher = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; }));
  vi.stubGlobal('fetch', fetcher);
  const transport = createTransport(() => '', () => 'credential', () => generation);
  const pending = transport.updatePlanning('event', { title: 'old operation' });
  generation++;
  finish(new Response('{}', { status: 403 }));
  await expect(pending).rejects.toMatchObject({ name: 'StaleConnectionError' });
  expect(fetcher).toHaveBeenCalledOnce();
  const state = transport.state();
  generation++;
  finish(new Response(JSON.stringify({ obs: { streaming: true } })));
  await expect(state).rejects.toMatchObject({ name: 'StaleConnectionError' });
});
