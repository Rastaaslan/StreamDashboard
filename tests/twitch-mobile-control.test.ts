import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../apps/mobile/index.html', import.meta.url), 'utf8');
const mobile = readFileSync(new URL('../apps/mobile/mobile.js', import.meta.url), 'utf8');
const transport = readFileSync(new URL('../apps/mobile/transport.js', import.meta.url), 'utf8');
const server = readFileSync(new URL('../apps/server/src/index.ts', import.meta.url), 'utf8');
const twitchClient = readFileSync(new URL('../integrations/twitch/src/client.ts', import.meta.url), 'utf8');

describe('Twitch Live Control mobile', () => {
  it('expose des outils mobiles dédiés au lieu de réduire le desktop', () => {
    expect(html).toContain('class="chat-primary"'); for (const panel of ['audience', 'vod']) expect(html).toContain(`data-live-panel="${panel}"`);
    expect(html).toContain('dans le chat');
    expect(html).not.toContain('liste des viewers');
  });

  it('attend les confirmations serveur pour le chat et les suppressions', () => {
    expect(mobile).toContain('await transport.sendTwitchChat');
    expect(mobile).toContain('Message confirmé par Twitch.');
    expect(mobile).toContain('await transport.deleteTwitchVideo');
    expect(mobile).toContain('Suppression définitive. Saisissez DELETE');
    expect(transport).toContain('confirmation: `DELETE ${id}`');
  });

  it('désactive les actions Twitch quand les scopes optionnels sont absents', () => {
    expect(mobile).toContain('ensureTwitchCapabilities');
    for (const capability of ['chatWrite','chatters','createClip','deleteVideo','updateChannel','schedule']) expect(mobile).toContain(capability);
    for (const scope of ['user:write:chat','moderator:read:chatters','clips:edit','channel:manage:videos','channel:manage:broadcast','channel:manage:schedule']) expect(mobile).toContain(scope);
    expect(mobile).toContain('Fonctions Twitch partielles · reconnecte Twitch');
  });

  it('garde les scopes Twitch optionnels réellement optionnels côté Runtime', () => {
    expect(server).toContain('twitchChatters = capabilities.chatters ? await twitch.chatters() : { items: [], total: 0, cursor: null }');
    expect(server).toContain('if (!capabilities.chatRead) chatStatus = \'DISCONNECTED\'');
    expect(server).toContain('capabilities.chatRead || capabilities.redemptions');
    expect(twitchClient).toContain('if (this.grantedScopes.has(CHAT_READ_SCOPE)) await this.subscribeChat(sessionId)');
    expect(twitchClient).toContain('if (this.grantedScopes.has(REDEMPTIONS_SCOPE)) await this.subscribeRewardRedemptions(sessionId)');
  });

  it('conserve un message PC hors ligne explicite', () => {
    expect(mobile).toContain('PC hors ligne. Le message n’a pas été envoyé.');
    expect(mobile).toContain('PC hors ligne. Les VOD Twitch ne peuvent pas être chargées via le PC.');
  });
});
