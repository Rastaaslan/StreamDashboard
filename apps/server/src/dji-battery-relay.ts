import { parseDjiBatteryResult, type DjiBatteryStatus } from './dji-mic3-battery.js';

/**
 * Read-only cross-device DJI telemetry.
 * Receiving a valid report does not grant its sender permissions to control
 * the live, pair another device, or query local hardware.
 */
const MAX_AGE_MS = 90_000;
const MAX_SOURCES = 8;
export interface DjiRelaySnapshot {
  status: 'ok' | 'unavailable';
  source: 'paired-device';
  sourceLabel: string;
  receivedAt: string;
  observation: DjiBatteryStatus;
}
export class DjiBatteryRelay {
  private reports = new Map<string, {received: number; observation: DjiBatteryStatus}>();
  constructor(private readonly now: () => number = Date.now) {}
  receive(deviceId: string, raw: unknown): DjiRelaySnapshot {
    if (!deviceId || typeof deviceId !== 'string' || deviceId.length > 180)
      throw new Error('Un appareil associé et identifié est obligatoire.');
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
      throw new Error('Télémétrie DJI invalide.');
    const record = raw as Record<string, unknown>;
    if (!['ok','unavailable'].includes(String(record.status)))
      throw new Error('État du capteur DJI invalide.');
    if (record.status === 'ok') {
      if (typeof record.observedAt !== 'string' || typeof record.validFrames !== 'number'
        || !Number.isInteger(record.validFrames) || record.validFrames < 1
        || record.validFrames > 20_000 || record.audioHealthy !== true)
        throw new Error('Aucune observation USB valide et vérifiée.');
      const observed = Date.parse(record.observedAt);
      const age = this.now() - observed;
      if (!Number.isFinite(age) || age < -15_000 || age > 45_000)
        throw new Error('Mesure DJI périmée ou horloge incorrecte.');
    }
    const observation = parseDjiBatteryResult(raw);
    if (record.status === 'ok' && observation.status !== 'ok')
      throw new Error('Champs de batterie hors plage ou incohérents.');
    // Limit relay to recently authenticated devices; never store raw payloads.
    this.reports.delete(deviceId);
    this.reports.set(deviceId, { received: this.now(), observation });
    while (this.reports.size > MAX_SOURCES) {
      const oldest = this.reports.keys().next().value;
      if (oldest === undefined) break;
      this.reports.delete(oldest);
    }
    return {
      status: observation.status,
      source: 'paired-device',
      sourceLabel: 'Appareil associé',
      receivedAt: new Date(this.now()).toISOString(),
      observation,
    };
  }
  snapshot(): DjiRelaySnapshot | null {
    const now = this.now();
    for (const [deviceId, report] of this.reports) {
      if (now - report.received > MAX_AGE_MS || now < report.received - 15_000)
        this.reports.delete(deviceId);
    }
    const reports = [...this.reports.values()];
    if (!reports.length) return null;
    const chosen = reports.reverse().find(x => x.observation.status === 'ok') || reports[0];
    return {
      status: chosen.observation.status,
      source: 'paired-device',
      sourceLabel: 'Appareil associé',
      receivedAt: new Date(chosen.received).toISOString(),
      observation: chosen.observation,
    };
  }
}
