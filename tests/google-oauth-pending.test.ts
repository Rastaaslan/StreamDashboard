import { describe, expect, it, vi } from 'vitest';
import { createGoogleOAuthAttempt, GoogleCalendarClient } from '../integrations/google-calendar/src/client.js';

describe('Google OAuth pending attempt lifecycle', () => {
  it('refuse immédiatement un callback provenant d’une tentative annulée par disconnect', async () => {
    const clientId = 'stale-callback-client';
    const redirectUri = 'http://127.0.0.1:47832/api/v1/google/oauth/callback';
    const attempt = createGoogleOAuthAttempt(clientId, redirectUri);
    const request = vi.fn();
    const persist = vi.fn(async () => undefined);
    const client = new GoogleCalendarClient(clientId, null, persist, request as typeof fetch);

    await client.disconnect();

    await expect(client.exchangeCode('late-code', attempt.state, attempt)).rejects.toThrow(/expirée|annulée/i);
    expect(request).not.toHaveBeenCalled();
    expect(client.connected).toBe(false);
  });

  it('garde un seul state/verifier actif par client et callback pendant la fenêtre PKCE', () => {
    const clientId = 'single-flight-client';
    const redirectUri = 'http://127.0.0.1:47832/api/v1/google/oauth/callback';
    const first = createGoogleOAuthAttempt(clientId, redirectUri);
    const second = createGoogleOAuthAttempt(clientId, redirectUri);

    expect(second).toEqual(first);
    expect(new URL(first.authorizationUrl).searchParams.get('state')).toBe(first.state);
    expect(new URL(first.authorizationUrl).searchParams.get('code_challenge_method')).toBe('S256');
  });
});
