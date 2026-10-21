import { installationEndpoint } from '../shared/installation.js';

const prefix = 'endpoint-link:';
const fail = message => { throw new Error(message); };
const remoteScope = value => typeof value === 'string' && /^https?:\/\//.test(value);
export const replicaLinkKey = endpoint => prefix + installationEndpoint(endpoint);

export function replicaLocation(scope, link) {
  if (!link) return {scope};
  if (link.version !== 1 || link.kind !== 'endpoint-link' || !remoteScope(link.scope) ||
      typeof link.workspace !== 'string' || !link.workspace || link.workspace.startsWith('local:')) {
    fail('Association de copie locale illisible. Les données sont conservées.');
  }
  return {scope:installationEndpoint(link.scope), workspace:link.workspace};
}

// All callers resolve the link inside their data transaction. A window opened
// before an address change therefore keeps writing to the same physical record.
export function locateReplica(table, scope, done, onError) {
  if (!remoteScope(scope)) { done({scope}); return; }
  const request = table.get(replicaLinkKey(scope));
  request.onsuccess = () => { try { done(replicaLocation(scope, request.result)); } catch (error) { onError(error); } };
}

export function planReplicaLink(entries, endpoint, response, deviceId, knownDevices = []) {
  const origin = installationEndpoint(endpoint), workspace = response?.workspace;
  if (typeof workspace !== 'string' || !workspace || workspace.length > 200 || workspace.startsWith('local:') || !response.bundle || typeof response.bundle !== 'object') fail('Identité de l’espace distant invalide.');
  if (deviceId !== undefined && (typeof deviceId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(deviceId))) fail('Identité physique invalide.');
  const records = new Map(entries), key = replicaLinkKey(origin), previous = records.get(key);
  if (previous && (replicaLocation(origin, previous).workspace !== workspace || (previous.deviceId && deviceId && previous.deviceId !== deviceId))) fail('Cette adresse appartient à une autre identité. Sa copie locale est conservée ; utilisez une adresse distincte pour le nouvel appareil.');
  const direct = records.get(origin);
  if (direct?.workspace && direct.workspace !== workspace) fail('Cette adresse contient la copie d’un autre espace. Elle ne sera pas remplacée.');
  const links = entries.filter(([name, value]) => name.startsWith(prefix) && value.workspace === workspace);
  if (links.some(([, value]) => value.deviceId && deviceId && value.deviceId !== deviceId)) fail('Cet espace est déjà associé à un autre appareil physique. Vérifiez la copie ou la restauration de ses données.');
  const candidates = entries.filter(([name, value]) => remoteScope(name) && value.workspace === workspace && value.bundle);
  // Several independently edited pre-2.1 copies need explicit reconciliation;
  // silently selecting one would hide drafts and pending provider changes.
  if (candidates.length > 1) fail('Plusieurs copies locales de cet espace existent. Exportez-les avant de réconcilier leurs modifications ; aucune copie n’a été supprimée.');
  const scope = candidates[0]?.[0] || previous?.scope || links[0]?.[1].scope || origin;
  const known = knownDevices.find(device => device.endpoint === scope);
  if (deviceId && known?.id && !known.id.startsWith('legacy-') && known.id !== deviceId) fail('La copie locale appartient à un autre appareil physique connu. Vérifiez la restauration de cet espace.');
  const link = {version:1, kind:'endpoint-link', scope, workspace, ...(deviceId || previous?.deviceId ? {deviceId:deviceId || previous.deviceId} : {})};
  replicaLocation(origin, link);
  return {key, link, scope, seed:!records.get(scope)?.bundle};
}

export function openReplicaDatabase(factory = globalThis.indexedDB) {
  if (!factory) return Promise.reject(new Error('Le stockage local est indisponible. Aucun enregistrement hors ligne ne sera annoncé.'));
  return new Promise((resolve, reject) => {
    const request = factory.open('streamdashboard-autonomy-v1', 2);
    request.onupgradeneeded = () => { for (const name of ['replicas', 'assets']) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Call only after an authenticated read of /autonomy and /device. The new
 * origin shares the original record; credentials and trust pins never move. */
export async function linkReplicaEndpoint(endpoint, response, deviceId, knownDevices = [], factory = globalThis.indexedDB) {
  const db = await openReplicaDatabase(factory);
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('replicas', 'readwrite'), table = tx.objectStore('replicas');
      const entries = [], request = table.openCursor(); let result;
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) { entries.push([cursor.key, cursor.value]); cursor.continue(); return; }
        try {
          result = planReplicaLink(entries, endpoint, response, deviceId, knownDevices);
          if (result.seed) table.put({version:1, workspace:response.workspace, bundle:structuredClone(response.bundle), pending:[], lastSync:null, drafts:{}}, result.scope);
          table.put(result.link, result.key);
        } catch (error) { tx.abort(); reject(error); }
      };
      tx.oncomplete = () => resolve(result.scope);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Changement d’adresse annulé. Les copies locales sont conservées.'));
    });
  } finally { db.close(); }
}
