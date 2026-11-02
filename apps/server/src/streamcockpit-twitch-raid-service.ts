import {randomUUID} from 'node:crypto';
import {AdvancedTwitchError} from '../../../integrations/twitch/src/streamcockpit-advanced.js';
import {RaidsTwitch,type RaidPlan} from '../../../integrations/twitch/src/streamcockpit-raids.js';
import type {TwitchActor} from './streamcockpit-twitch-service.js';

export class StreamcockpitRaidService{
  private pending=new Map<string,{actor:string;epoch:string;expiresAt:number;plan:RaidPlan}>();
  private sending=false;
  constructor(private readonly api:RaidsTwitch,private readonly now=Date.now){}
  private authorize(actor:TwitchActor,epoch:string):void{
    if(!actor?.id||!actor.canRead||!actor.canInteract||!epoch)throw new AdvancedTwitchError('forbidden');
  }
  async preview(actor:TwitchActor,input:unknown,epoch:string){
    this.authorize(actor,epoch);
    const plan=await this.api.preview(input),now=this.now();
    for(const [id,p] of this.pending)if(p.expiresAt<=now)this.pending.delete(id);
    if(this.pending.size>=100)throw new AdvancedTwitchError('unavailable');
    const confirmationId=randomUUID(),expiresAt=now+45000;
    this.pending.set(confirmationId,{actor:actor.id,epoch,expiresAt,plan});
    return {confirmationId,expiresAt,operation:plan.operation,
      ...(plan.operation==='start'?{targetLogin:plan.targetLogin}:{}),
      warning:plan.operation==='start'?'Après confirmation, Twitch prépare un raid public qui peut partir automatiquement. Vérifiez la cible.':
        'Demander à Twitch l’annulation du raid actuellement en attente sur votre chaîne. Sa présence n’est pas vérifiable par cette prévisualisation.'};
  }
  async confirm(actor:TwitchActor,id:string,confirmed:boolean,epoch:string,beforeSend:()=>Promise<void>){
    this.authorize(actor,epoch);
    const entry=this.pending.get(id);
    if(confirmed!==true||!entry||entry.actor!==actor.id||entry.epoch!==epoch||entry.expiresAt<=this.now())
      throw new AdvancedTwitchError('precondition');
    this.pending.delete(id); // Reserve synchronously before any provider await.
    if(this.sending)throw new AdvancedTwitchError('precondition');
    this.sending=true;
    try{return await this.api.sendConfirmed(entry.plan,true,beforeSend)}
    finally{this.sending=false}
  }
}
