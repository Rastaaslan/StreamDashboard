import { afterEach, expect, it, vi } from 'vitest';
import { TwitchClient } from '../integrations/twitch/src/client.js';
const credentials = { clientId: 'client', accessToken: 'secret-access', refreshToken: 'secret-refresh', broadcasterId: '42', userName: 'streamer', displayName: 'Streamer' };
afterEach(() => vi.unstubAllGlobals());
it('PATCH recurring schedule uses string duration and timezone, preserving actionable provider errors without tokens', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ client_id: 'client', user_id: '42', scopes: ['channel:manage:schedule'] }))
    .mockResolvedValueOnce(Response.json({ data: { segments: [{ id: 'segment', title: 'Old', start_time: '2030-06-01T18:00:00Z', end_time: '2030-06-01T19:00:00Z' }] } }))
    .mockResolvedValueOnce(Response.json({ message: 'Invalid start_time for recurring segment secret-access' }, { status: 400 }));
  vi.stubGlobal('fetch', fetcher);
  const client = new TwitchClient(credentials);
  await client.validateSession();
  const result = client.updateSegment('segment', { id: 'local', title: 'Recurring', startAtUtc: '2030-06-01T20:00:00Z', endAtUtc: '2030-06-01T22:00:00Z', twitchRecurring: true, recurrence: { frequency: 'weekly', interval: 1, timeZone: 'Europe/Paris' } });
  await expect(result).rejects.toThrow('Invalid start_time for recurring segment [redacted]');
  const [url, init] = fetcher.mock.calls[2];
  expect(url).toContain('/schedule/segment?broadcaster_id=42&id=segment');
  expect(init.method).toBe('PATCH');
  expect(JSON.parse(init.body)).toEqual({ start_time: '2030-06-01T20:00:00Z', duration: '120', timezone: 'Europe/Paris', title: 'Recurring' });
});

it('title-only PATCH of a past recurring segment omits time, duration and category', async () => {
  const segment = { id: 'recurring', title: 'Old title', start_time: '2020-01-01T20:00:00Z', end_time: '2020-01-01T22:00:00Z', is_recurring: true, category: { id: '7' } };
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ client_id: 'client', user_id: '42', scopes: ['channel:manage:schedule'] }))
    .mockResolvedValueOnce(Response.json({ data: { segments: [segment] } }))
    .mockResolvedValueOnce(Response.json({ data: { segments: [{ ...segment, title: 'New title' }] } }));
  vi.stubGlobal('fetch', fetcher);
  const client = new TwitchClient(credentials); await client.validateSession();
  await client.updateSegment('recurring', { id: 'local', title: 'New title', startAtUtc: segment.start_time, endAtUtc: segment.end_time, twitchCategoryId: '7', twitchRecurring: true });
  expect(JSON.parse(fetcher.mock.calls[2][1].body)).toEqual({ title: 'New title' });
});

it('sanitizes encoded credentials and provider echoes of unrelated authorization fields', async () => {
  const { safeTwitchMessage } = await import('../integrations/twitch/src/client.js');
  const value = safeTwitchMessage('Bad duration secret/access secret%2Faccess Bearer other-token client_secret=another-secret refresh_token:"old-secret"', ['secret/access']);
  expect(value).toContain('Bad duration');
  expect(value).not.toMatch(/secret\/access|secret%2Faccess|other-token|another-secret|old-secret/);
});
