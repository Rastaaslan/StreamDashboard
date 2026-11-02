import { randomUUID } from 'node:crypto';
import { AdvancedTwitch, AdvancedTwitchError, normalizePoll, type PollDraft } from '../../../integrations/twitch/src/streamcockpit-advanced.js';
export interface TwitchActor { id: string; canRead: boolean; canInteract: boolean }
/** Actor must come from authenticated server authority, never from request JSON. */
export class StreamcockpitTwitchService {
  private pending = new Map<string, { actor: string; broadcasterId: string; draft: PollDraft; expiresAt: number }>();
  constructor(private readonly api: AdvancedTwitch, private readonly now = Date.now) {}
  capabilities(actor: TwitchActor) {
    this.authorize(actor, false);
    return this.api.capabilities();
  }
  private authorize(actor: TwitchActor, write: boolean) {
    if (!actor?.id || actor.canRead !== true || write && actor.canInteract !== true) throw new AdvancedTwitchError('forbidden');
  }
  async previewPoll(actor: TwitchActor, input: unknown) {
    this.authorize(actor, true);
    const draft = normalizePoll(input);
    const session = await this.api.pollPreflight();
    for (const [id, p] of this.pending) if (p.expiresAt <= this.now()) this.pending.delete(id);
    if (this.pending.size >= 100) throw new AdvancedTwitchError('unavailable');
    const confirmationId = randomUUID(), expiresAt = Math.min(this.now() + 60_000, session.validUntil);
    const entry = { actor: actor.id, broadcasterId: session.c.broadcasterId, draft, expiresAt };
    this.pending.set(confirmationId, entry);
    return { confirmationId, expiresAt, broadcasterId: entry.broadcasterId, draft: structuredClone(draft), warning: 'Le sondage démarre immédiatement après confirmation.' };
  }
  async confirmPoll(actor: TwitchActor, confirmationId: string, confirmed: boolean,
    stillAuthorized?: () => Promise<boolean> | boolean) {
    this.authorize(actor, true);
    const entry = this.pending.get(confirmationId);
    if (confirmed !== true || !entry || entry.actor !== actor.id || entry.expiresAt <= this.now()) throw new AdvancedTwitchError('precondition');
    this.pending.delete(confirmationId); // Consume before any await: concurrent calls cannot replay.
    return this.api.createConfirmedPoll(entry.draft, entry.broadcasterId, true, stillAuthorized);
  }
}
