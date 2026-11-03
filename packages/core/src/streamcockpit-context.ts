/** Presentation selection only. No command payload, dispatcher, clock or I/O. */
export type DeviceRole = 'stream-pc' | 'gaming-pc' | 'android' | 'paired-controller';
export type StreamState = 'offline' | 'starting' | 'live' | 'stopping';
export interface ContextSnapshot {
  scene: string | null;
  game: string | null;
  streamState: StreamState | null;
  role: DeviceRole | null;
  capabilities: string[] | null;
  network: 'online' | 'offline' | 'unknown';
}
export interface ContextAction {
  id: string;
  label: string;
  roles: DeviceRole[];
  capabilities: string[];
}
export interface ContextBank { id: string; label: string; actionIds: string[] }
export interface ContextRule {
  id: string;
  priority: number;
  bankId: string;
  when: Partial<Pick<ContextSnapshot, 'scene' | 'game' | 'streamState' | 'role'>> & {
    capabilities?: string[];
  };
}
export interface ContextConfig {
  schemaVersion: 1;
  platform: 'twitch';
  actions: ContextAction[];
  banks: ContextBank[];
  rules: ContextRule[];
  fallbackBankId: string;
}
export interface ContextPresentation {
  schemaVersion: 1;
  selection: 'rule' | 'fallback';
  ruleId: string | null;
  matchedRuleIds: string[];
  bank: { id: string; label: string };
  network: ContextSnapshot['network'];
  unknownFields: string[];
  actions: Array<{ id: string; label: string; available: boolean;
    reason: 'network-unavailable' | 'capabilities-unknown' | 'missing-capability' | null }>;
}
const roles = ['stream-pc', 'gaming-pc', 'android', 'paired-controller'];
const states = ['offline', 'starting', 'live', 'stopping'];
function fail(path: string): never { throw new TypeError(`Invalid context schema: ${path}`); }
function object(value: unknown, keys: string[], required: string[], path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(path);
  const record = value as Record<string, unknown>;
  if (Reflect.ownKeys(record).some(key => typeof key !== 'string' || !keys.includes(key)) ||
      required.some(key => !Object.hasOwn(record, key))) fail(path);
  // Reject accessors: configuration is data, never executable properties.
  if (Object.values(Object.getOwnPropertyDescriptors(record)).some(d => !('value' in d))) fail(path);
  return record;
}
function string(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > 256) fail(path);
}
function list(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value) || value.length > 512) fail(path);
  return value;
}
function strings(value: unknown, path: string, allowed?: string[]): string[] {
  const result = list(value, path);
  result.forEach(v => { string(v, path); if (allowed && !allowed.includes(v)) fail(path); });
  if (new Set(result).size !== result.length) fail(path);
  return result as string[];
}
function nullable(value: unknown, path: string, allowed?: string[]) {
  if (value === null) return;
  string(value, path);
  if (allowed && !allowed.includes(value)) fail(path);
}
/** Validates unknown JSON, rejects extra fields and dangling or duplicate IDs. */
export function parseContextConfig(value: unknown): ContextConfig {
  const keys = ['schemaVersion', 'platform', 'actions', 'banks', 'rules', 'fallbackBankId'];
  const c = object(value, keys, keys, 'config');
  if (c.schemaVersion !== 1 || c.platform !== 'twitch') fail('version/platform');
  const actions = list(c.actions, 'actions').map(v => {
    const a = object(v, ['id', 'label', 'roles', 'capabilities'], ['id', 'label', 'roles', 'capabilities'], 'action');
    string(a.id, 'action.id'); string(a.label, 'action.label');
    strings(a.roles, 'action.roles', roles); strings(a.capabilities, 'action.capabilities');
    return a;
  });
  const banks = list(c.banks, 'banks').map(v => {
    const b = object(v, ['id', 'label', 'actionIds'], ['id', 'label', 'actionIds'], 'bank');
    string(b.id, 'bank.id'); string(b.label, 'bank.label'); strings(b.actionIds, 'bank.actionIds');
    return b;
  });
  const rules = list(c.rules, 'rules').map(v => {
    const r = object(v, ['id', 'priority', 'bankId', 'when'], ['id', 'priority', 'bankId', 'when'], 'rule');
    string(r.id, 'rule.id'); string(r.bankId, 'rule.bankId');
    if (!Number.isSafeInteger(r.priority)) fail('rule.priority');
    const w = object(r.when, ['scene', 'game', 'streamState', 'role', 'capabilities'], [], 'rule.when');
    for (const key of ['scene', 'game', 'streamState', 'role']) {
      if (Object.hasOwn(w, key)) nullable(w[key], `when.${key}`, key === 'role' ? roles : key === 'streamState' ? states : undefined);
    }
    if (Object.hasOwn(w, 'capabilities')) strings(w.capabilities, 'when.capabilities');
    return r;
  });
  for (const entries of [actions, banks, rules]) {
    if (new Set(entries.map(e => e.id)).size !== entries.length) fail('duplicate id');
  }
  string(c.fallbackBankId, 'fallbackBankId');
  if (!banks.some(b => b.id === c.fallbackBankId)) fail('fallbackBankId reference');
  if (rules.some(r => !banks.some(b => b.id === r.bankId))) fail('rule bank reference');
  if (banks.some(b => (b.actionIds as string[]).some(id => !actions.some(a => a.id === id)))) fail('bank action reference');
  return structuredClone(value) as ContextConfig;
}
export function parseContextSnapshot(value: unknown): ContextSnapshot {
  const keys = ['scene', 'game', 'streamState', 'role', 'capabilities', 'network'];
  const c = object(value, keys, keys, 'snapshot');
  nullable(c.scene, 'scene'); nullable(c.game, 'game');
  nullable(c.streamState, 'streamState', states); nullable(c.role, 'role', roles);
  if (c.capabilities !== null) strings(c.capabilities, 'capabilities');
  if (!['online', 'offline', 'unknown'].includes(c.network as string)) fail('network');
  return structuredClone(value) as ContextSnapshot;
}
/** Every invocation validates and creates fresh output; previous selections are never retained. */
export function selectContextPresentation(config: unknown, snapshot: unknown): ContextPresentation {
  const c = parseContextConfig(config);
  const input = parseContextSnapshot(snapshot);
  const s: ContextSnapshot = input.network === 'online' ? input : {
    ...input, scene: null, game: null, streamState: null, capabilities: null,
  };
  const matches = c.rules.filter(r => Object.entries(r.when).every(([key, value]) => {
    if (key === 'capabilities') return s.capabilities !== null &&
      (value as string[]).every(cap => s.capabilities!.includes(cap));
    return s[key as 'scene' | 'game' | 'streamState' | 'role'] === value;
  })).sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const winner = matches[0];
  const bank = c.banks.find(b => b.id === (winner?.bankId ?? c.fallbackBankId))!;
  const actions: ContextPresentation['actions'] = bank.actionIds.flatMap(id => {
    const action = c.actions.find(a => a.id === id)!;
    if (s.role === null || !action.roles.includes(s.role)) return [];
    const reason = s.network !== 'online' ? 'network-unavailable' :
      s.capabilities === null ? 'capabilities-unknown' :
      action.capabilities.some(cap => !s.capabilities!.includes(cap)) ? 'missing-capability' : null;
    return [{ id: action.id, label: action.label, available: reason === null, reason }];
  });
  return {
    schemaVersion: 1, selection: winner ? 'rule' : 'fallback', ruleId: winner?.id ?? null,
    matchedRuleIds: matches.map(r => r.id), bank: { id: bank.id, label: bank.label },
    network: s.network,
    unknownFields: ['scene', 'game', 'streamState', 'role', 'capabilities'].filter(key => s[key as keyof ContextSnapshot] === null),
    actions,
  };
}
