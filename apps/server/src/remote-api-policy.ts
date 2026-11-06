import type { DeckAction } from '../../../packages/contracts/src/control.js';
import { actionCapability } from '../../mobile/shared/action-definition.js';
import type { DevicePermission } from '../../mobile/shared/device-permissions.js';
const GET_EXACT = new Set([
  '/v1/streamcockpit-context',
  '/v1/twitch/advanced/capabilities','/v1/twitch/advanced/moderation/held','/v1/twitch/advanced/prediction','/v1/twitch/advanced/prediction/reconcile','/v1/twitch/advanced/prediction/end/inspect','/v1/streamcockpit-health','/v1/streamcockpit-mixer','/v1/streamcockpit-mixer/routing','/v1/state','/v1/profile','/v1/connections','/v1/control-hub','/v1/events','/v1/soundboard',
  '/v1/automations','/v1/automations/capabilities','/v1/streamlabs/events','/v1/supports','/v1/twitch/categories',
  '/v1/dji/overview','/v1/spotify/status','/v1/twitch/videos','/v1/twitch/clips','/v1/twitch/chatters','/v1/twitch/chat/state','/v1/twitch/moderation/capabilities',
  '/v1/discord/status','/v1/discord/guilds',
]);

/** Full configuration is granted only by a new, explicit host pairing; legacy credentials stay limited. */
export function isManagementApiAllowed(method: string, path: string) {
  if(method==='POST'&&path==='/v2/sounds/export')return true;
  if(method==='POST'&&path==='/v2/planning/handoff')return true;
  if ((method === 'GET' && path === '/v2/autonomy') || (method === 'POST' && path === '/v2/autonomy/sync')) return true;
  if (path.startsWith('/v2/')) return isRemoteApiAllowed(method, path);
  const routes: Record<string, string[]> = {
    GET: ['/v1/profile','/v1/google/calendars','/v1/google/oauth/config','/v1/soundboard/obs/status','/v1/supports/streamlabs/oauth/status','/v1/supports/streamlabs/history/status','/v1/wizebot'],
    PUT: ['/v1/supports/streamlabs/oauth/config','/v1/profile','/v1/google/target','/v1/discord/token','/v1/supports/streamlabs/config','/v1/supports/streamlabs/history/config','/v1/wizebot/config','/v1/soundboard/catalog'],
    POST: ['/v1/google/oauth/config','/v1/google/oauth/start','/v1/google/sync','/v1/profile/import','/v1/soundboard/obs/setup','/v1/soundboard/sounds','/v1/supports/streamlabs/oauth/start','/v1/supports/streamlabs/oauth/config'],
    DELETE: ['/v1/google/oauth/config','/v1/discord/token','/v1/supports/streamlabs/config','/v1/supports/streamlabs/history/config','/v1/wizebot/config'],
  };
  return (routes[method]?.includes(path) ?? false) || (method === 'DELETE' && /^\/v1\/soundboard\/sounds\/[A-Za-z0-9_-]+$/.test(path));
}

const PUT_EXACT = new Set([
  '/v1/profile/presentation','/v1/settings/live-control','/v1/discord/settings',
]);

const POST_EXACT = new Set([
  '/v1/streamcockpit-mixer/control/preview','/v1/streamcockpit-mixer/control/confirm',
  '/v1/spotify/control','/v1/dji/telemetry','/v1/commands','/v1/remote/ws-ticket','/v1/obs/test',
  '/v1/soundboard/play','/v1/soundboard/volume','/v1/soundboard/stop',
  '/v1/twitch/device','/v1/twitch/disconnect','/v1/google/disconnect',
  '/v1/automations','/v1/automations/test',
  '/v1/twitch/channel','/v1/twitch/tags/suggest','/v1/twitch/chat/messages','/v1/twitch/clips','/v1/twitch/moderation/bans',
  '/v1/twitch/advanced/moment/preview','/v1/twitch/advanced/moment/confirm',
  '/v1/twitch/advanced/moderation/preview','/v1/twitch/advanced/moderation/confirm',
  '/v1/twitch/advanced/moderation/held-action/preview','/v1/twitch/advanced/moderation/held-action/confirm',
  '/v1/twitch/advanced/poll/preview','/v1/twitch/advanced/poll/confirm',
  '/v1/twitch/advanced/prediction/preview','/v1/twitch/advanced/prediction/confirm',
  '/v1/twitch/advanced/prediction/reconcile/preview','/v1/twitch/advanced/prediction/reconcile/confirm',
  '/v1/twitch/advanced/prediction/lock/preview','/v1/twitch/advanced/prediction/lock/confirm',
  '/v1/twitch/advanced/prediction/end/preview','/v1/twitch/advanced/prediction/end/confirm',
  '/v1/twitch/advanced/shoutout/preview','/v1/twitch/advanced/shoutout/confirm',
    '/v1/twitch/advanced/raid/preview','/v1/twitch/advanced/raid/confirm',
  '/v1/planning','/v1/companion/sync','/v1/discord/planning','/v1/streamer-pings/ack-all',
]);

export function isRemoteApiAllowed(method: string, pathName: string) {
  const verb = method.toUpperCase();
  if (verb === 'HEAD' && ['/v1/streamcockpit-health', '/v1/streamcockpit-mixer', '/v1/twitch/advanced/capabilities'].includes(pathName)) return true;
  if (verb === 'GET' && /^\/v1\/twitch\/advanced\/moderation\/viewer\/\d{1,30}$/.test(pathName)) return true;
  if (verb === 'GET' && /^\/v1\/streamcockpit-mixer\/control\/status\/[0-9a-f-]{36}$/i.test(pathName)) return true;
  if (verb === 'GET' && ['/v1/streamcockpit-moments/manual/context','/v1/streamcockpit-moments/manual/scheduled'].includes(pathName)) return true;
  if (verb === 'POST' && pathName === '/v1/streamcockpit-moments/manual/scheduled/select') return true;
  if (verb === 'POST' && pathName === '/v1/streamcockpit-moments/manual/add') return true;
  if (verb === 'GET' && /^\/v1\/streamcockpit-moments\/manual\/status\/[0-9a-f-]{36}$/i.test(pathName)) return true;
  if (verb === 'GET' && /^\/v1\/twitch\/advanced\/moment\/status\/[0-9a-f-]{36}$/i.test(pathName)) return true;
  if (['GET','HEAD'].includes(verb) && (pathName === '/v1/streamcockpit-moments' ||
      /^\/v1\/streamcockpit-moments\/[A-Za-z0-9_-]{1,128}$/.test(pathName))) return true;
  // Paired clients own the shared control surface. OAuth secrets remain on the host.
  if (verb === 'GET' && ['/v2/device','/v2/wizebot/catalog','/v2/state','/v2/replay','/v2/outputs'].includes(pathName)) return true;
  if (verb === 'PUT' && ['/v2/configuration','/v2/settings'].includes(pathName)) return true;
  if (verb === 'POST' && ['/v2/wizebot/refresh','/v2/wizebot/import','/v2/wizebot/edit','/v2/actions','/v2/planning','/v2/sounds/upload'].includes(pathName)) return true;
  if (['PUT','DELETE'].includes(verb) && /^\/v2\/planning\/[^/]+(?:\/occurrence)?$/.test(pathName)) return true;
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
      || /^\/v1\/planning\/[^/]+\/(?:retry|conflict)\/(?:twitch|google)$/.test(pathName)
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

/** Explicit permissions supplement the existing legacy/management allowlists. */
export function requiredDevicePermissions(method:string,path:string,body:unknown,actions:DeckAction[]=[]):DevicePermission[] {
  if(path==='/v1/streamcockpit-context')return ['observe'];
  if(path.startsWith('/v1/streamcockpit-mixer/control/'))return ['observe','obs','audio'];
  if(path==='/v1/twitch/advanced/capabilities')return ['chat'];
  if(method==='GET'&&(path==='/v1/twitch/advanced/moderation/held'||
    /^\/v1\/twitch\/advanced\/moderation\/viewer\/\d{1,30}$/.test(path)))return ['chat','cloud'];
  if(method==='GET'&&['/v1/twitch/advanced/prediction','/v1/twitch/advanced/prediction/reconcile','/v1/twitch/advanced/prediction/end/inspect'].includes(path))return ['chat','cloud'];
  if(method==='POST'&&['/v1/twitch/advanced/moment/preview','/v1/twitch/advanced/moment/confirm'].includes(path))return ['chat','cloud','clips'];
  if(method==='GET'&&/^\/v1\/twitch\/advanced\/moment\/status\/[0-9a-f-]{36}$/i.test(path))return ['chat','cloud','clips'];
  if(method==='POST'&&[
    '/v1/twitch/advanced/moderation/preview','/v1/twitch/advanced/moderation/confirm',
    '/v1/twitch/advanced/moderation/held-action/preview','/v1/twitch/advanced/moderation/held-action/confirm',
    '/v1/twitch/advanced/poll/preview','/v1/twitch/advanced/poll/confirm',
    '/v1/twitch/advanced/prediction/preview','/v1/twitch/advanced/prediction/confirm',
    '/v1/twitch/advanced/prediction/reconcile/preview','/v1/twitch/advanced/prediction/reconcile/confirm',
    '/v1/twitch/advanced/prediction/lock/preview','/v1/twitch/advanced/prediction/lock/confirm',
    '/v1/twitch/advanced/prediction/end/preview','/v1/twitch/advanced/prediction/end/confirm',
    '/v1/twitch/advanced/shoutout/preview','/v1/twitch/advanced/shoutout/confirm',
    '/v1/twitch/advanced/raid/preview','/v1/twitch/advanced/raid/confirm',
  ].includes(path))return ['chat','cloud'];
  if(path==='/v1/streamcockpit-health'||path==='/v1/streamcockpit-mixer'||(method==='GET'&&path==='/v1/streamcockpit-mixer/routing'))return ['observe'];
  if(method==='GET'&&['/v1/streamcockpit-moments/manual/context','/v1/streamcockpit-moments/manual/scheduled'].includes(path))return ['observe','clips'];
  if(method==='POST'&&path==='/v1/streamcockpit-moments/manual/scheduled/select')return ['observe','clips'];
  if(method==='POST'&&path==='/v1/streamcockpit-moments/manual/add')return ['observe','clips'];
  if(method==='GET'&&/^\/v1\/streamcockpit-moments\/manual\/status\/[0-9a-f-]{36}$/i.test(path))return ['observe','clips'];
  if(path==='/v1/streamcockpit-moments'||/^\/v1\/streamcockpit-moments\/[A-Za-z0-9_-]{1,128}$/.test(path))return ['observe'];
  if(path==='/v2/sounds/export')return ['configuration','audio'];
  if(path==='/v2/planning/handoff')return ['configuration','planning'];
  const value=body as {action?:string;type?:string}|undefined;
  if(path==='/v2/actions') {
    const type=actions.find(a=>a.id===value?.action)?.type||value?.action||'';
    if(type.startsWith('live.'))return ['obs','cloud'];
    if(type.startsWith('metadata.'))return ['cloud'];
    return [actionCapability(type as DeckAction['type']) as DevicePermission];
  }
  // Legacy commands can combine several effects. Limited devices use the
  // typed v2 actions; legacy callers retain their explicitly granted full set.
  if(path==='/v1/commands'||path.includes('/automations')||(method!=='GET'&&/\/autonomy|\/profile|\/configuration|\/settings/.test(path)))return ['configuration'];
  if(path==='/v1/spotify/control'||path==='/v1/dji/telemetry')return ['audio'];
  if(/\/soundboard|\/sounds/.test(path))return ['audio'];
  if(/\/replay/.test(path))return ['clips'];
  if(/\/obs|\/outputs/.test(path))return ['obs'];
  if(/\/chat(?:\/|$)|\/moderation|\/wizebot/.test(path))return ['chat'];
  if(/\/planning|\/google|\/companion/.test(path))return ['planning'];
  if(/\/twitch|\/youtube|\/streamlabs|\/supports|\/discord/.test(path))return ['cloud'];
  return method==='GET'||path==='/v1/remote/ws-ticket'?['observe']:['configuration'];
}
