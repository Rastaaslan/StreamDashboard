import type {HealthSnapshot} from '../../../../packages/core/src/streamcockpit-health/index.js';

/** Whitelist only evidence with host-clock timestamps. No I/O and no secrets.
 * OBS connection/micro caches have no attested sample time. DJI relay timestamps
 * use a remote clock without a measured offset. Leave all three UNKNOWN.
 */
export function mapHostHealth(input: {
  device?: {id: string; platform: string; enabled?: boolean; roles: string[]};
  twitch?: {live: boolean | null; observedAt: string; error?: string};
}, now: number): HealthSnapshot {
  const {device, twitch} = input;
  const snapshot: HealthSnapshot = {hostId: device?.id ?? 'unknown', observations: {}};
  // Never promote an Android/controller runtime (or unidentified legacy runtime)
  // to the designated Windows OBS host merely because HTTP responds.
  if (!device || device.enabled !== true || device.platform !== 'windows' || !device.roles.includes('obs-executor')) return snapshot;
  snapshot.observations.host = {provenance: 'host-runtime:obs-executor', observedAt: now, receivedAt: now, data: {connected: true}};
  if (device.roles.includes('services') && twitch && !twitch.error && typeof twitch.live === 'boolean') {
    const observedAt = Date.parse(twitch.observedAt);
    if (Number.isFinite(observedAt)) snapshot.observations.twitch = {
      provenance: 'host-cache:twitch-api-read (not live status)', observedAt, receivedAt: observedAt, data: {connected: true},
    };
  }
  return snapshot;
}
