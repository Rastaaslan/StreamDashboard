import { Router, type Request } from 'express';
import { AdvancedTwitchError } from '../../../integrations/twitch/src/streamcockpit-advanced.js';
import { StreamcockpitTwitchService, type TwitchActor } from './streamcockpit-twitch-service.js';
import type { RemoteAuth } from './remote-auth.js';

/** Resolve authority from the host transport and pairing store, never request JSON. */
export function twitchReadActor(req: Request, auth: RemoteAuth, local: boolean, remoteEnabled: boolean): TwitchActor {
  if (local) return { id: 'local-host', canRead: true, canInteract: false };
  const credential = req.headers.authorization?.match(/^Device (\S+)$/)?.[1];
  const id = remoteEnabled && credential ? auth.authenticate(credential) : null;
  if (!id) throw new AdvancedTwitchError('unauthorized');
  return { id, canRead: auth.permits(id, ['chat']), canInteract: false };
}

/** Read-only surface. Poll confirmation deliberately has no HTTP handler. */
export function createTwitchCapabilitiesRouter(options: {
  service: StreamcockpitTwitchService;
  actor(req: Request): TwitchActor | Promise<TwitchActor>;
}) {
  const router = Router();
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.all('/', async (req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.set('Allow', 'GET, HEAD').status(405).json({ error: { code: 'METHOD_NOT_ALLOWED' } }); return;
    }
    try {
      const actor = await options.actor(req);
      const result = await options.service.capabilities(actor);
      // A revoke/role stop while Twitch is responding invalidates this response.
      const current = await options.actor(req);
      if (current.id !== actor.id || !current.canRead) throw new AdvancedTwitchError('forbidden');
      res.json(result);
    } catch (error) {
      const code = error instanceof AdvancedTwitchError ? error.code : 'unavailable';
      const status = code === 'unauthorized' ? 401 : code === 'forbidden' ? 403 : code === 'rate-limited' ? 429 : 503;
      res.status(status).json({ status: 'unknown', error: { code, retryable: false } });
    }
  });
  return router;
}
