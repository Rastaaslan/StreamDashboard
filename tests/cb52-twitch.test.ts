import { afterEach, expect, it, vi } from 'vitest';
import { TwitchClient } from '../integrations/twitch/src/client.js';
const credentials = { clientId: 'client', accessToken: 'secret-access', refreshToken: 'secret-refresh', broadcasterId: '42', userName: 'streamer', displayName: 'Streamer' };
afterEach(() => vi.unstubAllGlobals());
it('PATCH recurring schedule uses string duration and timezone, preserving actionable provider errors without tokens', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ client_id: 'client', user_id: '42', scopes: ['channel:manage:schedule'] }))
    .mockResolvedValueOnce(Response.json({ message: 'Invalid start_time for recurring segment secret-access' }, { status: 400 }));
  vi.stubGlobal('fetch', fetcher);
  const client = new TwitchClient(credentials);
  await client.validateSession();
  const result = client.updateSegment('segment', { id: 'local', title: 'Recurring', startAtUtc: '2030-06-01T20:00:00Z', endAtUtc: '2030-06-01T22:00:00Z', twitchRecurring: true, recurrence: { frequency: 'weekly', interval: 1, timeZone: 'Europe/Paris' } });
  await expect(result).rejects.toThrow('Invalid start_time for recurring segment [redacted]');
  const [url, init] = fetcher.mock.calls[1];
  expect(url).toContain('/schedule/segment?broadcaster_id=42&id=segment');
  expect(init.method).toBe('PATCH');
  expect(JSON.parse(init.body)).toEqual({ start_time: '2030-06-01T20:00:00Z', duration: '120', timezone: 'Europe/Paris', title: 'Recurring' });
});
