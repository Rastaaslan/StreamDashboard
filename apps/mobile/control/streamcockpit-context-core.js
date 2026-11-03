// Generated from packages/core/src/streamcockpit-context.ts. Do not edit.
// Regenerate: node apps/mobile/control/streamcockpit-context-build.mjs

// packages/core/src/streamcockpit-context.ts
var roles = ["stream-pc", "gaming-pc", "android", "paired-controller"];
var states = ["offline", "starting", "live", "stopping"];
function fail(path) {
  throw new TypeError(`Invalid context schema: ${path}`);
}
function object(value, keys, required, path) {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(path);
  const record = value;
  if (Reflect.ownKeys(record).some((key) => typeof key !== "string" || !keys.includes(key)) || required.some((key) => !Object.hasOwn(record, key))) fail(path);
  if (Object.values(Object.getOwnPropertyDescriptors(record)).some((d) => !("value" in d))) fail(path);
  return record;
}
function string(value, path) {
  if (typeof value !== "string" || !value.trim() || value.length > 256) fail(path);
}
function list(value, path) {
  if (!Array.isArray(value) || value.length > 512) fail(path);
  return value;
}
function strings(value, path, allowed) {
  const result = list(value, path);
  result.forEach((v) => {
    string(v, path);
    if (allowed && !allowed.includes(v)) fail(path);
  });
  if (new Set(result).size !== result.length) fail(path);
  return result;
}
function nullable(value, path, allowed) {
  if (value === null) return;
  string(value, path);
  if (allowed && !allowed.includes(value)) fail(path);
}
function parseContextConfig(value) {
  const keys = ["schemaVersion", "platform", "actions", "banks", "rules", "fallbackBankId"];
  const c = object(value, keys, keys, "config");
  if (c.schemaVersion !== 1 || c.platform !== "twitch") fail("version/platform");
  const actions = list(c.actions, "actions").map((v) => {
    const a = object(v, ["id", "label", "roles", "capabilities"], ["id", "label", "roles", "capabilities"], "action");
    string(a.id, "action.id");
    string(a.label, "action.label");
    strings(a.roles, "action.roles", roles);
    strings(a.capabilities, "action.capabilities");
    return a;
  });
  const banks = list(c.banks, "banks").map((v) => {
    const b = object(v, ["id", "label", "actionIds"], ["id", "label", "actionIds"], "bank");
    string(b.id, "bank.id");
    string(b.label, "bank.label");
    strings(b.actionIds, "bank.actionIds");
    return b;
  });
  const rules = list(c.rules, "rules").map((v) => {
    const r = object(v, ["id", "priority", "bankId", "when"], ["id", "priority", "bankId", "when"], "rule");
    string(r.id, "rule.id");
    string(r.bankId, "rule.bankId");
    if (!Number.isSafeInteger(r.priority)) fail("rule.priority");
    const w = object(r.when, ["scene", "game", "streamState", "role", "capabilities"], [], "rule.when");
    for (const key of ["scene", "game", "streamState", "role"]) {
      if (Object.hasOwn(w, key)) nullable(w[key], `when.${key}`, key === "role" ? roles : key === "streamState" ? states : void 0);
    }
    if (Object.hasOwn(w, "capabilities")) strings(w.capabilities, "when.capabilities");
    return r;
  });
  for (const entries of [actions, banks, rules]) {
    if (new Set(entries.map((e) => e.id)).size !== entries.length) fail("duplicate id");
  }
  string(c.fallbackBankId, "fallbackBankId");
  if (!banks.some((b) => b.id === c.fallbackBankId)) fail("fallbackBankId reference");
  if (rules.some((r) => !banks.some((b) => b.id === r.bankId))) fail("rule bank reference");
  if (banks.some((b) => b.actionIds.some((id) => !actions.some((a) => a.id === id)))) fail("bank action reference");
  return structuredClone(value);
}
function parseContextSnapshot(value) {
  const keys = ["scene", "game", "streamState", "role", "capabilities", "network"];
  const c = object(value, keys, keys, "snapshot");
  nullable(c.scene, "scene");
  nullable(c.game, "game");
  nullable(c.streamState, "streamState", states);
  nullable(c.role, "role", roles);
  if (c.capabilities !== null) strings(c.capabilities, "capabilities");
  if (!["online", "offline", "unknown"].includes(c.network)) fail("network");
  return structuredClone(value);
}
function selectContextPresentation(config, snapshot) {
  const c = parseContextConfig(config);
  const input = parseContextSnapshot(snapshot);
  const s = input.network === "online" ? input : {
    ...input,
    scene: null,
    game: null,
    streamState: null,
    capabilities: null
  };
  const matches = c.rules.filter((r) => Object.entries(r.when).every(([key, value]) => {
    if (key === "capabilities") return s.capabilities !== null && value.every((cap) => s.capabilities.includes(cap));
    return s[key] === value;
  })).sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const winner = matches[0];
  const bank = c.banks.find((b) => b.id === (winner?.bankId ?? c.fallbackBankId));
  const actions = bank.actionIds.flatMap((id) => {
    const action = c.actions.find((a) => a.id === id);
    if (s.role === null || !action.roles.includes(s.role)) return [];
    const reason = s.network !== "online" ? "network-unavailable" : s.capabilities === null ? "capabilities-unknown" : action.capabilities.some((cap) => !s.capabilities.includes(cap)) ? "missing-capability" : null;
    return [{ id: action.id, label: action.label, available: reason === null, reason }];
  });
  return {
    schemaVersion: 1,
    selection: winner ? "rule" : "fallback",
    ruleId: winner?.id ?? null,
    matchedRuleIds: matches.map((r) => r.id),
    bank: { id: bank.id, label: bank.label },
    network: s.network,
    unknownFields: ["scene", "game", "streamState", "role", "capabilities"].filter((key) => s[key] === null),
    actions
  };
}
export {
  parseContextConfig,
  parseContextSnapshot,
  selectContextPresentation
};
