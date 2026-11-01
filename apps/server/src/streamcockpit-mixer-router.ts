import { Router, type Request } from 'express';
import { mixerTelemetry, type MixerInventory } from '../../../packages/core/src/streamcockpit-mixer.js';

/** An HTTP process is not necessarily the OBS authority. Never infer the FIXE
 * role from being Windows or from any client-provided state; use host topology.
 */
export function mixerHostEligible(device: {platform: string; enabled?: boolean; roles: string[]} | undefined): boolean {
  return Boolean(device && device.platform === 'windows' && device.enabled === true &&
    Array.isArray(device.roles) && device.roles.includes('obs-executor'));
}

/** Read-only host telemetry. Auth + observe permission must be checked on every
 * call (including HEAD), after the existing server auth middleware.
 * A missing host event remains unavailable; it cannot become a new timestamp.
 */
export function createMixerRouter(options: {
  canRead(request: Request): boolean | Promise<boolean>;
  readSnapshot(): MixerInventory | undefined | Promise<MixerInventory | undefined>;
  now?: () => number;
}) {
  const router = Router();
  router.all('/', async (request, response) => {
    response.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.set('Allow', 'GET, HEAD').status(405).json({ error: { code: 'METHOD_NOT_ALLOWED' } });
      return;
    }
    try {
      if (!await options.canRead(request)) {
        response.status(403).json({ error: { code: 'MIXER_READ_FORBIDDEN' } });
        return;
      }
    } catch {
      response.status(403).json({ error: { code: 'MIXER_READ_FORBIDDEN' } });
      return;
    }
    try {
      const snapshot = await options.readSnapshot();
      if (!snapshot) {
        response.status(503).json({ error: { code: 'MIXER_NOT_OBSERVED' } });
        return;
      }
      const result = mixerTelemetry(snapshot, (options.now ?? Date.now)());
      // Pairing can be revoked while a host snapshot is being resolved.
      // Reauthorize immediately before sending any source names or volume data.
      if (!await options.canRead(request)) {
        response.status(403).json({ error: { code: 'MIXER_READ_FORBIDDEN' } });
        return;
      }
      response.json(result);
    } catch {
      response.status(503).json({ error: { code: 'MIXER_UNAVAILABLE' } });
    }
  });
  return router;
}
