/** Read-only v1 contract. Times are Unix milliseconds; observedAt and receivedAt
 * must use the host clock (normalise remote clocks before publishing). */
export const sources = ['host', 'obs', 'twitch', 'micro', 'dji', 'sync'] as const;
export type Source = typeof sources[number];
export type Status = 'unknown' | 'healthy' | 'degraded' | 'critical';
export interface Observation {
  provenance: string;
  observedAt: number;
  receivedAt: number;
  data: {
    connected?: boolean;
    available?: boolean;
    muted?: boolean;
    levelDb?: number; // Silence is not a fault signal.
    batteryPercent?: number; // Only a measured value, never a default.
    offsetMs?: number;
  };
}
export interface HealthSnapshot {
  hostId: string;
  observations: Partial<Record<Source, Observation>>;
}
export type Freshness = 'missing' | 'invalid' | 'clock-skew' | 'stale' | 'fresh';
export interface Diagnostic {
  source: Source;
  status: Status;
  code: string;
  provenance: string | null;
  observedAt: number | null;
  receivedAt: number | null;
  ageMs: number | null;
  freshness: Freshness;
  batteryPercent?: number;
}
export interface HealthReport {
  schemaVersion: 1;
  hostId: string;
  evaluatedAt: number;
  status: Status;
  diagnostics: Diagnostic[];
}
export const healthPolicy = Object.freeze({maxAgeMs: 15_000, clockToleranceMs: 2_000,
  batteryCritical: 10, batteryLow: 20, syncDegradedMs: 250, syncCriticalMs: 2_000});
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Accepts untrusted snapshots: invalid/missing evidence never becomes healthy. */
export function diagnoseHealth(input: unknown, now: number): HealthReport {
  if (!finite(now) || now < 0) throw new Error('INVALID_HEALTH_CLOCK');
  const snapshot = record(input) ? input : {};
  const observations = record(snapshot.observations) ? snapshot.observations : {};
  const diagnostics = sources.map((source): Diagnostic => {
    const raw = observations[source];
    const value = record(raw) ? raw : {};
    const observedAt = finite(value.observedAt) && value.observedAt >= 0 ? value.observedAt : null;
    const receivedAt = finite(value.receivedAt) && value.receivedAt >= 0 ? value.receivedAt : null;
    const provenance = typeof value.provenance === 'string' && value.provenance.trim() ? value.provenance.slice(0, 160) : null;
    let freshness: Freshness = 'fresh';
    if (raw == null) freshness = 'missing';
    else if (observedAt === null || receivedAt === null || !provenance || !record(value.data)) freshness = 'invalid';
    else if (observedAt > now + healthPolicy.clockToleranceMs || receivedAt > now + healthPolicy.clockToleranceMs || observedAt > receivedAt + healthPolicy.clockToleranceMs) freshness = 'clock-skew';
    else if (now - observedAt > healthPolicy.maxAgeMs || now - receivedAt > healthPolicy.maxAgeMs) freshness = 'stale';
    const result: Diagnostic = {source, status: 'unknown', code: freshness === 'fresh' ? 'measurement-missing' : freshness,
      provenance, observedAt, receivedAt, ageMs: observedAt === null ? null : Math.max(0, now - observedAt), freshness};
    if (freshness !== 'fresh') return result;
    const data = value.data as Record<string, unknown>;
    const set = (status: Status, code: string) => Object.assign(result, {status, code});
    if (source === 'host' || source === 'obs' || source === 'twitch') {
      if (data.connected === false) return set(source === 'twitch' ? 'degraded' : 'critical', 'disconnected');
      if (data.connected === true) return set('healthy', 'connected');
    } else if (source === 'micro') {
      if (data.available === false) return set('critical', 'device-unavailable');
      if (data.available === true && data.muted === true) return set('degraded', 'muted');
      if (data.available === true && data.muted === false) return set('healthy', 'available');
    } else if (source === 'dji') {
      if (data.connected === false) return set('degraded', 'disconnected');
      if (finite(data.batteryPercent) && data.batteryPercent >= 0 && data.batteryPercent <= 100) {
        result.batteryPercent = data.batteryPercent;
        return set(data.batteryPercent <= healthPolicy.batteryCritical ? 'critical' : data.batteryPercent <= healthPolicy.batteryLow ? 'degraded' : 'healthy', 'battery-measured');
      }
    } else if (finite(data.offsetMs)) {
      const offset = Math.abs(data.offsetMs);
      return set(offset >= healthPolicy.syncCriticalMs ? 'critical' : offset >= healthPolicy.syncDegradedMs ? 'degraded' : 'healthy', 'offset-measured');
    }
    return result;
  });
  const host = diagnostics[0];
  if (host.status !== 'healthy') for (const diagnostic of diagnostics.slice(1)) {
    diagnostic.status = 'unknown';
    diagnostic.code = 'host-unavailable';
    delete diagnostic.batteryPercent;
  }
  const statuses = diagnostics.map(d => d.status);
  const status = (['critical', 'degraded', 'unknown', 'healthy'] as const).find(s => statuses.includes(s))!;
  return {schemaVersion: 1, hostId: typeof snapshot.hostId === 'string' ? snapshot.hostId.slice(0, 160) : 'unknown', evaluatedAt: now, status, diagnostics};
}

export interface HealthAlert {id: string; source: Source; status: 'degraded' | 'critical'; code: string; firstSeenAt: number}
export interface AlertState {hostId: string; pending: HealthAlert[]}
/** Pure episode deduplication. Unknown evidence keeps an episode open without
 * repeating a notification or claiming recovery. Persist state per host. */
export function reconcileHealthAlerts(report: HealthReport, previous?: AlertState) {
  const old = previous?.hostId === report.hostId ? previous.pending : [];
  const pending: HealthAlert[] = [], opened: HealthAlert[] = [], resolved: HealthAlert[] = [];
  for (const diagnostic of report.diagnostics) {
    const prior = old.find(a => a.source === diagnostic.source);
    if (diagnostic.status === 'unknown') { if (prior) pending.push({...prior}); continue; }
    if (diagnostic.status === 'healthy') { if (prior) resolved.push({...prior}); continue; }
    const id = JSON.stringify([report.hostId, diagnostic.source, diagnostic.code, diagnostic.status]);
    const alert: HealthAlert = {id, source: diagnostic.source, code: diagnostic.code, status: diagnostic.status,
      firstSeenAt: prior?.id === id ? prior.firstSeenAt : report.evaluatedAt};
    pending.push(alert);
    if (prior?.id !== id) { opened.push(alert); if (prior) resolved.push({...prior}); }
  }
  return {state: {hostId: report.hostId, pending}, opened, resolved};
}
