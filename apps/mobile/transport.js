import { createCompanionStore } from './companion-store.js';
import { apiUrl, isAndroidRuntime, websocketUrl } from './runtime.js';

export const REQUEST_TIMEOUT_MS = 15_000;

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function createTransport(getServer, getCredential) {
  const url = path => isAndroidRuntime() ? apiUrl(getServer(), path) : path;
  const request = async (path, init = {}) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url(path), { ...init, signal: controller.signal });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new HttpError(response.status, body.error?.message || body.error || `HTTP ${response.status}`);
      return body;
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('Le PC ne répond pas dans le délai attendu.');
      throw error;
    } finally { clearTimeout(timeout); }
  };
  const authHeaders = () => ({ 'content-type': 'application/json', authorization: `Device ${getCredential()}` });
  const state = () => request('/api/v1/state', { headers: { authorization: `Device ${getCredential()}` } });
  const syncCompanion = value => request('/api/v1/companion/sync', { method: 'POST', headers: authHeaders(), body: JSON.stringify(value) });

  async function syncStore(store) {
    const deviceId = localStorage.getItem('streamdashboard.deviceId') || '';
    if (!deviceId) throw new Error('Identité de télécommande introuvable.');
    const cache = store.snapshot();
    const response = await syncCompanion({ schemaVersion: cache.schemaVersion, deviceId, lastKnownServerRevision: cache.serverRevision || 0, operations: cache.pending });
    store.applySyncResponse(response);
    return response;
  }

  async function planningFallback(id, value, remove = false) {
    const store = createCompanionStore();
    await syncStore(store);
    const current = store.snapshot().planning.find(item => item.id === id);
    if (!current) throw new Error('Créneau introuvable dans le cache synchronisé.');
    const result = remove ? store.deleteEvent(id, current.revision) : store.updateEvent(id, value, current.revision);
    if (result.conflict) throw new Error('Ce créneau a changé sur un autre appareil.');
    await syncStore(store);
    return state();
  }

  // The current server may reject PUT/DELETE remotely or the Android WebView may stop them at CORS.
  // In both cases the transactional companion POST remains authenticated and preserves revisions.
  const shouldFallbackPlanning = error => !(error instanceof HttpError) || error.status === 403;

  return {
    request,
    authHeaders,
    state,
    soundboard: () => request('/api/v1/soundboard', { headers: { authorization: `Device ${getCredential()}` } }),
    playSound: value => request('/api/v1/soundboard/play', { method: 'POST', headers: authHeaders(), body: JSON.stringify(value) }),
    stopSound: () => request('/api/v1/soundboard/stop', { method: 'POST', headers: authHeaders(), body: '{}' }),
    updateSound: (id, value) => request(`/api/v1/soundboard/sounds/${encodeURIComponent(id)}`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(value) }),
    automations: () => request('/api/v1/automations', { headers: { authorization: `Device ${getCredential()}` } }),
    createAutomation: value => request('/api/v1/automations', { method: 'POST', headers: authHeaders(), body: JSON.stringify(value) }),
    updateAutomation: (id, value) => request(`/api/v1/automations/${encodeURIComponent(id)}`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(value) }),
    deleteAutomation: id => request(`/api/v1/automations/${encodeURIComponent(id)}`, { method: 'DELETE', headers: authHeaders(), body: '{}' }),
    testAutomation: amountMinor => request('/api/v1/automations/test', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ amountMinor }) }),
    supports: () => request('/api/v1/supports', { headers: { authorization: `Device ${getCredential()}` } }),
    events: filters => request(`/api/v1/events?${new URLSearchParams(Object.entries(filters).filter(([, value]) => value))}`, { headers: { authorization: `Device ${getCredential()}` } }),
    twitchVideos: after => request(`/api/v1/twitch/videos${after ? `?after=${encodeURIComponent(after)}` : ''}`, { headers: { authorization: `Device ${getCredential()}` } }),
    deleteTwitchVideo: id => request(`/api/v1/twitch/videos/${encodeURIComponent(id)}`, { method: 'DELETE', headers: authHeaders(), body: JSON.stringify({ confirmation: `DELETE ${id}` }) }),
    twitchClips: after => request(`/api/v1/twitch/clips${after ? `?after=${encodeURIComponent(after)}` : ''}`, { headers: { authorization: `Device ${getCredential()}` } }),
    createTwitchClip: () => request('/api/v1/twitch/clips', { method: 'POST', headers: authHeaders(), body: '{}' }),
    twitchChatters: after => request(`/api/v1/twitch/chatters${after ? `?after=${encodeURIComponent(after)}` : ''}`, { headers: { authorization: `Device ${getCredential()}` } }),
    sendTwitchChat: value => request('/api/v1/twitch/chat/messages', { method: 'POST', headers: authHeaders(), body: JSON.stringify(value) }),
    twitchModerationCapabilities: () => request('/api/v1/twitch/moderation/capabilities', { headers: { authorization: `Device ${getCredential()}` } }),
    deleteTwitchMessage: id => request(`/api/v1/twitch/moderation/messages/${encodeURIComponent(id)}`, { method: 'DELETE', headers: authHeaders(), body: '{}' }),
    moderateTwitchUser: value => request('/api/v1/twitch/moderation/bans', { method: 'POST', headers: authHeaders(), body: JSON.stringify(value) }),
    unbanTwitchUser: userId => request(`/api/v1/twitch/moderation/bans/${encodeURIComponent(userId)}`, { method: 'DELETE', headers: authHeaders(), body: '{}' }),
    pair: payload => request('/api/v1/remote/pair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }),
    ticket: () => request('/api/v1/remote/ws-ticket', { method: 'POST', headers: authHeaders(), body: '{}' }),
    command: value => request('/api/v1/commands', { method: 'POST', headers: authHeaders(), body: JSON.stringify(value) }),
    searchTwitch: query => request(`/api/v1/twitch/categories?q=${encodeURIComponent(query)}`, { headers: { authorization: `Device ${getCredential()}` } }),
    updateTwitch: value => request('/api/v1/twitch/channel', { method: 'POST', headers: authHeaders(), body: JSON.stringify(value) }),
    createPlanning: value => request('/api/v1/planning', { method: 'POST', headers: authHeaders(), body: JSON.stringify(value) }),
    updatePlanning: async (id, value) => {
      try { return await request(`/api/v1/planning/${encodeURIComponent(id)}`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(value) }); }
      catch (error) { if (!shouldFallbackPlanning(error)) throw error; return planningFallback(id, value, false); }
    },
    deletePlanning: async (id, value = {}) => {
      try { return await request(`/api/v1/planning/${encodeURIComponent(id)}`, { method: 'DELETE', headers: authHeaders(), body: JSON.stringify(value) }); }
      catch (error) { if (!shouldFallbackPlanning(error)) throw error; return planningFallback(id, {}, true); }
    },
    updateOccurrence: (seriesId, occurrenceKey, patch) => request(`/api/v1/planning/${encodeURIComponent(seriesId)}/occurrence`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ occurrenceKey, patch }) }),
    deleteOccurrence: (seriesId, occurrenceKey) => request(`/api/v1/planning/${encodeURIComponent(seriesId)}/occurrence`, { method: 'DELETE', headers: authHeaders(), body: JSON.stringify({ occurrenceKey }) }),
    discordStatus: () => request('/api/v1/discord/status', { headers: { authorization: `Device ${getCredential()}` } }),
    discordGuilds: () => request('/api/v1/discord/guilds', { headers: { authorization: `Device ${getCredential()}` } }),
    discordChannels: guildId => request(`/api/v1/discord/guilds/${encodeURIComponent(guildId)}/channels`, { headers: { authorization: `Device ${getCredential()}` } }),
    discordSettings: value => request('/api/v1/discord/settings', { method: 'PUT', headers: authHeaders(), body: JSON.stringify(value) }),
    publishDiscord: value => request('/api/v1/discord/planning', { method: 'POST', headers: authHeaders(), body: JSON.stringify(value) }),
    syncCompanion,
    resolveCompanionConflict: (operationId, strategy) => request(`/api/v1/companion/conflicts/${encodeURIComponent(operationId)}/resolve`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ strategy }) }),
    websocket: ticket => new WebSocket(isAndroidRuntime() ? websocketUrl(getServer(), ticket) : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/v1?ticket=${encodeURIComponent(ticket)}`),
  };
}
