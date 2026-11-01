import { Router, type Request } from 'express';
import { momentIdentifier, type MarkerExport } from '../../../packages/core/src/streamcockpit-moments.js';
import type { ObservedMomentSession } from './streamcockpit-moments.js';

/** F09: read-only projection of the host's durable journal. No fake markers,
 * live-state inference, provider writes, memory fallback, or auto-retry.
 * The caller must supply the FIXE authority + paired observe checks.
 */
export function createMomentsReadRouter(options: {
  canRead(request: Request): boolean | Promise<boolean>;
  readExport(sessionId: string): Promise<MarkerExport | undefined>;
  readSessions(): Promise<ObservedMomentSession[] | undefined>;
}) {
  const router = Router();
  // An explicit list request, never an automatic discovery or a provider call.
  // Do not use /sessions: that is also a valid user-supplied session ID.
  router.all('/', async (request, response) => {
    response.set('Cache-Control', 'no-store');
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.set('Allow', 'GET, HEAD').status(405).json({ error: { code: 'METHOD_NOT_ALLOWED' } });
      return;
    }
    let authorized = false;
    try { authorized = await options.canRead(request); } catch { /* deny */ }
    if (!authorized) {
      response.status(403).json({ error: { code: 'MOMENTS_READ_FORBIDDEN' } });
      return;
    }
    let sessions: ObservedMomentSession[] | undefined;
    let failed = false;
    try { sessions = await options.readSessions(); } catch { failed = true; }
    // Recheck permissions after every read outcome, including a missing journal.
    authorized = false;
    try { authorized = await options.canRead(request); } catch { /* deny */ }
    if (!authorized) {
      response.status(403).json({ error: { code: 'MOMENTS_READ_FORBIDDEN' } });
      return;
    }
    if (failed) {
      response.status(503).json({ error: { code: 'MOMENTS_UNAVAILABLE' } });
      return;
    }
    if (!sessions) {
      response.status(503).json({ error: { code: 'MOMENTS_NOT_OBSERVED' } });
      return;
    }
    const ids = new Set<string>();
    try {
      if (!Array.isArray(sessions) || sessions.length > 1000) throw 0;
      for (const session of sessions) {
        const id = momentIdentifier(session.sessionId);
        if (ids.has(id) || !Number.isSafeInteger(session.markerCount) || session.markerCount < 1 ||
            session.markerCount > 10000 || !Number.isSafeInteger(session.lastMarkerAt) ||
            session.lastMarkerAt < 0 || session.lastMarkerAt > 8640000000000000) throw 0;
        ids.add(id);
      }
    } catch {
      response.status(503).json({ error: { code: 'MOMENTS_UNAVAILABLE' } });
      return;
    }
    response.json({ schemaVersion: 1, kind: 'streamcockpit-moment-sessions', readOnly: true, sessions });
  });
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
