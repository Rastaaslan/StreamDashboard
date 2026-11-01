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
    try {
      const exportData = await options.readExport(sessionId);
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
      // Pairing, capabilities and host roles can be revoked during the disk read.
      if (!await options.canRead(request)) {
        response.status(403).json({ error: { code: 'MOMENTS_READ_FORBIDDEN' } });
        return;
      }
      response.json({ ...exportData, readOnly: true });
    } catch {
      response.status(503).json({ error: { code: 'MOMENTS_UNAVAILABLE' } });
    }
  });
  return router;
}
