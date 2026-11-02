import { Router, type Request, type Response } from 'express';
import { AdvancedTwitchError } from '../../../integrations/twitch/src/streamcockpit-advanced.js';
import { PredictionTwitch } from '../../../integrations/twitch/src/streamcockpit-prediction.js';
import type { TwitchActor } from './streamcockpit-twitch-service.js';

/** Read-only F08: paired management actor and SAME FIXE OBS live epoch before/after provider read. */
export function createTwitchPredictionRouter(options: {
  api: PredictionTwitch;
  actor(req: Request): TwitchActor | Promise<TwitchActor>;
  hostLive(): string | undefined | Promise<string | undefined>;
}) {
  const router = Router();
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
