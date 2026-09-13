import { CompanionMode } from './companion-store.js';

const clone = value => JSON.parse(JSON.stringify(value));
const allowedProviders = ['twitch', 'google'];
const cleanError = error => String(error?.message || error || 'Erreur provider').slice(0, 240);

export function twitchFingerprint(value) {
  const canonical = [value.title || '', value.startAtUtc || '', value.endAtUtc || '', value.twitchCategoryId || ''].map(part => String(part).trim()).join('\u001f');
  let hash = 2166136261;
  for (let index = 0; index < canonical.length; index += 1) hash = Math.imul(hash ^ canonical.charCodeAt(index), 16777619);
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function createNativeProviderAdapter(bridge = globalThis.StreamDashboardProviders) {
  const call = async (method, payload = {}) => {
    if (!bridge?.[method]) throw new Error('Provider autonome indisponible sur cet appareil.');
    const result = JSON.parse(await bridge[method](JSON.stringify(payload)));
    if (!result.ok) { const error = new Error(result.message || 'Erreur provider.'); error.code = result.code; error.current = result.current; throw error; }
    return result;
  };
  return {
    status: provider => call(`${provider}Status`), authorize: provider => call(`${provider}Authorize`), logout: provider => call(`${provider}Logout`),
    searchTwitch: query => call('twitchSearchCategories', { query }).then(value => value.items || []),
    mutate: (provider, action, event, link) => call(`${provider}${action[0].toUpperCase()}${action.slice(1)}Planning`, { event: clone(event), link: clone(link || {}) }),
  };
}

export function createStandaloneProviderSync({ store, adapter }) {
  const flights = new Map();
  const run = (key, work) => { if (flights.has(key)) return flights.get(key); const flight = Promise.resolve().then(work).finally(() => flights.delete(key)); flights.set(key, flight); return flight; };
  const syncProvider = (event, provider, action) => run(`${event.id}:${provider}`, async () => {
    const oldLink = event.providerLinks?.[provider] || {};
    store.updateProvider(event.id, provider, { ...oldLink, status: 'syncing', lastError: undefined });
    try {
      const result = await adapter.mutate(provider, action, event, oldLink);
      return store.updateProvider(event.id, provider, { status: action === 'delete' ? 'deleted' : 'synced', remoteId: result.remoteId || oldLink.remoteId, calendarId: result.calendarId || oldLink.calendarId, revision: result.revision, fingerprint: result.fingerprint, remoteSnapshot: result.remoteSnapshot, lastError: undefined });
    } catch (error) {
      const conflict = error.code === 'CONFLICT';
      store.updateProvider(event.id, provider, { ...oldLink, status: conflict ? 'conflict' : 'error', lastError: cleanError(error), remoteSnapshot: error.current });
      return { status: conflict ? 'conflict' : 'error', error };
    }
  });
  return {
    async apply(mode, event, action = event.providerLinks && Object.keys(event.providerLinks).length ? 'update' : 'create', onlyProvider) {
      if (mode !== CompanionMode.ONLINE_STANDALONE) return [];
      const desired = event.desiredPublication || {};
      const providers = (onlyProvider ? [onlyProvider] : allowedProviders).filter(provider => action === 'delete' ? event.providerLinks?.[provider]?.remoteId : desired[provider]);
      return Promise.all(providers.map(provider => syncProvider(event, provider, action)));
    },
    searchCategories(mode, query, recent, pcSearch) {
      if (mode === CompanionMode.ONLINE_PC) return pcSearch(query);
      if (mode === CompanionMode.ONLINE_STANDALONE) return adapter.searchTwitch(query);
      return Promise.resolve(recent);
    },
  };
}
