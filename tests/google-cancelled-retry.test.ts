import { expect, it, vi } from 'vitest';
import { GoogleCalendarClient } from '../integrations/google-calendar/src/client.js';

const client = (body: Record<string, unknown>) => {
  const request = vi.fn(async () => Response.json(body));
  return { api: new GoogleCalendarClient('client', { accessToken: 'token', refreshToken: 'refresh', expiresAt: Date.now() + 3600000 }, async () => {}, request), request };
};

it.each(['simple', 'series'])('recognizes the dateless cancelled %s identity before parsing dates', async id => {
  // Deleted simple events and series masters share this minimal response.
  const { api, request } = client({ id, status: 'cancelled' });
  await expect(api.event('calendar', id)).rejects.toMatchObject({ code: 'DELETED_REMOTELY' });
  expect(request).toHaveBeenCalledOnce();
});

it.each([
  { recurringEventId: 'master' },
  { originalStartTime: { dateTime: '2030-10-01T18:00:00Z' } },
  { recurringEventId: 'master', originalStartTime: { dateTime: '2030-10-01T18:00:00Z' } },
])('still refuses cancelled recurrence exceptions: %j', exception => {
  const { api } = client({ id: 'occurrence', status: 'cancelled', ...exception });
  return expect(api.event('calendar', 'occurrence')).rejects.toMatchObject({ code: 'GOOGLE_RECURRENCE_EXCEPTION_UNSUPPORTED' });
});
