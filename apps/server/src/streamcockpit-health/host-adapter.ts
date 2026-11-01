import type {HealthSnapshot} from '../../../../packages/core/src/streamcockpit-health/index.js';
import {ObsHealthObservation} from './obs-observation.js';

/** Whitelist only evidence with host-clock timestamps. No I/O and no secrets.
 * Only the process-local OBS notification recorder supplies OBS evidence.
 * Micro caches and remote DJI timestamps remain UNKNOWN.
 */
export function mapHostHealth(input: {
  device?: {id: string; platform: string; enabled?: boolean; roles: string[]};
  twitch?: {live: boolean | null; observedAt: string; error?: string};
  obs?: ObsHealthObservation;
}, now: number): HealthSnapshot {
  const {device, twitch} = input;
  const snapshot: HealthSnapshot = {hostId: device?.id ?? 'unknown', observations: {}};
  // Never promote an Android/controller runtime (or unidentified legacy runtime)
  // to the designated Windows OBS host merely because HTTP responds.
  if (!device || device.enabled !== true || device.platform !== 'windows' || !device.roles.includes('obs-executor')) return snapshot;
  snapshot.observations.host = {provenance: 'host-runtime:obs-executor', observedAt: now, receivedAt: now, data: {connected: true}};
  // A client JSON snapshot cannot construct a process-local recorder.
  if (input.obs instanceof ObsHealthObservation) {
    const observed = input.obs.read(now);
    if (observed) snapshot.observations.obs = observed;
  }
  if (device.roles.includes('services') && twitch && !twitch.error && typeof twitch.live === 'boolean') {
    const observedAt = Date.parse(twitch.observedAt);
    if (Number.isFinite(observedAt)) snapshot.observations.twitch = {
      provenance: 'host-cache:twitch-api-read (not live status)', observedAt, receivedAt: observedAt, data: {connected: true},
    };
  }
  return snapshot;
}
