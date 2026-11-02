import {AdvancedTwitchError,type AdvancedCredentials} from './streamcockpit-advanced.js';

export type RaidRequest={operation:'start';login:string}|{operation:'cancel'};
export type RaidPlan={operation:'start';broadcasterId:string;targetId:string;targetLogin:string}|
  {operation:'cancel';broadcasterId:string};
type Session={credentials:AdvancedCredentials;expiresAt:number};
const numeric=/^[0-9]{1,30}$/,loginPattern=/^[a-z0-9_]{4,25}$/;
const object=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
export function normalizeRaidRequest(value:unknown):RaidRequest{
  const v=object(value),keys=Object.keys(v).sort().join(',');
  if(v.operation==='cancel'&&keys==='operation')return {operation:'cancel'};
  if(v.operation==='start'&&keys==='login,operation'&&typeof v.login==='string'&&
    v.login===v.login.trim()&&loginPattern.test(v.login.toLowerCase()))
    return {operation:'start',login:v.login.toLowerCase()};
  throw new AdvancedTwitchError('invalid');
}
/** Twitch-only raid requests. The API accepts a PENDING raid, not an observed
 * transfer of viewers. No retry, background action, OBS stop or local countdown. */
export class RaidsTwitch{
  constructor(private readonly credentials:()=>AdvancedCredentials,
    private readonly fetchApi:typeof fetch,private readonly now=Date.now){}
  private current(s:Session):void{
    const c=this.credentials();
    if(this.now()>=s.expiresAt||c.clientId!==s.credentials.clientId||
      c.accessToken!==s.credentials.accessToken||c.broadcasterId!==s.credentials.broadcasterId)
      throw new AdvancedTwitchError('unauthorized');
  }
  private async read(c:AdvancedCredentials,url:string):Promise<Record<string,unknown>>{
    try{
      const res=await this.fetchApi(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(8000),
        headers:{Authorization:'Bearer '+c.accessToken,'Client-Id':c.clientId}});
      if(!res.ok)throw new AdvancedTwitchError(res.status===401?'unauthorized':res.status===403?'forbidden':
        res.status===429?'rate-limited':'unavailable');
      const v:unknown=await res.json();
      if(!v||typeof v!=='object'||Array.isArray(v))throw new AdvancedTwitchError('unavailable');
      return object(v);
    }catch(error){if(error instanceof AdvancedTwitchError)throw error;throw new AdvancedTwitchError('unavailable')}
  }
  private async session():Promise<Session>{
    const credentials={...this.credentials()},started=this.now();
    if(!credentials.clientId||!credentials.accessToken||!numeric.test(credentials.broadcasterId))
      throw new AdvancedTwitchError('unauthorized');
    const v=await this.read(credentials,'https://id.twitch.tv/oauth2/validate');
    if(v.client_id!==credentials.clientId||v.user_id!==credentials.broadcasterId||
      !Array.isArray(v.scopes)||!v.scopes.every(s=>typeof s==='string')||
      !v.scopes.includes('channel:manage:raids')||!Number.isFinite(v.expires_in)||Number(v.expires_in)<=0)
      throw new AdvancedTwitchError('forbidden');
    const s={credentials,expiresAt:Math.min(started+45000,started+Number(v.expires_in)*1000)};
    this.current(s);return s;
  }
  private async target(s:Session,login:string):Promise<{id:string;login:string}>{
    const users=await this.read(s.credentials,'https://api.twitch.tv/helix/users?login='+encodeURIComponent(login));
    if(!Array.isArray(users.data)||users.data.length!==1)throw new AdvancedTwitchError('precondition');
    const user=object(users.data[0]);
    if(user.login!==login||typeof user.id!=='string'||!numeric.test(user.id)||
      user.id===s.credentials.broadcasterId)throw new AdvancedTwitchError('precondition');
    // A target must be observed live now; the source live is proved by FIXE.
    const streams=await this.read(s.credentials,'https://api.twitch.tv/helix/streams?user_id='+user.id);
    const stream=object(Array.isArray(streams.data)&&streams.data.length===1?streams.data[0]:null);
    if(stream.user_id!==user.id||stream.user_login!==login||stream.type!=='live')
      throw new AdvancedTwitchError('precondition');
    this.current(s);return {id:user.id,login};
  }
  async preview(value:unknown):Promise<RaidPlan>{
    const request=normalizeRaidRequest(value),s=await this.session();
    if(request.operation==='cancel')return {operation:'cancel',broadcasterId:s.credentials.broadcasterId};
    const target=await this.target(s,request.login);
    return {operation:'start',broadcasterId:s.credentials.broadcasterId,targetId:target.id,targetLogin:target.login};
  }
  async sendConfirmed(input:RaidPlan,confirmed:boolean,beforeSend:()=>Promise<void>):
    Promise<{status:'requested'|'cancel-accepted';operation:'start'|'cancel';targetLogin?:string}>{
    const plan={...input}; // Freeze caller-owned identity before any await.
    if(confirmed!==true||!numeric.test(plan.broadcasterId)||
      !['start','cancel'].includes(plan.operation)||
      (plan.operation==='start'&&(!numeric.test(plan.targetId)||!loginPattern.test(plan.targetLogin))))
      throw new AdvancedTwitchError('precondition');
    const s=await this.session();
    if(s.credentials.broadcasterId!==plan.broadcasterId)throw new AdvancedTwitchError('precondition');
    if(plan.operation==='start'){
      const fresh=await this.target(s,plan.targetLogin);
      if(fresh.id!==plan.targetId)throw new AdvancedTwitchError('precondition');
    }
    this.current(s);await beforeSend();this.current(s);
    try{
      const query=new URLSearchParams(plan.operation==='start'?{
        from_broadcaster_id:plan.broadcasterId,to_broadcaster_id:plan.targetId,
      }:{broadcaster_id:plan.broadcasterId});
      const res=await this.fetchApi('https://api.twitch.tv/helix/raids?'+query,{
        method:plan.operation==='start'?'POST':'DELETE',redirect:'error',signal:AbortSignal.timeout(8000),
        headers:{Authorization:'Bearer '+s.credentials.accessToken,'Client-Id':s.credentials.clientId},
      });
      if(plan.operation==='cancel'){
        if(res.status!==204)throw new AdvancedTwitchError('uncertain');
        this.current(s);return {operation:'cancel',status:'cancel-accepted'};
      }
      if(res.status!==200)throw new AdvancedTwitchError('uncertain');
      const v=object(await res.json()),row=object(Array.isArray(v.data)&&v.data.length===1?v.data[0]:null);
      if(typeof row.created_at!=='string'||!Number.isFinite(Date.parse(row.created_at)))
        throw new AdvancedTwitchError('uncertain');
      this.current(s);return {operation:'start',status:'requested',targetLogin:plan.targetLogin};
    }catch{throw new AdvancedTwitchError('uncertain')}
  }
}
