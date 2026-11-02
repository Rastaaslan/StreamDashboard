import { Router, type Request, type Response } from 'express';
import { AdvancedTwitchError } from '../../../integrations/twitch/src/streamcockpit-advanced.js';
import type { TwitchActor } from './streamcockpit-twitch-service.js';
import { StreamcockpitRaidService } from './streamcockpit-twitch-raid-service.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const exact = (v: unknown, keys: string[]) => v !== null &&
  typeof v === 'object' && !Array.isArray(v) &&
  Object.keys(v).sort().join(',') === [...keys].sort().join(',');

/** F08: only an explicit second consent can queue a Twitch raid.
 * This route cannot stop OBS/live; Twitch's own 90-second raid countdown
 * may transfer viewers, so its result must never be called 'completed'.
 */
export function createTwitchRaidRouter(options: {
  service: StreamcockpitRaidService;
  actor(request: Request): TwitchActor | Promise<TwitchActor>;
  hostLive(): string | undefined | Promise<string | undefined>;
}) {
  const router = Router();
  router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
  const deny = (res: Response, cause: unknown, possiblySent: boolean) => {
    const code = cause instanceof AdvancedTwitchError ? cause.code : 'unavailable';
    const status = possiblySent ? 503 : code === 'invalid' ? 400 :
      code === 'unauthorized' ? 401 : code === 'forbidden' ? 403 :
      code === 'precondition' ? 409 : code === 'rate-limited' ? 429 : 503;
    res.status(status).json({ error: {
      code: possiblySent ? 'RAID_OUTCOME_UNCERTAIN' :
        'RAID_' + code.toUpperCase().replaceAll('-', '_'), retryable: false,
    } });
  };
  const check = async (req: Request, expected?: { actor: string; hostEpoch: string }) => {
    const actor = await options.actor(req);
    if (!actor?.id || !actor.canRead || !actor.canInteract ||
        (expected && expected.actor !== actor.id)) throw new AdvancedTwitchError('forbidden');
    const hostEpoch = await options.hostLive();
    if (typeof hostEpoch !== 'string' ||
        !/^[0-9]{1,16}:[0-9]{1,16}$/.test(hostEpoch) ||
        (expected && expected.hostEpoch !== hostEpoch))
      throw new AdvancedTwitchError('precondition');
    return { actor, hostEpoch };
  };
  const postOnly = (req: Request, res: Response) => {
    if (req.method === 'POST') return true;
    res.set('Allow', 'POST').status(405).json({ error: { code: 'METHOD_NOT_ALLOWED' } });
    return false;
  };
  router.all('/preview', async (req, res) => {
    if (!postOnly(req, res)) return;
    try {
      const context = await check(req);
      if (!exact(req.body, ['target'])) throw new AdvancedTwitchError('invalid');
      const preview = await options.service.preview(context.actor, req.body.target, context.hostEpoch);
      await check(req, { actor: context.actor.id, hostEpoch: context.hostEpoch });
      res.status(200).json({ schemaVersion: 1, kind: 'streamcockpit-raid-preview',
        confirmationId: preview.confirmationId, expiresAt: preview.expiresAt,
        targetLogin: preview.targetLogin, warning: preview.warning });
    } catch (cause) { deny(res, cause, false); }
  });
  router.all('/confirm', async (req, res) => {
    if (!postOnly(req, res)) return;
    let possiblySent = false;
    try {
      const context = await check(req);
      if (!exact(req.body, ['confirmationId', 'confirmed']) ||
          req.body.confirmed !== true || typeof req.body.confirmationId !== 'string' ||
          !uuid.test(req.body.confirmationId)) throw new AdvancedTwitchError('invalid');
      const expected = { actor: context.actor.id, hostEpoch: context.hostEpoch };
      const receipt = await options.service.confirm(context.actor, req.body.confirmationId,
        true, context.hostEpoch, async () => {
          await check(req, expected);
          possiblySent = true; // Provider POST may now be in flight; never replay.
        });
      await check(req, expected);
      res.status(200).json({ schemaVersion: 1, kind: 'streamcockpit-raid-confirmation',
        status: 'queued', targetLogin: receipt.targetLogin, transferVerified: false });
    } catch (cause) { deny(res, cause, possiblySent); }
  });
  return router;
}
