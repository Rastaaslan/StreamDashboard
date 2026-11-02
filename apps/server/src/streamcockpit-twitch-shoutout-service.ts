import { randomUUID } from 'node:crypto';
import { AdvancedTwitchError } from '../../../integrations/twitch/src/streamcockpit-advanced.js';
import { ShoutoutTwitch, type ShoutoutTarget } from '../../../integrations/twitch/src/streamcockpit-shoutout.js';
import type { TwitchActor } from './streamcockpit-twitch-service.js';

/** Bounded, one-use, in-memory confirmation; never persisted to Android. */
export class StreamcockpitShoutoutService {
  private pending = new Map<string, { actor:string; hostEpoch:string; target:ShoutoutTarget; expiresAt:number }>();
  constructor(private readonly api: ShoutoutTwitch, private readonly now=Date.now) {}

  private authorize(actor:TwitchActor) {
    if (!actor?.id || !actor.canRead || !actor.canInteract) throw new AdvancedTwitchError('forbidden');
  }
  async preview(actor:TwitchActor,input:unknown,hostEpoch:string) {
    if(!hostEpoch || hostEpoch.length>128)throw new AdvancedTwitchError('precondition');
    this.authorize(actor);
    const target=await this.api.preview(input);
    for(const [id,entry] of this.pending) if(entry.expiresAt<=this.now())this.pending.delete(id);
    if(this.pending.size>=100)throw new AdvancedTwitchError('unavailable');
    const confirmationId=randomUUID(),expiresAt=this.now()+45_000;
    this.pending.set(confirmationId,{actor:actor.id,hostEpoch,target,expiresAt});
    return {confirmationId,expiresAt,targetLogin:target.login,
      warning:'Le shoutout sera public sur Twitch dès confirmation. Twitch applique ses propres limites de fréquence.'};
  }
  async confirm(actor:TwitchActor,confirmationId:string,confirmed:boolean,
    hostEpoch:string,beforeSend:()=>Promise<void>) {
    this.authorize(actor);
    const entry=this.pending.get(confirmationId);
    if(confirmed!==true || !entry || entry.actor!==actor.id ||
        entry.hostEpoch!==hostEpoch || entry.expiresAt<=this.now())
      throw new AdvancedTwitchError('precondition');
    // Consume before any IO. An ambiguous provider outcome can NEVER be retried.
    this.pending.delete(confirmationId);
    return this.api.sendConfirmed(entry.target,true,beforeSend);
  }
}
