import { randomUUID } from 'node:crypto';
import { AdvancedTwitchError } from '../../../integrations/twitch/src/streamcockpit-advanced.js';
import {
  PredictionCreateTwitch, normalizePredictionCreate, type PredictionCreateDraft,
} from '../../../integrations/twitch/src/streamcockpit-prediction-create.js';
import type { TwitchActor } from './streamcockpit-twitch-service.js';
import type { PredictionCreationFence } from './streamcockpit-prediction-intent-sqlite.js';

/** In-memory one-use confirmation: lost receipts are NEVER replayed automatically. */
export class StreamcockpitPredictionCreateService {
  private readonly pending = new Map<string, {
    actor: string; hostEpoch: string; broadcasterId: string; fingerprint: string;
    draft: PredictionCreateDraft; expiresAt: number;
  }>();
  // A second consent must not race the first, even when it has a different UUID.
  // Keep the fence after a successful or uncertain POST until explicit reconciliation.
  // On FIXE, the injected SQLite reservation also survives a process restart.
  private readonly blockedBroadcasters = new Set<string>();
  constructor(private readonly api: PredictionCreateTwitch, private readonly now = Date.now,
    private readonly durableFence?: PredictionCreationFence) {}

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
    if (this.blockedBroadcasters.has(preflight.broadcasterId))
      throw new AdvancedTwitchError('precondition');
    try {
      if (this.durableFence?.isBlocked(preflight.broadcasterId))
        throw new AdvancedTwitchError('precondition');
    } catch (error) {
      if (error instanceof AdvancedTwitchError) throw error;
      throw new AdvancedTwitchError('unavailable'); // Unknown journal: fail closed.
    }
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
    if (this.blockedBroadcasters.has(entry.broadcasterId))
      throw new AdvancedTwitchError('precondition');
    this.blockedBroadcasters.add(entry.broadcasterId); // Acquire before first await.
    try {
      if (this.durableFence && !this.durableFence.reserve(entry.broadcasterId))
        throw new AdvancedTwitchError('precondition');
    } catch (error) {
      if (error instanceof AdvancedTwitchError) throw error;
      // An unclear SQLite commit must NEVER permit an outbound Twitch POST.
      throw new AdvancedTwitchError('unavailable');
    }
    try {
      // Reservation COMMIT precedes every possible external Twitch write.
      const receipt = await this.api.createConfirmed(entry.draft, entry.broadcasterId,
        entry.fingerprint, beforeSend);
      try { this.durableFence?.recordConfirmed(entry.broadcasterId, receipt.predictionId); }
      catch { throw new AdvancedTwitchError('uncertain'); }
      return receipt;
    } catch (error) {
      if (error instanceof AdvancedTwitchError && error.code !== 'uncertain') {
        try {
          this.durableFence?.releaseBeforePost(entry.broadcasterId);
          this.blockedBroadcasters.delete(entry.broadcasterId);
        } catch {
          // Uncertain release remains blocked; caller must not infer retry safety.
          throw new AdvancedTwitchError('unavailable');
        }
      }
      throw error;
    }
  }
}
