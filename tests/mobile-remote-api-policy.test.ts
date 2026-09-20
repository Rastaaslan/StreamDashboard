import { describe, expect, it } from 'vitest';
import { isRemoteApiAllowed } from '../apps/server/src/remote-api-policy.js';

describe('contrat API télécommande Mobile', () => {
  const allowed: Array<[string,string]> = [
    ['GET','/v1/state'],['GET','/v1/profile'],['GET','/v1/connections'],['GET','/v1/control-hub'],['GET','/v1/events'],
    ['PUT','/v1/profile/presentation'],['PUT','/v1/settings/live-control'],
    ['POST','/v1/obs/test'],
    ['GET','/v1/soundboard'],['POST','/v1/soundboard/play'],['POST','/v1/soundboard/volume'],['POST','/v1/soundboard/stop'],['PUT','/v1/soundboard/sounds/bonk'],
    ['GET','/v1/automations'],['GET','/v1/automations/capabilities'],['POST','/v1/automations'],['POST','/v1/automations/test'],['PUT','/v1/automations/a1'],['DELETE','/v1/automations/a1'],
    ['GET','/v1/supports'],
    ['POST','/v1/twitch/device'],['POST','/v1/twitch/disconnect'],['GET','/v1/twitch/categories'],['POST','/v1/twitch/channel'],
    ['GET','/v1/twitch/videos'],['DELETE','/v1/twitch/videos/123'],['GET','/v1/twitch/clips'],['POST','/v1/twitch/clips'],
    ['GET','/v1/twitch/chatters'],['POST','/v1/twitch/chat/messages'],['GET','/v1/twitch/moderation/capabilities'],
    ['DELETE','/v1/twitch/moderation/messages/msg_1'],['POST','/v1/twitch/moderation/bans'],['DELETE','/v1/twitch/moderation/bans/42'],
    ['POST','/v1/commands'],['POST','/v1/remote/ws-ticket'],
    ['POST','/v1/planning'],['PUT','/v1/planning/event-1'],['DELETE','/v1/planning/event-1'],['PUT','/v1/planning/event-1/occurrence'],['DELETE','/v1/planning/event-1/occurrence'],
    ['GET','/v1/discord/status'],['GET','/v1/discord/guilds'],['GET','/v1/discord/guilds/123/channels'],['PUT','/v1/discord/settings'],['POST','/v1/discord/planning'],
    ['POST','/v1/streamer-pings/ping-1/ack'],['POST','/v1/streamer-pings/ack-all'],
    ['POST','/v1/companion/sync'],['POST','/v1/companion/conflicts/op-1/resolve'],
  ];

  it.each(allowed)('autorise %s %s', (method,path) => {
    expect(isRemoteApiAllowed(method,path)).toBe(true);
  });

  it.each([
    ['POST','/v1/twitch/sync'],
    ['POST','/v1/google/sync'],
    ['PUT','/v1/profile'],
    ['POST','/v1/profile/import'],
    ['GET','/v1/profile/export'],
    ['PUT','/v1/discord/token'],
    ['POST','/v1/google/oauth/start'],
    ['GET','/v1/google/calendars'],
  ])('garde %s %s hors du périmètre télécommande', (method,path) => {
    expect(isRemoteApiAllowed(method,path)).toBe(false);
  });
});
