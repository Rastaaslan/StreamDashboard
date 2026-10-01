import { afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { TwitchClient } from '../integrations/twitch/src/client.js';
import { GoogleCalendarClient } from '../integrations/google-calendar/src/client.js';

afterEach(() => vi.unstubAllGlobals());
const credentials = { clientId: 'id', accessToken: 'token', refreshToken: '', broadcasterId: '42', userName: '', displayName: '' };
async function authorizedClient() {
  const client = new TwitchClient(credentials);
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ client_id: 'id', user_id: '42', scopes: ['channel:manage:schedule'] }));
  expect(await client.validateSession()).toBe(true);
  vi.mocked(fetch).mockClear();
  return client;
}
const segment = { id: 'remote', title: 'Live', start_time: '2030-01-01T10:00:00Z', end_time: '2030-01-01T11:00:00Z', category: { id: 'game', name: 'Game' } };
const fingerprint = createHash('sha256').update([segment.title, segment.start_time, segment.end_time, segment.category.id].join('\u001f')).digest('base64url');
const item = { id: 'local', title: 'New title', startAtUtc: segment.start_time, endAtUtc: segment.end_time, twitchCategoryId: 'game', providers: { twitch: { status: 'synced' as const, remoteId: 'remote', fingerprint } } };

it('accepts the Android SHA-256 fingerprint and returns the new Twitch fingerprint', async () => {
  const request = vi.fn(async (_url: unknown, init?: RequestInit) => new Response(JSON.stringify({ data: { segments: [init?.method === 'PATCH' ? { ...segment, title: 'New title' } : segment] } })));
  vi.stubGlobal('fetch', request);
  const result = await (await authorizedClient()).updateSegment('remote', item);
  expect(request.mock.calls.map(call => call[1]?.method ?? 'GET')).toEqual(['GET', 'PATCH']);
  expect(result.fingerprint).toBe(createHash('sha256').update(['New title', segment.start_time, segment.end_time, 'game'].join('\u001f')).digest('base64url'));
});

it('refuses to overwrite Twitch when another device changed the remote fingerprint', async () => {
  const request = vi.fn(async () => new Response(JSON.stringify({ data: { segments: [{ ...segment, title: 'Remote edit' }] } })));
  vi.stubGlobal('fetch', request);
  await expect((await authorizedClient()).updateSegment('remote', item)).rejects.toMatchObject({ code: 'CONFLICT', remote: { title: 'Remote edit' } });
  expect(request).toHaveBeenCalledTimes(1);
});

it.each([404, 410])('treats Google deletion HTTP %i as already deleted while preserving If-Match', async status => {
  const request = vi.fn(async () => new Response('{}', { status }));
  const google = new GoogleCalendarClient('client', { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 60_000 }, async () => {}, request as typeof fetch);
  await expect(google.delete('android-calendar', 'remote', 'etag')).resolves.toBeUndefined();
  expect(request).toHaveBeenCalledWith(expect.stringContaining('/android-calendar/events/remote'), expect.objectContaining({ method: 'DELETE', headers: expect.objectContaining({ 'If-Match': 'etag' }) }));
});

it('treats repeated Twitch deletion as success', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
  await expect((await authorizedClient()).deleteSegment('remote')).resolves.toBeUndefined();
});

it('recognizes Android Google ownership metadata on provider refresh', async () => {
  const request = vi.fn(async () => new Response(JSON.stringify({ items: [{ id: 'g', summary: 'Live', start: { dateTime: segment.start_time }, end: { dateTime: segment.end_time }, extendedProperties: { private: { streamDashboardEventId: 'android-id' } } }] })));
  const google = new GoogleCalendarClient('client', { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 60_000 }, async () => {}, request as typeof fetch);
  expect(await google.events('calendar')).toMatchObject([{ id: 'g', localId: 'android-id', managed: true }]);
});
