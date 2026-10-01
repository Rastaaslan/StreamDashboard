import { describe, expect, it } from 'vitest';
import { StreamlabsAdapter } from '../integrations/streamlabs/src/adapter.js';
import { WizeBotAdapter } from '../integrations/wizebot/src/adapter.js';
import { DiscordSoundboardProvider } from '../integrations/discord/src/soundboard-provider.js';

describe('provider boundaries', () => {
  it('Streamlabs est explicitement NOT_SUPPORTED sans transport vérifié', async () => {
    const adapter = new StreamlabsAdapter('token', async () => undefined);
    expect(adapter.state().status).toBe('NOT_SUPPORTED');
    await adapter.connect();
    expect(adapter.state().status).toBe('NOT_SUPPORTED');
  });

  it('Streamlabs peut devenir CONNECTED via un transport injecté', async () => {
    const adapter = new StreamlabsAdapter('token', async () => undefined, {
      connect: async () => async () => undefined,
    });
    await adapter.connect();
    expect(adapter.state().status).toBe('CONNECTED');
  });

  it('WizeBot est NOT_SUPPORTED sans transport au lieu de simuler une panne', async () => {
    const absent = new WizeBotAdapter(null);
    expect((await absent.refresh()).status).toBe('NOT_SUPPORTED');
    const configured = new WizeBotAdapter({ apiBaseUrl: 'https://example.invalid', token: 'secret' });
    expect((await configured.refresh()).status).toBe('NOT_SUPPORTED');
  });

  it('WizeBot peut devenir CONNECTED via un transport vérifié injecté', async () => {
    const adapter = new WizeBotAdapter({ apiBaseUrl: 'https://api.example', token: 'secret' }, {
      status: async () => ({ name: 'Bot', connected: true }),
    });
    expect((await adapter.refresh()).status).toBe('CONNECTED');
  });

  it('Discord Soundboard distingue NOT_SUPPORTED de NOT_CONFIGURED', async () => {
    const unsupported = new DiscordSoundboardProvider(true);
    expect(unsupported.state().status).toBe('NOT_SUPPORTED');
    await expect(unsupported.sounds()).rejects.toMatchObject({ name: 'DISCORD_SOUNDBOARD_NOT_SUPPORTED' });

    const configuredTransport = { list: async () => [], play: async () => undefined };
    const unconfigured = new DiscordSoundboardProvider(false, configuredTransport);
    expect(unconfigured.state().status).toBe('NOT_CONFIGURED');
    await expect(unconfigured.sounds()).rejects.toMatchObject({ name: 'DISCORD_SOUNDBOARD_NOT_CONFIGURED' });
  });
});
