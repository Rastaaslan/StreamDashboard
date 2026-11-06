import {createHash} from 'node:crypto';
import {AdvancedTwitchError,type AdvancedCredentials} from './streamcockpit-advanced.js';

// Twitch has no GET-by-message moderation status: a 204 only proves request acceptance,
// not that EventSub has observed the resulting decision.
export type HeldDecision='ALLOW'|'DENY';
export interface HeldActionTarget{
  broadcasterId:string;userId:string;messageId:string;decision:HeldDecision;tokenStamp:string;
}
const identifier=(v:unknown)=>typeof v==='string'&&/^\d{1,30}$/.test(v);
const messageId=(v:unknown)=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(v);
const stamp=(c:AdvancedCredentials)=>createHash('sha256').update(JSON.stringify(c)).digest('hex');

export class HeldAutoModActionTwitch{
  constructor(private credentials:()=>AdvancedCredentials,private fetchApi:typeof fetch,private now=Date.now){}
  private async session(){
    const c={...this.credentials()},start=this.now();
    if(!c.accessToken||!c.clientId||!identifier(c.broadcasterId))throw new AdvancedTwitchError('unauthorized');
    let data:Record<string,unknown>;
    try{
      const response=await this.fetchApi('https://id.twitch.tv/oauth2/validate',{
        method:'GET',redirect:'error',signal:AbortSignal.timeout(8000),
        headers:{Authorization:'OAuth '+c.accessToken},
      });
      if(!response.ok)throw new AdvancedTwitchError('unauthorized');
      data=await response.json() as Record<string,unknown>;
    }catch(error){
      if(error instanceof AdvancedTwitchError)throw error;
      throw new AdvancedTwitchError('unavailable');
    }
    if(data.client_id!==c.clientId||data.user_id!==c.broadcasterId||
      !Array.isArray(data.scopes)||!data.scopes.includes('moderator:manage:automod')||
      typeof data.expires_in!=='number'||!Number.isFinite(data.expires_in)||data.expires_in<=0)
      throw new AdvancedTwitchError('forbidden');
    const until=Math.min(start+30_000,start+data.expires_in*1000);
    if(this.now()>=until||stamp(this.credentials())!==stamp(c))throw new AdvancedTwitchError('unauthorized');
    return {c,until};
  }
  async preview(target:{broadcasterId:unknown;userId:unknown;messageId:unknown;decision:unknown}):Promise<HeldActionTarget>{
    if(!identifier(target.broadcasterId)||!identifier(target.userId)||!messageId(target.messageId)||
      !['ALLOW','DENY'].includes(String(target.decision)))throw new AdvancedTwitchError('invalid');
    const s=await this.session();
    if(s.c.broadcasterId!==target.broadcasterId)throw new AdvancedTwitchError('precondition');
    return {broadcasterId:s.c.broadcasterId,userId:target.userId as string,
      messageId:target.messageId as string,decision:target.decision as HeldDecision,tokenStamp:stamp(s.c)};
  }
  async confirm(target:HeldActionTarget,beforeSend:()=>Promise<void>){
    const s=await this.session();
    if(s.c.broadcasterId!==target.broadcasterId||stamp(s.c)!==target.tokenStamp)
      throw new AdvancedTwitchError('precondition');
    await beforeSend();
    if(this.now()>=s.until||stamp(this.credentials())!==stamp(s.c))
      throw new AdvancedTwitchError('unauthorized');
    try{
      const response=await this.fetchApi('https://api.twitch.tv/helix/moderation/automod/message',{
        method:'POST',redirect:'error',signal:AbortSignal.timeout(8000),
        headers:{Authorization:'Bearer '+s.c.accessToken,'Client-Id':s.c.clientId,'Content-Type':'application/json'},
        body:JSON.stringify({user_id:target.userId,msg_id:target.messageId,action:target.decision}),
      });
      if(!response.ok||response.status!==204)throw new AdvancedTwitchError('uncertain');
    }catch{throw new AdvancedTwitchError('uncertain')}
    return {status:'submitted-unverified' as const,decision:target.decision};
  }
}
