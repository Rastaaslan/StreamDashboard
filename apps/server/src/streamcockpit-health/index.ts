import {Router, type Request} from 'express';
import {diagnoseHealth} from '../../../../packages/core/src/streamcockpit-health/index.js';

export interface HealthApiDependencies {
  /** Must verify existing authenticated identity AND health-read capability. */
  canRead(request: Request): boolean | Promise<boolean>;
  /** Existing host cache only; do not fetch OBS/Twitch or perform commands. */
  readSnapshot(): unknown | Promise<unknown>;
  now?: () => number;
}
/** Mount explicitly at /api/v1/streamcockpit-health behind existing auth middleware.
 * No registration side effects, command methods, retries or observer creation. */
export function createHealthRouter(dependencies: HealthApiDependencies) {
  const router = Router();
  router.all('/', async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD');
      response.status(405).json({error: 'METHOD_NOT_ALLOWED'}); return;
    }
    try {
      if (!await dependencies.canRead(request)) { response.status(403).json({error: 'HEALTH_READ_FORBIDDEN'}); return; }
    } catch { response.status(403).json({error: 'HEALTH_READ_FORBIDDEN'}); return; }
    try {
      const snapshot = await dependencies.readSnapshot();
      response.json(diagnoseHealth(snapshot, (dependencies.now ?? Date.now)()));
    } catch {
      response.status(503).json({error: 'HEALTH_SNAPSHOT_UNAVAILABLE'});
    }
  });
  return router;
}
