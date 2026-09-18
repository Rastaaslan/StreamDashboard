import type { EventEnvelope } from '../../contracts/src/index.js';

export interface Support {
  id: string;
  provider: string;
  externalId: string;
  displayName: string;
  amountMinor: number;
  currency: string;
  message: string;
  receivedAt: string;
}

export class SupportHistory {
  private readonly supports = new Map<string, Support>();

  record(support: Support) {
    if (!Number.isSafeInteger(support.amountMinor) || support.amountMinor < 0) throw new Error('Le montant doit utiliser des unités mineures entières.');
    if (!/^[A-Z]{3}$/.test(support.currency)) throw new Error('Devise invalide.');
    if (!/^[a-z0-9-]{1,40}$/.test(support.provider) || !support.externalId || support.externalId.length > 200) throw new Error('Identifiant provider invalide.');
    const key = `${support.provider}:${support.externalId}`;
    if (this.supports.has(key)) return { inserted: false, support: this.supports.get(key)! };
    const normalized = { ...support, displayName: support.displayName.slice(0, 100), message: support.message.slice(0, 2_000) };
    this.supports.set(key, normalized);
    return { inserted: true, support: normalized };
  }

  list() { return [...this.supports.values()].sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt)); }
  total(currency: string) { return this.list().filter(item => item.currency === currency).reduce((sum, item) => sum + item.amountMinor, 0); }
}

export interface Chatter { id: string; displayName: string; role: 'broadcaster' | 'moderator' | 'vip' | 'viewer' }
export interface AudienceSnapshot { viewerCount: number | null; chatters: Chatter[]; updatedAt: string }

export function audienceSnapshot(input: { viewerCount?: unknown; chatters?: unknown; updatedAt?: string }): AudienceSnapshot {
  const viewerCount = Number.isInteger(input.viewerCount) && Number(input.viewerCount) >= 0 ? Number(input.viewerCount) : null;
  const chatters = Array.isArray(input.chatters) ? input.chatters.flatMap(value => {
    if (!value || typeof value !== 'object') return [];
    const row = value as Record<string, unknown>;
    if (typeof row.id !== 'string' || !row.id || typeof row.displayName !== 'string') return [];
    const role = ['broadcaster', 'moderator', 'vip'].includes(String(row.role)) ? row.role as Chatter['role'] : 'viewer';
    return [{ id: row.id.slice(0, 100), displayName: row.displayName.slice(0, 100), role }];
  }) : [];
  return { viewerCount, chatters, updatedAt: new Date(input.updatedAt ?? Date.now()).toISOString() };
}

export interface Automation {
  id: string;
  name: string;
  enabled: boolean;
  trigger: string;
  conditions: Array<{ path: string; operator: 'eq' | 'gte'; value: string | number | boolean }>;
  actions: Array<{ type: string; payload: Record<string, unknown> }>;
  cooldownMs: number;
  lastExecutionAt: string | null;
  lastResult?: { status: 'succeeded' | 'failed'; at: string; error?: string } | null;
}

function readPath(payload: unknown, path: string): unknown {
  if (!/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/.test(path)) return undefined;
  return path.split('.').reduce<unknown>((value, key) => value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined, payload);
}

export function matchAutomation(automation: Automation, event: EventEnvelope, now = Date.now()) {
  if (!automation.enabled || automation.trigger !== event.type) return false;
  if (!Number.isFinite(automation.cooldownMs) || automation.cooldownMs < 0) return false;
  if (automation.lastExecutionAt && now - Date.parse(automation.lastExecutionAt) < automation.cooldownMs) return false;
  return automation.conditions.every(condition => {
    const actual = readPath(event.payload, condition.path);
    return condition.operator === 'eq' ? actual === condition.value : typeof actual === 'number' && typeof condition.value === 'number' && actual >= condition.value;
  });
}
