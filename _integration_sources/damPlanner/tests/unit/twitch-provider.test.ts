import { afterEach, describe, expect, it, vi } from 'vitest';
import { TwitchScheduleProvider } from '../../src/providers/twitch.js';
import { FakeSecureTokenStore } from '../../src/oauth/token-store.js';

class TestTwitchProvider extends TwitchScheduleProvider {
  async seedTokens() {
    await this.writeTokens({ accessToken: 'token', refreshToken: 'refresh', expiresAt: Date.now() + 60_000 });
  }
}

afterEach(() => vi.unstubAllGlobals());

describe('TwitchScheduleProvider', () => {
  it('traite un planning Twitch inexistant (404) comme un planning vide', async () => {
    const provider = new TestTwitchProvider(new FakeSecureTokenStore(), async () => 'client-id');
    await provider.seedTokens();
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/helix/users')) {
        return new Response(JSON.stringify({ data: [{ id: '42', display_name: 'Dam', login: 'dam' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/helix/schedule?')) {
        return new Response(JSON.stringify({ error: 'Not Found', status: 404, message: 'The broadcaster has not created a streaming schedule.' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`URL inattendue: ${url}`);
    }));
    await expect(provider.schedule('2026-09-05T18:00:00.000Z', '2026-09-05T20:00:00.000Z')).resolves.toEqual([]);
  });
});
