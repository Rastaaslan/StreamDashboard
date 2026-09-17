import { describe, expect, it } from 'vitest';
import { WizeBotAdapter } from '../integrations/wizebot/src/adapter.js';
import { DiscordSoundboardProvider } from '../integrations/discord/src/soundboard-provider.js';

describe('provider boundaries', () => {
  it('WizeBot ne simule jamais CONNECTED sans configuration et transport', async () => { const absent = new WizeBotAdapter(null); expect((await absent.refresh()).status).toBe('NOT_CONFIGURED'); const configured = new WizeBotAdapter({ apiBaseUrl: 'https://example.invalid', token: 'secret' }); expect(await configured.refresh()).toMatchObject({ status: 'ERROR', lastError: { code: 'WIZEBOT_TRANSPORT_UNAVAILABLE' } }); });
  it('WizeBot peut devenir CONNECTED via un transport vérifié injecté', async () => { const adapter = new WizeBotAdapter({ apiBaseUrl: 'https://api.example', token: 'secret' }, { status: async () => ({ name: 'Bot', connected: true }) }); expect((await adapter.refresh()).status).toBe('CONNECTED'); });
  it('Discord Soundboard reste distinct et explicite sur permissions/configuration', async () => { await expect(new DiscordSoundboardProvider(false).sounds()).rejects.toMatchObject({ name: 'DISCORD_SOUNDBOARD_NOT_CONFIGURED' }); await expect(new DiscordSoundboardProvider(true).sounds()).rejects.toMatchObject({ name: 'DISCORD_SOUNDBOARD_NOT_SUPPORTED' }); });
});
