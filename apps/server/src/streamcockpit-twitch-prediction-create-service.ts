import { randomUUID } from 'node:crypto';
import { AdvancedTwitchError } from '../../../integrations/twitch/src/streamcockpit-advanced.js';
import {
  PredictionCreateTwitch, normalizePredictionCreate, type PredictionCreateDraft,
} from '../../../integrations/twitch/src/streamcockpit-prediction-create.js';
import type { TwitchActor } from './streamcockpit-twitch-service.js';

/** In-memory one-use confirmation: lost receipts are NEVER replayed automatically. */
export class StreamcockpitPredictionCreateService {
  private readonly pending = new Map<string, {
    actor: string; hostEpoch: string; broadcasterId: string; fingerprint: string;
    draft: PredictionCreateDraft; expiresAt: number;
  }>();
  constructor(private readonly api: PredictionCreateTwitch, private readonly now = Date.now) {}

  private checkActor(actor: TwitchActor, epoch: string) {
    if (!actor?.id || !actor.canRead || !actor.canInteract)
      throw new AdvancedTwitchError('forbidden');
    if (!/^[0-9]{1,16}:[0-9]{1,16}$/.test(epoch))
      throw new AdvancedTwitchError('precondition');
  }
  async preview(actor: TwitchActor, input: unknown, hostEpoch: string) {
    this.checkActor(actor, hostEpoch);
    const draft = normalizePredictionCreate(input);
    const preflight = await this.api.preflight();
    for (const [key, p] of this.pending) if (p.expiresAt <= this.now()) this.pending.delete(key);
    if (this.pending.size >= 100) throw new AdvancedTwitchError('unavailable');
    const confirmationId = randomUUID();
    const expiresAt = Math.min(this.now() + 45_000, preflight.validUntil);
    this.pending.set(confirmationId, {
      actor: actor.id, hostEpoch, broadcasterId: preflight.broadcasterId,
      fingerprint: preflight.fingerprint, draft, expiresAt,
    });
    return { confirmationId, expiresAt, draft: structuredClone(draft),
      warning: 'La prédiction Twitch démarre dès la confirmation. Cette opération est publique.' };
  }
  async confirm(actor: TwitchActor, confirmationId: string, confirmed: boolean,
      hostEpoch: string, beforeSend: () => Promise<void>) {
    this.checkActor(actor, hostEpoch);
    const entry = this.pending.get(confirmationId);
    if (confirmed !== true || !entry || entry.actor !== actor.id ||
        entry.hostEpoch !== hostEpoch || entry.expiresAt <= this.now())
      throw new AdvancedTwitchError('precondition');
    this.pending.delete(confirmationId); // Consumed BEFORE the first await.
    return this.api.createConfirmed(entry.draft, entry.broadcasterId, entry.fingerprint, beforeSend);
  }
}
