import type { Support } from '../../../packages/core/src/live-control-domains.js';

export class SupportRuntime {
  private supports: Support[];
  constructor(initial: Support[], private readonly persist: (values: Support[]) => Promise<void>, private readonly publish: (support: Support) => void) { this.supports = initial.map(validateSupport); }
  list() { return structuredClone(this.supports).sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt)); }
  async record(input: Support) { const support = validateSupport(input); const existing = this.supports.find(value => value.provider === support.provider && value.externalId === support.externalId); if (existing) return { inserted: false, support: structuredClone(existing) }; this.supports.push(support); await this.persist(this.supports); this.publish(support); return { inserted: true, support: structuredClone(support) }; }
  snapshot(sessionStartedAt: string | null, now = new Date()) { const startDay = new Date(now); startDay.setHours(0, 0, 0, 0); const startMonth = new Date(now.getFullYear(), now.getMonth(), 1); const sum = (from: number) => totals(this.supports.filter(value => Date.parse(value.receivedAt) >= from)); return { history: this.list(), totals: { session: sessionStartedAt ? sum(Date.parse(sessionStartedAt)) : {}, day: sum(startDay.getTime()), month: sum(startMonth.getTime()), all: totals(this.supports) } }; }
}
function totals(values: Support[]) { return values.reduce<Record<string, number>>((result, value) => { result[value.currency] = (result[value.currency] ?? 0) + value.amountMinor; return result; }, {}); }
function validateSupport(value: Support) { if (!/^[a-z0-9-]{1,40}$/.test(value.provider) || !value.externalId || value.externalId.length > 200 || !Number.isSafeInteger(value.amountMinor) || value.amountMinor < 0 || !/^[A-Z]{3}$/.test(value.currency) || !Number.isFinite(Date.parse(value.receivedAt))) throw new Error('Soutien invalide.'); return { ...value, displayName: value.displayName.slice(0, 100), message: value.message.slice(0, 2_000) }; }
