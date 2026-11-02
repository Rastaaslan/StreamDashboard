import { Router, type Request } from 'express';
import { AdvancedTwitchError } from '../../../integrations/twitch/src/streamcockpit-advanced.js';
import type { RemoteAuth } from './remote-auth.js';
import { StreamcockpitTwitchService, type TwitchActor } from './streamcockpit-twitch-service.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const exactKeys = (value: unknown, keys: string[]) =>
  !!value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === [...keys].sort().join(',');

/** Stream-owner pairing, not a chat-only reader or a body-supplied identity. */
export function twitchPollActor(request: Request, auth: RemoteAuth, local: boolean, remoteEnabled: boolean): TwitchActor {
  // Loopback is not an identity. Even the desktop needs an explicitly
  // management-paired credential for a public Twitch mutation.
  const token = request.headers.authorization?.match(/^Device (\S+)$/)?.[1];
  const id = (local || remoteEnabled) && token ? auth.authenticate(token) : null;
  if (!id) throw new AdvancedTwitchError('unauthorized');
  if (!auth.canManage(id) || !auth.permits(id, ['chat', 'cloud'])) throw new AdvancedTwitchError('forbidden');
  return { id, canRead: true, canInteract: true };
}

/**
 * F08: explicit poll preview then separate confirmation. Twitch is never
 * contacted automatically. A lost POST receipt is UNCERTAIN, not retryable.
 * The host and actor are rechecked before and just before the provider write,
 * but this is not an atomic Twitch/network transaction.
 */
export function createTwitchPollRouter(options: {
  service: StreamcockpitTwitchService;
  actor(request: Request): TwitchActor | Promise<TwitchActor>;
  hostLive(): boolean | Promise<boolean>;
}) {
  const router = Router();
  router.use((_req, response, next) => {
    response.set('Cache-Control', 'private, no-store');
    next();
  });
  const error = (response: import('express').Response, thrown: unknown, mayHaveWritten: boolean) => {
    const code = thrown instanceof AdvancedTwitchError ? thrown.code : (mayHaveWritten ? 'uncertain' : 'unavailable');
    const status = code === 'invalid' ? 400 : code === 'unauthorized' ? 401 :
      code === 'forbidden' ? 403 : code === 'precondition' ? 409 :
      code === 'rate-limited' ? 429 : 503;
    // Once a provider POST could have started, even a 400/403 or a lost
    // receipt cannot prove Twitch did not create the public poll.
    const final = mayHaveWritten ? 'uncertain' : code;
    response.status(final === 'uncertain' ? 503 : status).json({
      error: { code: final === 'uncertain' ? 'POLL_OUTCOME_UNCERTAIN' : 'POLL_' + final.toUpperCase().replaceAll('-', '_'),
        retryable: false },
    });
  };
  const restricted = (method: string, response: import('express').Response) => {
    if (method === 'POST') return false;
    response.set('Allow', 'POST').status(405).json({ error: { code: 'METHOD_NOT_ALLOWED' } });
    return true;
  };
  const check = async (request: Request, id?: string) => {
    const actor = await options.actor(request);
    if (!actor.canRead || !actor.canInteract || (id && actor.id !== id))
      throw new AdvancedTwitchError('forbidden');
    if (!await options.hostLive()) throw new AdvancedTwitchError('precondition');
    return actor;
  };
  router.all('/preview', async (request, response) => {
    if (restricted(request.method, response)) return;
    try {
      const actor = await check(request);
      if (!exactKeys(request.body, ['draft'])) throw new AdvancedTwitchError('invalid');
      const preview = await options.service.previewPoll(actor, request.body.draft);
      await check(request, actor.id);
      response.status(200).json({ schemaVersion: 1, kind: 'streamcockpit-poll-preview',
        confirmationId: preview.confirmationId, expiresAt: preview.expiresAt,
        draft: preview.draft, warning: preview.warning });
    } catch (cause) { error(response, cause, false); }
  });
  router.all('/confirm', async (request, response) => {
    if (restricted(request.method, response)) return;
    let mutationStarted = false;
    try {
      const actor = await check(request);
      if (!exactKeys(request.body, ['confirmed', 'confirmationId']) ||
          request.body.confirmed !== true || typeof request.body.confirmationId !== 'string' ||
          !uuid.test(request.body.confirmationId)) throw new AdvancedTwitchError('invalid');
      // Revalidate after the preflight, before Twitch's POST, not just on entry.
      const permitted = async () => {
        await check(request, actor.id);
        // The callback runs only after the Twitch GET preflight. From this
        // point the provider POST may occur: errors are always uncertain.
        mutationStarted = true;
        return true;
      };
      const receipt = await options.service.confirmPoll(actor, request.body.confirmationId, true, permitted);
      await check(request, actor.id); // A revoked device must not receive poll identity.
      response.status(200).json({ schemaVersion: 1, kind: 'streamcockpit-poll-confirmation',
        status: 'confirmed', pollId: receipt.pollId });
    } catch (cause) { error(response, cause, mutationStarted); }
  });
  return router;
}
