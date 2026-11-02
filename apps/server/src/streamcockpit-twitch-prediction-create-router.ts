import { Router, type Request, type Response } from 'express';
import { AdvancedTwitchError } from '../../../integrations/twitch/src/streamcockpit-advanced.js';
import type { TwitchActor } from './streamcockpit-twitch-service.js';
import { StreamcockpitPredictionCreateService } from './streamcockpit-twitch-prediction-create-service.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const exactKeys = (x: unknown, keys: string[]) =>
  !!x && typeof x === 'object' && !Array.isArray(x) &&
  Object.keys(x).sort().join(',') === [...keys].sort().join(',');

/** F08 voluntary prediction POST, pinned to the sole FIXE OBS stream epoch. */
export function createTwitchPredictionCreateRouter(options: {
  service: StreamcockpitPredictionCreateService;
  actor(req: Request): TwitchActor | Promise<TwitchActor>;
  hostLive(): string | undefined | Promise<string | undefined>;
}) {
  const router = Router();
  router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
  const error = (res: Response, thrown: unknown, postMayHaveStarted: boolean) => {
    const cause = thrown instanceof AdvancedTwitchError ? thrown.code : 'unavailable';
    const code = postMayHaveStarted ? 'uncertain' : cause;
    const status = code === 'invalid' ? 400 : code === 'unauthorized' ? 401 :
      code === 'forbidden' ? 403 : code === 'precondition' ? 409 :
      code === 'rate-limited' ? 429 : 503;
    res.status(status).json({ error: {
      code: code === 'uncertain' ? 'PREDICTION_OUTCOME_UNCERTAIN' :
        'PREDICTION_' + code.toUpperCase().replaceAll('-', '_'),
      retryable: false,
    } });
  };
  const check = async (req: Request, expected?: { actor: string; epoch: string }) => {
    const actor = await options.actor(req);
    if (!actor?.id || !actor.canRead || !actor.canInteract ||
        (expected && actor.id !== expected.actor)) throw new AdvancedTwitchError('forbidden');
    const epoch = await options.hostLive();
    if (!epoch || !/^[0-9]{1,16}:[0-9]{1,16}$/.test(epoch) ||
        (expected && epoch !== expected.epoch)) throw new AdvancedTwitchError('precondition');
    return { actor, epoch };
  };
  const onlyPost = (req: Request, res: Response) => {
    if (req.method === 'POST') return false;
    res.set('Allow', 'POST').status(405).json({ error: { code: 'METHOD_NOT_ALLOWED' } });
    return true;
  };
  router.all('/preview', async (req, res) => {
    if (onlyPost(req, res)) return;
    try {
      const context = await check(req);
      if (!exactKeys(req.body, ['draft'])) throw new AdvancedTwitchError('invalid');
      const preview = await options.service.preview(context.actor, req.body.draft, context.epoch);
      await check(req, { actor: context.actor.id, epoch: context.epoch });
      res.json({ schemaVersion: 1, kind: 'streamcockpit-prediction-preview', ...preview });
    } catch (e) { error(res, e, false); }
  });
  router.all('/confirm', async (req, res) => {
    if (onlyPost(req, res)) return;
    let postMayHaveStarted = false;
    try {
      const context = await check(req);
      if (!exactKeys(req.body, ['confirmationId', 'confirmed']) ||
          req.body.confirmed !== true || typeof req.body.confirmationId !== 'string' ||
          !uuid.test(req.body.confirmationId)) throw new AdvancedTwitchError('invalid');
      const expected = { actor: context.actor.id, epoch: context.epoch };
      const beforeSend = async () => {
        await check(req, expected);
        postMayHaveStarted = true;
      };
      const receipt = await options.service.confirm(context.actor, req.body.confirmationId,
        true, context.epoch, beforeSend);
      await check(req, expected);
      res.json({ schemaVersion: 1, kind: 'streamcockpit-prediction-confirmation',
        status: receipt.status, predictionId: receipt.predictionId });
    } catch (e) { error(res, e, postMayHaveStarted); }
  });
  return router;
}
