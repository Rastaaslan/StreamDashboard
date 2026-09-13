export const COMPANION_SCHEMA_VERSION = 2;
export const COMPANION_KEY = 'streamdashboard.companion.v2';
export const CompanionMode = Object.freeze({ ONLINE_PC: 'ONLINE_PC', ONLINE_STANDALONE: 'ONLINE_STANDALONE', OFFLINE: 'OFFLINE' });

const clone = value => JSON.parse(JSON.stringify(value));
const now = () => new Date().toISOString();
let uidSequence = 0;
const uid = prefix => `${prefix}-${Date.now().toString(36)}-${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}-${++uidSequence}`;
const empty = () => ({ schemaVersion: COMPANION_SCHEMA_VERSION, serverRevision: 0, planning: [], tombstones: [], pending: [], conflicts: [], notes: [], checklist: [], templates: [], recentTwitchCategories: [], streamerName: '', preferences: {}, lastServerSyncToken: null, lastServerSyncAt: null });

function migrate(value) {
  if (!value || typeof value !== 'object') return empty();
  const next = { ...empty(), ...value, schemaVersion: COMPANION_SCHEMA_VERSION };
  next.planning = Array.isArray(value.planning) ? value.planning.map(item => ({ revision: 1, updatedAt: now(), origin: 'PC', providerLinks: {}, ...item, id: item.id || item.localId || uid('live') })) : [];
  for (const key of ['tombstones', 'pending', 'notes', 'checklist', 'templates', 'recentTwitchCategories']) next[key] = Array.isArray(value[key]) ? value[key] : [];
  return next;
}

export function createCompanionStore(storage = localStorage, clock = now) {
  let data;
  try { data = migrate(JSON.parse(storage.getItem(COMPANION_KEY) || 'null')); } catch { data = empty(); }
  const persist = () => storage.setItem(COMPANION_KEY, JSON.stringify(data));
  const operation = (type, eventId, baseRevision, patch, desiredPublication, base) => ({ id: uid('op'), operationId: undefined, type, eventId, baseRevision, timestamp: clock(), patch: clone(patch || {}), base: clone(base || {}), desiredPublication: clone(desiredPublication || {}) });
  const saveEvent = (input, baseRevision) => {
    const index = data.planning.findIndex(item => item.id === input.id);
    const current = index < 0 ? null : data.planning[index];
    if (current && baseRevision !== undefined && current.revision !== baseRevision) return { conflict: true, current: clone(current), proposed: clone(input) };
    const item = { ...(current || {}), ...clone(input), id: input.id || uid('live'), revision: (current?.revision || 0) + 1, updatedAt: clock(), origin: 'ANDROID', providerLinks: { ...(current?.providerLinks || {}), ...(input.providerLinks || {}) } };
    if (index < 0) data.planning.push(item); else data.planning[index] = item;
    const patch = current ? Object.fromEntries(Object.entries(input).filter(([key, value]) => !['id', 'revision', 'updatedAt', 'origin', 'providerLinks'].includes(key) && JSON.stringify(current[key]) !== JSON.stringify(value))) : input;
    data.pending.push(operation(current ? 'update' : 'create', item.id, current?.revision || 0, patch, item.desiredPublication, current));
    persist(); return { item: clone(item) };
  };
  return {
    snapshot: () => clone(data),
    replaceServerSnapshot(snapshot) {
      const serverItems = (snapshot.planning || []).map(item => ({ revision: item.revision || 1, updatedAt: item.updatedAt || snapshot.at || clock(), origin: 'PC', providerLinks: item.providerLinks || {}, ...item }));
      const localById = new Map(data.planning.map(item => [item.id, item]));
      const tombstones = new Map(data.tombstones.map(item => [item.eventId || item.id, item]));
      for (const item of snapshot.tombstones || []) { const id = item.eventId || item.id; if (id && (!tombstones.has(id) || (tombstones.get(id).revision || 0) <= (item.revision || 0))) tombstones.set(id, { ...item, eventId: id }); }
      data.tombstones = [...tombstones.values()];
      const deleted = new Set(data.tombstones.map(item => item.eventId || item.id));
      data.planning = serverItems.filter(item => !deleted.has(item.id)).map(item => {
        const local = localById.get(item.id);
        return data.pending.some(op => op.eventId === item.id && op.type === 'update') && local ? local : item;
      });
      for (const item of localById.values()) if (!data.planning.some(value => value.id === item.id) && data.pending.some(op => op.eventId === item.id && op.type === 'create')) data.planning.push(item);
      data.checklist = clone(snapshot.checklist || data.checklist); data.notes = clone(snapshot.notes || data.notes); data.templates = clone(snapshot.templates || data.templates); data.serverRevision = snapshot.serverRevision || data.serverRevision; data.streamerName = snapshot.settings?.streamerName || data.streamerName;
      data.lastServerSyncAt = clock(); persist(); return clone(data);
    },
    createEvent(input) { return saveEvent({ ...input, id: input.id || uid('live') }, 0); },
    updateEvent(id, patch, baseRevision) { const current = data.planning.find(item => item.id === id); if (!current) throw new Error('Live introuvable.'); return saveEvent({ ...current, ...patch, id }, baseRevision); },
    deleteEvent(id, baseRevision) {
      const current = data.planning.find(item => item.id === id); if (!current) return { deleted: false };
      if (baseRevision !== undefined && current.revision !== baseRevision) return { conflict: true, current: clone(current), proposed: null };
      data.planning = data.planning.filter(item => item.id !== id); data.tombstones.push({ eventId: id, revision: current.revision + 1, deletedAt: clock(), providerLinks: clone(current.providerLinks || {}) });
      data.pending.push(operation('delete', id, current.revision, {}, current.desiredPublication)); persist(); return { deleted: true };
    },
    updateProvider(eventId, provider, metadata) {
      if (!['twitch', 'google'].includes(provider)) throw new Error('Provider inconnu.');
      const item = data.planning.find(value => value.id === eventId);
      const tombstone = data.tombstones.find(value => (value.eventId || value.id) === eventId);
      const target = item || tombstone;
      if (!target) throw new Error('Live introuvable.');
      target.providerLinks = { ...(target.providerLinks || {}), [provider]: { ...(target.providerLinks?.[provider] || {}), ...clone(metadata), lastProviderSyncAt: clock() } };
      persist(); return clone(target.providerLinks[provider]);
    },
    upsertCollection(kind, input) { if (!['notes', 'checklist', 'templates'].includes(kind)) throw new Error('Collection compagnon inconnue.'); const item = { revision: 1, updatedAt: clock(), ...clone(input), id: input.id || uid(kind.slice(0, -1)), revision: (input.revision || 0) + 1 }; const index = data[kind].findIndex(value => value.id === item.id); if (index < 0) data[kind].push(item); else data[kind][index] = item; data.pending.push(operation(`${kind}.upsert`, item.id, input.revision || 0, item)); persist(); return clone(item); },
    removeCollection(kind, id) { if (!['notes', 'checklist', 'templates'].includes(kind)) throw new Error('Collection compagnon inconnue.'); data[kind] = data[kind].filter(item => item.id !== id); data.pending.push(operation(`${kind}.delete`, id, 0, {})); persist(); },
    acknowledge(ids) { const accepted = new Set(ids); data.pending = data.pending.filter(item => !accepted.has(item.id)); persist(); },
    applySyncResponse(response) {
      this.acknowledge(response.acknowledged || []); data.conflicts = clone(response.conflicts || []);
      if (response.snapshot) this.replaceServerSnapshot(response.snapshot);
      persist(); return clone(data);
    },
    conflicts: () => clone(data.conflicts),
  };
}

export function resolveMode({ pcAvailable, internetAvailable }) { return pcAvailable ? CompanionMode.ONLINE_PC : internetAvailable ? CompanionMode.ONLINE_STANDALONE : CompanionMode.OFFLINE; }

export function changedFields(base, value) { return Object.keys(value || {}).filter(key => !['revision', 'updatedAt', 'origin'].includes(key) && JSON.stringify(base?.[key]) !== JSON.stringify(value[key])); }

export function reconcileEvent(base, pc, android) {
  const pcFields = changedFields(base, pc); const androidFields = changedFields(base, android); const overlap = pcFields.filter(field => androidFields.includes(field));
  if (overlap.length) return { conflict: true, fields: overlap, current: clone(pc), proposed: clone(android) };
  return { conflict: false, value: { ...clone(base), ...Object.fromEntries(pcFields.map(key => [key, pc[key]])), ...Object.fromEntries(androidFields.map(key => [key, android[key]])), revision: Math.max(pc.revision || 0, android.revision || 0) + 1, updatedAt: now() } };
}
