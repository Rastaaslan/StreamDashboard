import { randomUUID } from 'node:crypto';
import { AdvancedTwitchError } from '../../../integrations/twitch/src/streamcockpit-advanced.js';
import { RaidTwitch, type RaidTarget } from '../../../integrations/twitch/src/streamcockpit-raid.js';
import type { TwitchActor } from './streamcockpit-twitch-service.js';

/** One-use explicit consent. Memory-only: restart always invalidates pending raids. */
export class StreamcockpitRaidService {
  private pending = new Map<string, { actor: string; hostEpoch: string; target: RaidTarget; expiresAt: number }>();
  constructor(private readonly api: RaidTwitch, private readonly now = Date.now) {}

  private authorize(actor: TwitchActor) {
    if (!actor?.id || !actor.canRead || !actor.canInteract)
      throw new AdvancedTwitchError('forbidden');
  }

  async preview(actor: TwitchActor, input: unknown, hostEpoch: string) {
    this.authorize(actor);
    if (!/^[0-9]{1,16}:[0-9]{1,16}$/.test(hostEpoch))
      throw new AdvancedTwitchError('precondition');
    const target = await this.api.preview(input);
    for (const [id, entry] of this.pending)
      if (entry.expiresAt <= this.now()) this.pending.delete(id);
    if (this.pending.size >= 100) throw new AdvancedTwitchError('unavailable');
    const confirmationId = randomUUID(), expiresAt = this.now() + 45_000;
    this.pending.set(confirmationId, { actor: actor.id, hostEpoch, target, expiresAt });
    return {
      confirmationId, expiresAt, targetLogin: target.login,
      warning: 'Le raid Twitch peut transférer automatiquement les spectateurs après 90 secondes. Vérifiez la destination avant de confirmer.',
    };
  }

  async confirm(actor: TwitchActor, confirmationId: string, confirmed: boolean,
      hostEpoch: string, beforeSend: () => Promise<void>) {
    this.authorize(actor);
    const entry = this.pending.get(confirmationId);
    if (confirmed !== true || !entry || entry.actor !== actor.id ||
        entry.hostEpoch !== hostEpoch || entry.expiresAt <= this.now())
      throw new AdvancedTwitchError('precondition');
    this.pending.delete(confirmationId); // Must occur before any asynchronous work.
    return this.api.sendConfirmed(entry.target, true, beforeSend);
  }
}
