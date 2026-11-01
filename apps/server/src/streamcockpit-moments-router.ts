import { Router, type Request } from 'express';
import { momentIdentifier, type MarkerExport } from '../../../packages/core/src/streamcockpit-moments.js';

/** F09: read-only projection of the host's durable journal. No fake markers,
 * live-state inference, provider writes, memory fallback, or auto-retry.
 * The caller must supply the FIXE authority + paired observe checks.
 */
export function createMomentsReadRouter(options: {
  canRead(request: Request): boolean | Promise<boolean>;
  readExport(sessionId: string): Promise<MarkerExport | undefined>;
}) {
  const router = Router();
  router.all('/:sessionId', async (request, response) => {
    response.set('Cache-Control', 'no-store');
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.set('Allow', 'GET, HEAD').status(405).json({ error: { code: 'METHOD_NOT_ALLOWED' } });
      return;
    }
    let sessionId: string;
    try {
      if (!await options.canRead(request)) {
        response.status(403).json({ error: { code: 'MOMENTS_READ_FORBIDDEN' } });
        return;
      }
    } catch {
      response.status(403).json({ error: { code: 'MOMENTS_READ_FORBIDDEN' } });
      return;
    }
    try {
      sessionId = momentIdentifier(request.params.sessionId);
    } catch {
      response.status(400).json({ error: { code: 'INVALID_MOMENTS_SESSION' } });
      return;
    }
    let exportData: MarkerExport | undefined;
    let readFailed = false;
    try {
      exportData = await options.readExport(sessionId);
    } catch {
      readFailed = true;
    }
    // Recheck authorization after *every* storage outcome, including missing
    // or corrupt journals. A revoked device must get 403, never a stale 503/200.
    try {
      if (!await options.canRead(request)) {
        response.status(403).json({ error: { code: 'MOMENTS_READ_FORBIDDEN' } });
        return;
      }
    } catch {
      response.status(403).json({ error: { code: 'MOMENTS_READ_FORBIDDEN' } });
      return;
    }
    if (readFailed) {
      response.status(503).json({ error: { code: 'MOMENTS_UNAVAILABLE' } });
      return;
    }
    // A missing file means no producer has established a durable journal:
    // do NOT advertise an empty but authoritative session.
    if (!exportData) {
      response.status(503).json({ error: { code: 'MOMENTS_NOT_OBSERVED' } });
      return;
    }
    if (exportData.sessionId !== sessionId || exportData.schemaVersion !== 1 ||
        exportData.kind !== 'streamcockpit-markers' || exportData.timebase !== 'unix-ms' ||
        !Array.isArray(exportData.markers) || exportData.markers.length > 10000) {
      response.status(503).json({ error: { code: 'MOMENTS_UNAVAILABLE' } });
      return;
    }
    response.json({ ...exportData, readOnly: true });
  });
  return router;
}
