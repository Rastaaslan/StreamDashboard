import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { AdvancedTwitchError } from '../../../integrations/twitch/src/streamcockpit-advanced.js';
import { PredictionLockTwitch } from '../../../integrations/twitch/src/streamcockpit-prediction-lock.js';
import type { TwitchActor } from './streamcockpit-twitch-service.js';

type Fence = {
  readConfirmedId(owner: string): string | null | undefined;
  readLockAttempted(owner: string, predictionId: string): boolean;
  readEndAttempted(owner: string, predictionId: string): boolean;
  markLockAttempted(owner: string, predictionId: string): void;
};

/** F08 LOCK only: exact saved ID, paired management, FIXE stream epoch,
 * single-use operator consent and committed SQLite intent BEFORE Twitch PATCH. */
export function createTwitchPredictionLockRouter(options: {
  api: PredictionLockTwitch;
  actor(req: Request): TwitchActor | Promise<TwitchActor>;
  hostLive(): string | undefined | Promise<string | undefined>;
  broadcasterId(): string;
  fence: Fence;
}) {
  const router = Router();
  const pending = new Map<string, { actor: string; epoch: string; owner: string;
    id: string; fingerprint: string; expiresAt: number }>();
  const inFlight = new Set<string>();
  const check = async (req: Request, expected?: { actor: string; epoch: string }) => {
    const actor = await options.actor(req);
    if (!actor?.id || !actor.canRead || !actor.canInteract || (expected && actor.id !== expected.actor))
      throw new AdvancedTwitchError('forbidden');
    const epoch = await options.hostLive();
    if (!epoch || !/^[0-9]{1,16}:[0-9]{1,16}$/.test(epoch) ||
        (expected && epoch !== expected.epoch))
      throw new AdvancedTwitchError('precondition');
    return { actor: actor.id, epoch };
  };
  const deny = (res: Response, e: unknown, dispatched: boolean) => {
    const code = dispatched ? 'uncertain' : e instanceof AdvancedTwitchError ? e.code : 'unavailable';
    res.status(code === 'invalid' ? 400 : code === 'unauthorized' ? 401 :
      code === 'forbidden' ? 403 : code === 'precondition' ? 409 : 503)
      .json({ error: { code: code === 'uncertain' ? 'PREDICTION_LOCK_OUTCOME_UNCERTAIN' :
        'PREDICTION_LOCK_' + code.toUpperCase().replaceAll('-', '_'), retryable: false } });
  };
  router.use((_req, res, next) => {res.set('Cache-Control', 'private, no-store');next();});
  const onlyPost = (req: Request, res: Response) => {
    if (req.method === 'POST') return false;
    res.set('Allow', 'POST').status(405).json({error:{code:'METHOD_NOT_ALLOWED'}});
    return true;
  };
  const readExact = (owner: string) => {
    if (!/^[0-9]{1,30}$/.test(owner)) throw new AdvancedTwitchError('unauthorized');
    const id = options.fence.readConfirmedId(owner);
    if (!id || options.fence.readLockAttempted(owner, id) ||
        options.fence.readEndAttempted(owner, id)) throw new AdvancedTwitchError('precondition');
    return id;
  };

  router.all('/preview', async (req, res) => {
    if (onlyPost(req,res)) return;
    try {
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) ||
          Object.keys(req.body).length) throw new AdvancedTwitchError('invalid');
      const expected = await check(req);
      const owner = options.broadcasterId();
      if (inFlight.has(owner)) throw new AdvancedTwitchError('precondition');
      const id = readExact(owner);
      const proof = await options.api.preflight(id, owner);
      await check(req,expected);
      if (options.broadcasterId() !== owner || readExact(owner) !== id)
        throw new AdvancedTwitchError('precondition');
      for (const [key,entry] of pending) if (entry.expiresAt <= Date.now()) pending.delete(key);
      if (pending.size >= 100) throw new AdvancedTwitchError('unavailable');
      const confirmationId = randomUUID(), expiresAt = Math.min(Date.now()+45_000,proof.validUntil);
      if (expiresAt <= Date.now()) throw new AdvancedTwitchError('precondition');
      pending.set(confirmationId, {...expected, owner, id, fingerprint:proof.fingerprint, expiresAt});
      res.json({schemaVersion:1,kind:'streamcockpit-prediction-lock-preview',confirmationId,expiresAt,
        providerStatus:'active', warning:'Verrouiller ferme les paris sur cette prédiction Twitch. Action publique.'});
    } catch(e){deny(res,e,false);}
  });

  router.all('/confirm', async (req,res) => {
    if (onlyPost(req,res)) return;
    let dispatched = false;
    try {
      const context = await check(req);
      const body=req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body) ||
          Object.keys(body).sort().join(',') !== 'confirmationId,confirmed' ||
          body.confirmed !== true || typeof body.confirmationId !== 'string' ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.confirmationId))
        throw new AdvancedTwitchError('invalid');
      const entry = pending.get(body.confirmationId);
      pending.delete(body.confirmationId); // One use, consumed before async provider calls.
      if (!entry || entry.actor !== context.actor || entry.epoch !== context.epoch ||
          entry.expiresAt <= Date.now() || inFlight.has(entry.owner))
        throw new AdvancedTwitchError('precondition');
      inFlight.add(entry.owner);
      try {
        if (options.broadcasterId() !== entry.owner || readExact(entry.owner) !== entry.id)
          throw new AdvancedTwitchError('precondition');
        const receipt = await options.api.lockConfirmed(entry.id,entry.owner,entry.fingerprint,async()=>{
          await check(req, {actor:entry.actor,epoch:entry.epoch});
          if (options.broadcasterId() !== entry.owner || readExact(entry.owner) !== entry.id)
            throw new AdvancedTwitchError('precondition');
          // Any unclear SQLite COMMIT blocks further PATCH attempts. Never retry.
          try {options.fence.markLockAttempted(entry.owner,entry.id);}
          catch {throw new AdvancedTwitchError('unavailable');}
          dispatched = true; // SQLite intent persists even if a final host check fails.
          await check(req, {actor:entry.actor,epoch:entry.epoch});
          if (options.broadcasterId() !== entry.owner ||
              options.fence.readConfirmedId(entry.owner) !== entry.id)
            throw new AdvancedTwitchError('precondition');
        });
        await check(req,{actor:entry.actor,epoch:entry.epoch});
        if (options.broadcasterId() !== entry.owner ||
            options.fence.readConfirmedId(entry.owner) !== entry.id)
          throw new AdvancedTwitchError('uncertain');
        res.json({schemaVersion:1,kind:'streamcockpit-prediction-lock-confirmation',
          predictionId:receipt.predictionId,status:receipt.status});
      } finally {inFlight.delete(entry.owner);}
    } catch(e){deny(res,e,dispatched);}
  });
  return router;
}
