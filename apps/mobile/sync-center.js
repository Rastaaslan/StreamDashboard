import { CompanionMode } from './companion-store.js';

export const providerNames = { twitch: 'Twitch', google: 'Google' };
export const statusNames = { synced: 'Synchronisé', syncing: 'Synchronisation…', pending: 'En attente', error: 'Erreur', conflict: 'Conflit', deleted: 'Supprimé', 'not-published': 'Non publié' };
export function modeDescription(mode, nativeAvailable = false) {
  if (mode === CompanionMode.ONLINE_PC) return { label: 'PC connecté', available: 'Planning, publications, contrôles OBS et sons via le PC.' };
  if (mode === CompanionMode.ONLINE_STANDALONE) return { label: 'Standalone Android', available: nativeAvailable ? 'Planning, notes et préparation disponibles. Publications via les comptes Android. OBS et sons nécessitent le PC.' : 'Planning, notes et préparation en local. Publications autonomes disponibles dans l’application Android. OBS et sons nécessitent le PC.' };
  return { label: 'Hors ligne', available: 'Planning, notes et préparation en local. Modifications conservées pour la prochaine synchronisation. Publications, OBS et sons indisponibles.' };
}
export function eventProviderState(item, provider, mode) {
  const link = (mode === CompanionMode.ONLINE_PC ? item.providers?.[provider] || item.providerLinks?.[provider] : item.providerLinks?.[provider] || item.providers?.[provider]) || {};
  const status = link.deletedRemotely ? 'deleted' : item.conflict?.provider === provider ? 'conflict' : link.status || (item.desiredPublication?.[provider] ? 'pending' : 'not-published');
  return { ...link, status, label: statusNames[status] || status, retryable: Boolean(link.deletedRemotely) || ['error', 'conflict'].includes(status), syncSucceeded: !link.deletedRemotely && ['synced', 'deleted'].includes(status) };
}
export function syncSummary(cache, items, mode) {
  const events = [...(items || cache.planning), ...(cache.tombstones.map(item => ({ ...item, id: item.eventId || item.id, deleted: true })))];
  const entries = events.flatMap(item => Object.keys(providerNames).map(provider => ({ item, provider, ...eventProviderState(item, provider, mode) })));
  // A remote deletion discovered as an error is not a successful publication.
  const dates = entries.filter(entry => entry.syncSucceeded).flatMap(entry => [entry.lastSyncedAt, entry.lastProviderSyncAt]).filter(Boolean);
  return { entries, pending: cache.pending.length, providerPending: entries.filter(entry => ['pending', 'syncing'].includes(entry.status)).length, conflicts: cache.conflicts.length + entries.filter(entry => entry.status === 'conflict').length, lastSync: [cache.lastServerSyncAt, ...dates].filter(Boolean).sort().at(-1) || null };
}
export function createProviderRetry({ getMode, nativeAvailable, pcRetry, standaloneRetry }) {
  const flights = new Map();
  return (item, provider) => {
    if (!Object.hasOwn(providerNames, provider)) return Promise.reject(new Error('Provider inconnu.'));
    const mode = getMode();
    if (mode === CompanionMode.OFFLINE) return Promise.reject(new Error('Hors ligne : reconnectez-vous pour réessayer.'));
    if (mode === CompanionMode.ONLINE_STANDALONE && !nativeAvailable()) return Promise.reject(new Error('Publication autonome disponible dans l’application Android.'));
    const id = item.seriesId || item.id;
    const key = `${id}:${provider}`;
    if (flights.has(key)) return flights.get(key);
    const flight = Promise.resolve().then(() => mode === CompanionMode.ONLINE_PC ? pcRetry(id, provider) : standaloneRetry(item, provider)).finally(() => flights.delete(key));
    flights.set(key, flight);
    return flight;
  };
}
