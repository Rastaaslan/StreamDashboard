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
  return {
    request,
    authHeaders,
    state: () => request('/api/v1/state', { headers: { authorization: `Device ${getCredential()}` } }),
    pair: payload => request('/api/v1/remote/pair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }),
    ticket: () => request('/api/v1/remote/ws-ticket', { method: 'POST', headers: authHeaders(), body: '{}' }),
    command: value => request('/api/v1/commands', { method: 'POST', headers: authHeaders(), body: JSON.stringify(value) }),
    searchTwitch: query => request(`/api/v1/twitch/categories?q=${encodeURIComponent(query)}`, { headers: { authorization: `Device ${getCredential()}` } }),
    updateTwitch: value => request('/api/v1/twitch/channel', { method: 'POST', headers: authHeaders(), body: JSON.stringify(value) }),
    createPlanning: value => request('/api/v1/planning', { method: 'POST', headers: authHeaders(), body: JSON.stringify(value) }),
    websocket: ticket => new WebSocket(isAndroidRuntime() ? websocketUrl(getServer(), ticket) : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/v1?ticket=${encodeURIComponent(ticket)}`),
  };
}
