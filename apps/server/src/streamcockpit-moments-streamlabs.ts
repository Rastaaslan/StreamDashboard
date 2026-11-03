import { createHash } from 'node:crypto';
import type { StreamlabsEvent } from '../../../integrations/streamlabs/src/events.js';

interface Snapshot {
 connected:boolean; streamingKnown:boolean; streaming:boolean;
 connectionGeneration:number; streamEpoch:number; providerGeneration:number; providerConnected:boolean;
}
export interface StreamlabsObservation {
 sessionId:string; instant:number; correlationId:string; sourceEventId:string; title:string;
}
const titles:Record<string,string>={donation:'Don Streamlabs reçu',follow:'Follow Twitch reçu',subscription:'Abonnement Twitch reçu',bits:'Bits Twitch reçus',raid:'Raid Twitch reçu',host:'Accueil Twitch reçu',communitygift:'Cadeau Twitch reçu'};
/** Only the authenticated socket callback feeds this observer. No history import,
 * raw names/messages/amounts, provider commands or automatic journal retry.
 * Undated events mean receipt on FIXE, never a claimed provider occurrence. */
export class StreamlabsMomentProducer {
 private attempted=new Set<string>();
 private pending=new Set<Promise<void>>();
 private witness?:{generation:number;epoch:number;at:number};
 private stopped=false;
 constructor(private readonly options:{
  snapshot():Snapshot; host():Promise<string|undefined>; activeSessionId():Promise<string|undefined>;
  record(input:StreamlabsObservation):Promise<unknown>; now?:()=>number;
 }){}
 private now(){return(this.options.now??Date.now)()}
 observeState(){
  const s=this.options.snapshot();
  if(!s.connected||!s.streamingKnown||!s.streaming){this.witness=undefined;return}
  if(this.witness?.generation!==s.connectionGeneration||this.witness?.epoch!==s.streamEpoch)
   this.witness={generation:s.connectionGeneration,epoch:s.streamEpoch,at:this.now()};
 }
 observe(events:StreamlabsEvent[]):Promise<void>{
  if(this.stopped)return Promise.resolve();
  const snapshot={...this.options.snapshot()},instant=this.now(),witness=this.witness&&{...this.witness};
  const work=this.process(events,snapshot,instant,witness);
  this.pending.add(work);
  void work.finally(()=>this.pending.delete(work)).catch(()=>undefined);
  return work;
 }
 private async process(events:StreamlabsEvent[],snapshot:Snapshot,instant:number,witness:typeof this.witness){
  const valid=()=>{
   const s=this.options.snapshot();
   return !this.stopped&&s.connected&&s.streamingKnown&&s.streaming&&s.providerConnected&&
    s.connectionGeneration===snapshot.connectionGeneration&&s.streamEpoch===snapshot.streamEpoch&&
    s.providerGeneration===snapshot.providerGeneration;
  };
  if(!valid()||!witness||witness.generation!==snapshot.connectionGeneration||witness.epoch!==snapshot.streamEpoch||
    !Number.isSafeInteger(instant)||instant<witness.at||!Array.isArray(events)||events.length>500)return;
  for(const event of events){
   if(!event||event.test!==false||!['twitch','streamlabs'].includes(event.platform)||
     !Object.hasOwn(titles,event.type)||typeof event.id!=='string'||!/^[a-f0-9]{64}$/.test(event.id))continue;
   const received=Date.parse(event.receivedAt),occurred=event.occurredAt===null?null:Date.parse(event.occurredAt);
   if(!Number.isFinite(received)||received<instant-15_000||received>instant||
     occurred!==null&&(!Number.isFinite(occurred)||occurred<witness.at||occurred>instant))continue;
   const id='sl_'+createHash('sha256').update(event.platform+':'+event.type+':'+event.id).digest('hex');
   if(this.attempted.has(id))continue;
   // Match the journal's 10,000-marker bound; retain uncertain identities for
   // this whole runtime rather than evicting them and retrying an old event.
   if(this.attempted.size>=10000)throw new Error('MOMENTS_TOO_MANY');
   this.attempted.add(id);
   if(!valid())return;
   const host=await this.options.host();if(!host||!valid())return;
   const sessionId=await this.options.activeSessionId();if(!sessionId||!valid())return;
   if(await this.options.host()!==host||!valid())return;
   if(await this.options.activeSessionId()!==sessionId||!valid())return;
   if(await this.options.host()!==host||!valid())return;
   await this.options.record({sessionId,instant:received,sourceEventId:id,correlationId:id,title:titles[event.type]});
  }
 }
 /** Drain accepted writes; cancellation before the commit never repeats them.
  * As with OBS observations, an already-started disk commit cannot be undone. */
 async stop(){this.stopped=true;await Promise.allSettled([...this.pending])}
}
