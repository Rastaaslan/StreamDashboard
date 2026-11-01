import { createHash } from 'node:crypto';
import { Router, type Request } from 'express';
import { momentIdentifier, type Moment } from '../../../packages/core/src/streamcockpit-moments.js';

type ManualResult = { moment: Moment; outcome: 'created' | 'replayed' };
const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** F09: host-observed manual markers only. Nothing here controls OBS or Twitch.
 * An explicit paired clip-capable caller, a known running OBS output and an
 * already tracked host session are all mandatory. No session synthesis.
 */
export function createMomentsManualRouter(options: {
  authorize(request: Request): string | undefined | Promise<string | undefined>;
  activeSessionId(): string | undefined | Promise<string | undefined>;
  recordManual(value: { sessionId: string; correlationId: string; title: string; instant: number }): Promise<ManualResult>;
  lookupManual(correlationId: string): Promise<{ journalObserved: boolean; moment?: Moment }>;
  now?: () => number;
}) {
  const router = Router();
  router.all('/add', async (request, response) => {
    response.set('Cache-Control', 'no-store');
    if (request.method !== 'POST') {
      response.set('Allow', 'POST').status(405).json({ error: { code: 'METHOD_NOT_ALLOWED' } });
      return;
    }
    let actor: string | undefined;
    try { actor = await options.authorize(request); } catch { /* deny */ }
    if (!actor) {
      response.status(403).json({ error: { code: 'MOMENTS_WRITE_FORBIDDEN' } });
      return;
    }
    const body: unknown = request.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).sort().join() !== 'requestId,title') {
      response.status(400).json({ error: { code: 'INVALID_MANUAL_MARKER' } });
      return;
    }
    const input = body as Record<string, unknown>;
    if (typeof input.requestId !== 'string' || !requestIdPattern.test(input.requestId)) {
      response.status(400).json({ error: { code: 'INVALID_MANUAL_MARKER' } });
      return;
    }
    // The identifier is bound to the authenticated caller. A caller cannot
    // impersonate the correlation of another device, source or manual action.
    const correlationId = createHash('sha256').update(JSON.stringify([actor, input.requestId.toLowerCase()])).digest('hex');
    let sessionId: string | undefined;
    try { sessionId = await options.activeSessionId(); } catch { /* fail closed */ }
    if (!sessionId) {
      response.status(409).json({ error: { code: 'MOMENTS_NO_TRUSTED_LIVE_SESSION', retryable: false } });
      return;
    }
    try { momentIdentifier(sessionId); }
    catch {
      response.status(503).json({ error: { code: 'MOMENTS_HOST_SESSION_INVALID', retryable: false } });
      return;
    }
    // Prevent a revoked device from starting a write after session discovery.
    let reauthorized: string | undefined;
    try { reauthorized = await options.authorize(request); } catch { /* deny */ }
    if (reauthorized !== actor) {
      response.status(403).json({ error: { code: 'MOMENTS_WRITE_FORBIDDEN' } });
      return;
    }
    let result: ManualResult;
    try {
      result = await options.recordManual({
        sessionId, correlationId, title: input.title as string, instant: (options.now ?? Date.now)(),
      });
    } catch (error) {
      // A failed commit may already have persisted: never promise it didn't.
      reauthorized = undefined;
      try { reauthorized = await options.authorize(request); } catch { /* deny */ }
      if (reauthorized !== actor) {
        response.status(403).json({ error: { code: 'MOMENTS_WRITE_FORBIDDEN' } });
        return;
      }
      const code = error instanceof Error ? error.message : '';
      if (code === 'INVALID_MOMENT') {
        response.status(400).json({ error: { code: 'INVALID_MANUAL_MARKER' } });
      } else if (code === 'MOMENT_IDEMPOTENCY_CONFLICT') {
        response.status(409).json({ error: { code, retryable: false } });
      } else {
        response.status(503).json({ error: { code: 'MOMENTS_WRITE_UNCERTAIN', retryable: false } });
      }
      return;
    }
    reauthorized = undefined;
    try { reauthorized = await options.authorize(request); } catch { /* deny */ }
    if (reauthorized !== actor) {
      // The durable marker might already exist. Do not leak its contents.
      response.status(403).json({ error: { code: 'MOMENTS_WRITE_FORBIDDEN' } });
      return;
    }
    response.status(result.outcome === 'created' ? 201 : 200).json({
      schemaVersion: 1, kind: 'streamcockpit-manual-marker',
      outcome: result.outcome, sessionId: result.moment.sessionId,
      correlationId: result.moment.correlationId,
      instant: result.moment.instant, sequence: result.moment.sequence,
      source: 'manual', status: 'observed',
    });
  });
  // A read-only, authenticated reconciliation of a possibly committed write.
  // It never creates a marker, never retries POST and never asserts that an
  // absent row cannot still be committed by an in-flight request.
  router.all('/status/:requestId', async (request, response) => {
    response.set('Cache-Control', 'private, no-store');
    if (request.method !== 'GET') {
      response.set('Allow', 'GET').status(405).json({ error: { code: 'METHOD_NOT_ALLOWED' } });
      return;
    }
    let actor: string | undefined;
    try { actor = await options.authorize(request); } catch { /* deny */ }
    if (!actor) {
      response.status(403).json({ error: { code: 'MOMENTS_READ_FORBIDDEN' } });
      return;
    }
    const requestId = request.params.requestId;
    if (!requestIdPattern.test(requestId)) {
      response.status(400).json({ error: { code: 'INVALID_MANUAL_MARKER' } });
      return;
    }
    const correlationId = createHash('sha256').update(JSON.stringify([actor, requestId.toLowerCase()])).digest('hex');
    let result: { journalObserved: boolean; moment?: Moment } | undefined;
    let failed = false;
    try { result = await options.lookupManual(correlationId); } catch { failed = true; }
    let reauthorized: string | undefined;
    try { reauthorized = await options.authorize(request); } catch { /* deny */ }
    if (reauthorized !== actor) {
      response.status(403).json({ error: { code: 'MOMENTS_READ_FORBIDDEN' } });
      return;
    }
    if (failed || !result) {
      response.status(503).json({ error: { code: 'MOMENTS_UNAVAILABLE' } });
      return;
    }
    if (!result.journalObserved) {
      response.status(503).json({ error: { code: 'MOMENTS_NOT_OBSERVED' } });
      return;
    }
    const moment = result.moment;
    if (!moment) {
      response.json({ schemaVersion: 1, kind: 'streamcockpit-manual-marker-status', status: 'not_found_at_read' });
      return;
    }
    if (moment.correlationId !== correlationId || moment.source !== 'manual' ||
        moment.status !== 'observed' || !Number.isSafeInteger(moment.instant) ||
        !Number.isSafeInteger(moment.sequence)) {
      response.status(503).json({ error: { code: 'MOMENTS_UNAVAILABLE' } });
      return;
    }
    response.json({ schemaVersion: 1, kind: 'streamcockpit-manual-marker-status',
      status: 'confirmed', sessionId: moment.sessionId, instant: moment.instant,
      sequence: moment.sequence, source: 'manual' });
  });
  return router;
}
