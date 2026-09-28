import { publicationContent } from './shared/publication-content.js';
import { providerError, providerDiagnostic, capabilityAvailability } from './provider-diagnostics.js';
import { CompanionMode } from './companion-store.js';

const clone = value => JSON.parse(JSON.stringify(value));
const allowedProviders = ['twitch', 'google'];
const cleanError = error => providerError(error?.code);

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
    if (!result.ok) { const error = new Error(providerError(result.code)); error.code = result.code; error.current = result.current; error.nonCreation = result.nonCreation === true; throw error; }
    return result;
  };
  return {
    test: provider => call(`${provider}Test`),
    status: provider => call(`${provider}Status`), authorize: provider => call(`${provider}Authorize`), logout: provider => call(`${provider}Logout`),
    searchTwitch: query => call('twitchSearchCategories', { query }).then(value => value.items || []),
    reconcile: (provider, event, link) => call(`${provider}ReconcilePlanning`, { event: clone(event), link: clone(link || {}) }),
    mutate: async (provider, action, event, link) => {
      let snapshot;
      try { snapshot = providerDiagnostic(await call(`${provider}Test`)); }
      catch (error) { error.mutationNotStarted = true; throw error; }
      const permission = capabilityAvailability(snapshot, provider === 'google' ? 'calendar' : 'schedule');
      if (!permission.available) { const error = new Error(permission.reason); error.code = snapshot.code || (snapshot.requiresReauth || !snapshot.connected ? 'REAUTH_REQUIRED' : snapshot.tested ? 'SCOPES' : 'NETWORK'); error.mutationNotStarted = true; throw error; }
      try {
        return await call(`${provider}${action[0].toUpperCase()}${action.slice(1)}Planning`, { event: clone(event), link: clone(link || {}) });
      } catch (error) {
        // Older bridges expose rejection codes without explicit non-creation evidence.
        // Never classify timeouts, 5xx, malformed success or identity conflicts as safe.
        if (action === 'create' && ['INVALID_PAYLOAD', 'INVALID_LINK', 'REAUTH_REQUIRED',
          'HTTP_400', 'HTTP_401', 'HTTP_403', 'HTTP_404', 'HTTP_405', 'HTTP_410',
          'HTTP_412', 'HTTP_413', 'HTTP_415', 'HTTP_422', 'HTTP_429'].includes(error.code)) error.nonCreation = true;
        // Also supports installed native bridges predating idempotent DELETE.
        // This only handles the mutation response, never a failed preflight.
        if (action === 'delete' && (error.code === 'HTTP_404' || (provider === 'google' && error.code === 'HTTP_410')))
          return { remoteId: link?.remoteId, calendarId: link?.calendarId };
        throw error;
      }
    },
  };
}

export function createStandaloneProviderSync({ store, adapter }) {
  const flights = new Map();
  const run = (key, work) => { if (flights.has(key)) return flights.get(key); const flight = Promise.resolve().then(work).finally(() => flights.delete(key)); flights.set(key, flight); return flight; };
  const syncProvider = (event, provider, action) => run(`${event.id}:${provider}`, async () => {
    const requestedDelete = action === 'delete';
    // A shared flight drains the latest durable intent, including edits made
    // while native I/O is pending. Re-read identity before choosing create/update.
    for (;;) {
      const snapshot = store.snapshot();
      const current = snapshot.planning.find(item => item.id === event.id);
      const deleted = snapshot.tombstones.find(item => (item.eventId || item.id) === event.id);
      if (current) event = current;
      const oldLink = (current || deleted || event).providerLinks?.[provider] || {};
      action = requestedDelete || deleted || !(current || event).desiredPublication?.[provider] ? 'delete' : oldLink.remoteId ? 'update' : 'create';
      if (oldLink.uncertainCreate && !oldLink.remoteId) {
        try {
          if (!adapter.reconcile) throw new Error('Réconciliation provider indisponible. Reconnectez le provider sur le Desktop.');
          const recovered = await adapter.reconcile(provider, oldLink.uncertainCreate.event, oldLink);
          if (!recovered?.remoteId) throw new Error('Création distante incertaine : aucune identité unique retrouvée. Réconciliez avant de republier.');
          store.updateProvider(event.id, provider, { ...recovered, status: 'synced', uncertainCreate: null,
            publishedContent: oldLink.uncertainCreate.publishedContent, lastError: null });
          const latest = store.snapshot().planning.find(item => item.id === event.id);
          if (!requestedDelete && latest && publicationContent(latest, provider) === oldLink.uncertainCreate.publishedContent)
            return store.snapshot().planning.find(item => item.id === event.id).providerLinks[provider];
          continue;
        } catch (error) {
          store.updateProvider(event.id, provider, { status: 'error', lastError: error.message });
          return { status: 'error', error };
        }
      }
      if (action === 'delete' && !oldLink.remoteId) return oldLink;
      const publishedContent = publicationContent(event, provider);
      if ((action !== 'delete' && oldLink.deletedRemotely) || (oldLink.status === 'conflict' && oldLink.remoteId)) {
        return { status: 'conflict', error: new Error('Conflit ou suppression distante : résolution explicite requise.') };
      }
      // Android bridges publish single events only. Never mark a partially published
      // local series as synced, including retries initiated from an occurrence.
      if (action !== 'delete' && (event.recurrence || event.seriesId || event.occurrenceKey)) {
        const error = new Error(`La récurrence locale ne peut pas encore être représentée fidèlement sur ${provider}. L’événement local est conservé.`);
        store.updateProvider(event.seriesId || event.id, provider, { status: 'error', lastError: error.message });
        return { status: 'error', error };
      }
      const uncertainCreate = action === 'create' ? {
        event: Object.fromEntries(Object.entries(event).filter(([key]) => !['providerLinks', 'providers', 'conflict'].includes(key))),
        publishedContent,
      } : null;
      // Durable before native I/O. Process death and response loss have the same
      // recovery path; neither permits a second blind CREATE.
      store.updateProvider(event.id, provider, { ...oldLink, uncertainCreate, createNotStarted: false, status: 'syncing', lastError: null });
      try {
        const result = await adapter.mutate(provider, action, event, oldLink);
        if (action === 'create' && !result.remoteId) throw new Error('Création acceptée sans identité distante.');
        const completed = store.updateProvider(event.id, provider, { publishedContent, uncertainCreate: null, createNotStarted: false, status: action === 'delete' ? 'deleted' : 'synced', remoteId: result.remoteId || oldLink.remoteId, calendarId: result.calendarId || oldLink.calendarId, revision: result.revision ?? oldLink.revision, fingerprint: result.fingerprint ?? oldLink.fingerprint, remoteSnapshot: result.remoteSnapshot ?? oldLink.remoteSnapshot, lastError: null,
          ...(action === 'delete' ? { remoteId: null, revision: null, remoteRevision: null, fingerprint: null, remoteSnapshot: null, deletedRemotely: false } : {}) });
        const latest = store.snapshot().planning.find(item => item.id === event.id);
        if (action === 'delete') {
          if (requestedDelete || !latest?.desiredPublication?.[provider]) return completed;
          // Publication was enabled again during DELETE. The cleared identity
          // makes the next iteration a create, never an update of a deleted ID.
        } else if (latest && publicationContent(latest, provider) === publishedContent) return completed;
        // The ID from the completed create is durable before we publish the edit.
        // No second create, and no success for content that has not been sent.
      } catch (error) {
        const conflict = error.code === 'CONFLICT';
        const notCreated = error.mutationNotStarted === true || error.nonCreation === true;
        store.updateProvider(event.id, provider, { ...oldLink, uncertainCreate: notCreated ? null : uncertainCreate, createNotStarted: action === 'create' && notCreated, status: conflict ? 'conflict' : 'error', lastError: uncertainCreate && !notCreated ? 'Création distante incertaine. Réconciliez le provider avant de republier.' : cleanError(error), remoteSnapshot: error.current });
        return { status: conflict ? 'conflict' : 'error', error };
      }
    }
  });
  return {
    async apply(mode, event, action, onlyProvider) {
      if (onlyProvider && !allowedProviders.includes(onlyProvider)) throw new Error('Provider inconnu.');
      if (mode !== CompanionMode.ONLINE_STANDALONE) return [];
      const desired = event.desiredPublication || {};
      const providers = (onlyProvider ? [onlyProvider] : allowedProviders).filter(provider => action === 'delete' ? (event.providerLinks?.[provider]?.remoteId || event.providerLinks?.[provider]?.uncertainCreate) : desired[provider] || event.providerLinks?.[provider]?.remoteId || event.providerLinks?.[provider]?.uncertainCreate || flights.has(`${event.id}:${provider}`));
      return Promise.all(providers.map(provider => {
        // A successful link on one provider says nothing about another provider.
        // Failed creates have a status entry but still need a remote ID before update.
        const providerAction = action === 'delete' ? 'delete' : event.providerLinks?.[provider]?.remoteId ? 'update' : 'create';
        return syncProvider(event, provider, providerAction);
      }));
    },
    searchCategories(mode, query, recent, pcSearch) {
      if (mode === CompanionMode.ONLINE_PC) return pcSearch(query);
      if (mode === CompanionMode.ONLINE_STANDALONE) return adapter.searchTwitch(query);
      return Promise.resolve(recent);
    },
  };
}
