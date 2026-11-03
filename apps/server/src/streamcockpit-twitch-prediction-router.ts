import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { AdvancedTwitchError } from '../../../integrations/twitch/src/streamcockpit-advanced.js';
import { PredictionTwitch } from '../../../integrations/twitch/src/streamcockpit-prediction.js';
import type { TwitchActor } from './streamcockpit-twitch-service.js';

/** F08 paired management: read-only observation and explicitly consented local CAS release.
 * No route in this module sends a Twitch mutation; FIXE OBS epoch fenced throughout. */
export function createTwitchPredictionRouter(options: {
  api: PredictionTwitch;
  actor(req: Request): TwitchActor | Promise<TwitchActor>;
  hostLive(): string | undefined | Promise<string | undefined>;
  broadcasterId?(): string;
  reservation?: {
    readConfirmedId(broadcasterId: string): string | null | undefined;
    readLockAttempted?(broadcasterId: string, predictionId: string): boolean;
    readEndAttempted?(broadcasterId: string, predictionId: string): boolean;
  };
  reconcileRelease?: { releaseAfterVerifiedTerminal(broadcasterId: string, predictionId: string): void };
}) {
  const router = Router();
  const pending = new Map<string, { actor: string; epoch: string; owner: string;
    predictionId: string; expiresAt: number }>();
  const releasing = new Set<string>();
  const terminal = (state: string) => state === 'resolved' || state === 'canceled';
  const onlyPost = (req: Request, res: Response) => {
    if (req.method === 'POST') return false;
    res.set('Allow', 'POST').status(405).json({ error: { code: 'METHOD_NOT_ALLOWED' } });
    return true;
  };
  router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
  const deny = (res: Response, cause: unknown) => {
    const code = cause instanceof AdvancedTwitchError ? cause.code : 'unavailable';
    res.status(code === 'unauthorized' ? 401 : code === 'forbidden' ? 403 :
      code === 'precondition' ? 409 : code === 'rate-limited' ? 429 : 503)
      .json({ error: { code: 'PREDICTION_' + code.toUpperCase().replaceAll('-', '_'),
        retryable: false } });
  };
  const check = async (req: Request, expected?: { actor: string; epoch: string }) => {
    const actor = await options.actor(req);
    if (!actor?.id || !actor.canRead || !actor.canInteract ||
        (expected && expected.actor !== actor.id)) throw new AdvancedTwitchError('forbidden');
    const epoch = await options.hostLive();
    if (!epoch || !/^[0-9]{1,16}:[0-9]{1,16}$/.test(epoch) ||
        (expected && expected.epoch !== epoch)) throw new AdvancedTwitchError('precondition');
    return { actor: actor.id, epoch };
  };
  // Explicit read-only reconciliation: exact persisted ID, never 'latest' or a title match.
  // Even a terminal provider state DOES NOT clear the SQLite fence.
  router.all('/reconcile', async (req, res) => {
    if (req.method !== 'GET') {
      res.set('Allow', 'GET').status(405).json({ error: { code: 'METHOD_NOT_ALLOWED' } });
      return;
    }
    try {
      const expected = await check(req);
      if (!options.reservation || !options.broadcasterId)
        throw new AdvancedTwitchError('unavailable');
      const owner = options.broadcasterId();
      const predictionId = options.reservation.readConfirmedId(owner);
      const provider = typeof predictionId === 'string'
        ? await options.api.observeById(predictionId, owner) : undefined;
      await check(req, expected);
      if (options.broadcasterId() !== owner)
        throw new AdvancedTwitchError('unauthorized');
      // A concurrent terminal release/new reservation must not make stale
      // provider evidence appear to belong to a different local intent.
      if (options.reservation.readConfirmedId(owner) !== predictionId)
        throw new AdvancedTwitchError('precondition');
      // Committed PATCH attempts are *intent*, not proof of provider success.
      // A legacy or unreadable journal fails closed instead of assuming false.
      const lockAttempted = typeof predictionId === 'string' && options.reservation.readLockAttempted
        ? options.reservation.readLockAttempted(owner, predictionId) : null;
      const endAttempted = typeof predictionId === 'string' && options.reservation.readEndAttempted
        ? options.reservation.readEndAttempted(owner, predictionId) : null;
      res.status(200).json({ schemaVersion: 1, kind: 'streamcockpit-prediction-reconciliation',
        reservation: predictionId === undefined ? 'absent' : predictionId === null ? 'unattributed' : 'confirmed',
        providerStatus: provider?.status ?? 'unchecked',
        checkedAt: provider?.checkedAt ?? null,
        committedAttempts: { lock: lockAttempted, end: endAttempted },
        unlockAvailable: false, // GET alone cannot release.
        manualReleasePreviewPossible: Boolean(options.reconcileRelease &&
          typeof predictionId === 'string' && provider && terminal(provider.status)) });
    } catch (cause) { deny(res, cause); }
  });
  /** Operator explicitly requests release PREVIEW. Never changes journal or Twitch. */
  router.all('/reconcile/preview', async (req, res) => {
    if (onlyPost(req, res)) return;
    try {
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) ||
          Object.keys(req.body).length !== 0)
        throw new AdvancedTwitchError('precondition');
      const expected = await check(req);
      if (!options.reservation || !options.broadcasterId || !options.reconcileRelease)
        throw new AdvancedTwitchError('unavailable');
      const owner = options.broadcasterId();
      if (releasing.has(owner)) throw new AdvancedTwitchError('precondition');
      const id = options.reservation.readConfirmedId(owner);
      if (typeof id !== 'string') throw new AdvancedTwitchError('precondition');
      const observation = await options.api.observeById(id, owner);
      await check(req, expected);
      if (options.broadcasterId() !== owner || !terminal(observation.status))
        throw new AdvancedTwitchError('precondition');
      for (const [key, value] of pending) if (value.expiresAt <= Date.now()) pending.delete(key);
      if (pending.size >= 100) throw new AdvancedTwitchError('unavailable');
      const confirmationId = randomUUID(), expiresAt = Date.now() + 45_000;
      pending.set(confirmationId, { ...expected, owner, predictionId: id, expiresAt });
      res.json({ schemaVersion: 1, kind: 'streamcockpit-prediction-release-preview',
        confirmationId, expiresAt, providerStatus: observation.status,
        warning: 'Confirmer manuellement la fin de cette prédiction libère la création suivante sur cette chaîne.' });
    } catch (cause) { deny(res, cause); }
  });
  /** One-use operator confirmation: fresh exact-ID terminal GET, then SQLite CAS. */
  router.all('/reconcile/confirm', async (req, res) => {
    if (onlyPost(req, res)) return;
    try {
      const expected = await check(req);
      const body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body) ||
          Object.keys(body).sort().join(',') !== 'confirmationId,confirmed' ||
          body.confirmed !== true || typeof body.confirmationId !== 'string' ||
          !/^[0-9a-f-]{36}$/i.test(body.confirmationId))
        throw new AdvancedTwitchError('precondition');
      const entry = pending.get(body.confirmationId);
      pending.delete(body.confirmationId); // Consume BEFORE first await.
      if (!entry || entry.expiresAt <= Date.now() || entry.actor !== expected.actor ||
          entry.epoch !== expected.epoch || !options.reservation ||
          !options.broadcasterId || !options.reconcileRelease ||
          releasing.has(entry.owner)) throw new AdvancedTwitchError('precondition');
      releasing.add(entry.owner);
      try {
        if (options.broadcasterId() !== entry.owner ||
            options.reservation.readConfirmedId(entry.owner) !== entry.predictionId)
          throw new AdvancedTwitchError('precondition');
        const provider = await options.api.observeById(entry.predictionId, entry.owner);
        await check(req, expected);
        if (!terminal(provider.status) || options.broadcasterId() !== entry.owner ||
            options.reservation.readConfirmedId(entry.owner) !== entry.predictionId)
          throw new AdvancedTwitchError('precondition');
        options.reconcileRelease.releaseAfterVerifiedTerminal(entry.owner, entry.predictionId);
        res.json({ schemaVersion: 1, kind: 'streamcockpit-prediction-release-confirmed',
          released: true, providerStatus: provider.status });
      } finally { releasing.delete(entry.owner); }
    } catch (cause) { deny(res, cause); }
  });
  router.all('/', async (req, res) => {
    if (req.method !== 'GET') {
      res.set('Allow', 'GET').status(405).json({ error: { code: 'METHOD_NOT_ALLOWED' } });
      return;
    }
    try {
      const expected = await check(req);
      const snapshot = await options.api.observe();
      await check(req, expected);
      res.status(200).json({ schemaVersion: 1, kind: 'streamcockpit-prediction-snapshot',
        ...snapshot, mutationAvailable: false });
    } catch (cause) { deny(res, cause); }
  });
  return router;
}
