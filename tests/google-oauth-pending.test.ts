import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGoogleOAuthAttempt, GoogleCalendarClient } from '../integrations/google-calendar/src/client.js';

describe('Google OAuth pending attempt lifecycle', () => {
  afterEach(() => vi.useRealTimers());

  it('renews expired PKCE credentials after repeated clicks without extending their deadline', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const clientId = 'pkce-expiry-client';
    const redirect = 'http://127.0.0.1/callback';
    const provider = vi.fn(async () => Response.json({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 }));
    const client = new GoogleCalendarClient(clientId, null, async () => undefined, provider);
    const first = createGoogleOAuthAttempt(clientId, redirect);
    vi.setSystemTime(first.expiresAt - 60_000);
    expect(createGoogleOAuthAttempt(clientId, redirect)).toBe(first);
    vi.setSystemTime(first.expiresAt);
    await expect(client.exchangeCode('expired', first.state, first)).rejects.toThrow(/expirée/);
    expect(provider).not.toHaveBeenCalled();
    const renewed = createGoogleOAuthAttempt(clientId, redirect);
    expect(renewed.expiresAt).toBe(first.expiresAt + 600_000);
    expect(renewed.state).not.toBe(first.state);
    expect(renewed.verifier).not.toBe(first.verifier);
    await client.exchangeCode('fresh', renewed.state, renewed);
    expect(client.connected).toBe(true);
  });
  it('refuse immédiatement un callback provenant d’une tentative annulée par disconnect', async () => {
    const clientId = 'stale-callback-client';
    const redirectUri = 'http://127.0.0.1:48132/api/v1/google/oauth/callback';
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
    const redirectUri = 'http://127.0.0.1:48132/api/v1/google/oauth/callback';
    const first = createGoogleOAuthAttempt(clientId, redirectUri);
    const second = createGoogleOAuthAttempt(clientId, redirectUri);

    expect(second).toEqual(first);
    expect(new URL(first.authorizationUrl).searchParams.get('state')).toBe(first.state);
    expect(new URL(first.authorizationUrl).searchParams.get('code_challenge_method')).toBe('S256');
  });
});
