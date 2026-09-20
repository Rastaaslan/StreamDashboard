const GET_EXACT = new Set([
  '/v1/state','/v1/profile','/v1/connections','/v1/control-hub','/v1/events','/v1/soundboard',
  '/v1/automations','/v1/automations/capabilities','/v1/supports','/v1/twitch/categories',
  '/v1/twitch/videos','/v1/twitch/clips','/v1/twitch/chatters','/v1/twitch/moderation/capabilities',
  '/v1/discord/status','/v1/discord/guilds',
]);

const PUT_EXACT = new Set([
  '/v1/profile/presentation','/v1/settings/live-control','/v1/discord/settings',
]);

const POST_EXACT = new Set([
  '/v1/commands','/v1/remote/ws-ticket','/v1/obs/test',
  '/v1/soundboard/play','/v1/soundboard/volume','/v1/soundboard/stop',
  '/v1/twitch/device','/v1/twitch/disconnect',
  '/v1/automations','/v1/automations/test',
  '/v1/twitch/channel','/v1/twitch/chat/messages','/v1/twitch/clips','/v1/twitch/moderation/bans',
  '/v1/planning','/v1/companion/sync','/v1/discord/planning','/v1/streamer-pings/ack-all',
]);

export function isRemoteApiAllowed(method: string, pathName: string) {
  const verb = method.toUpperCase();
  if (verb === 'GET') {
    return GET_EXACT.has(pathName)
      || /^\/v1\/discord\/guilds\/\d+\/channels$/.test(pathName);
  }
  if (verb === 'PUT') {
    return PUT_EXACT.has(pathName)
      || /^\/v1\/planning\/[^/]+(?:\/occurrence)?$/.test(pathName)
      || /^\/v1\/soundboard\/sounds\/[A-Za-z0-9._:-]+$/.test(pathName)
      || /^\/v1\/automations\/[A-Za-z0-9._:-]+$/.test(pathName);
  }
  if (verb === 'DELETE') {
    return /^\/v1\/planning\/[^/]+(?:\/occurrence)?$/.test(pathName)
      || /^\/v1\/twitch\/videos\/\d+$/.test(pathName)
      || /^\/v1\/twitch\/moderation\/(?:messages|bans)\/[A-Za-z0-9_-]+$/.test(pathName)
      || /^\/v1\/automations\/[A-Za-z0-9._:-]+$/.test(pathName);
  }
  if (verb === 'POST') {
    return POST_EXACT.has(pathName)
      || /^\/v1\/companion\/conflicts\/[^/]+\/resolve$/.test(pathName)
      || /^\/v1\/streamer-pings\/[^/]+\/ack$/.test(pathName);
  }
  return false;
}

export const remoteApiPolicySnapshot = {
  get: [...GET_EXACT],
  put: [...PUT_EXACT],
  post: [...POST_EXACT],
} as const;
