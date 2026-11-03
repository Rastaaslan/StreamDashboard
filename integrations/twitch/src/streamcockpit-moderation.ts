import {createHash} from 'node:crypto';
import {AdvancedTwitchError,type AdvancedCredentials} from './streamcockpit-advanced.js';

export type ModerationChange={kind:'shield';value:boolean}|{kind:'automod';value:number};
export interface ModerationTarget {
  change:ModerationChange;broadcasterId:string;tokenStamp:string;
  previous:Record<string,boolean|number|null>;
}
const level=(v:unknown):v is number=>Number.isInteger(v)&&Number(v)>=0&&Number(v)<=4;
const fields=['aggression','bullying','disability','misogyny','race_ethnicity_or_religion','sex_based_terms','sexuality_sex_or_gender','swearing'];
const object=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
export function moderationChange(v:unknown):ModerationChange{
  const c=object(v);
  if(Object.keys(c).sort().join(',')!=='kind,value'||
    !(c.kind==='shield'&&typeof c.value==='boolean'||c.kind==='automod'&&level(c.value)))
    throw new AdvancedTwitchError('invalid');
  return c as ModerationChange;
}
/** Owner OAuth only. One explicit PUT, no refresh/retry of a public mutation. */
export class ModerationTwitch{
  constructor(private credentials:()=>AdvancedCredentials,private fetchApi:typeof fetch,private now=Date.now){}
  private stamp(c:AdvancedCredentials){return createHash('sha256').update(JSON.stringify(c)).digest('hex')}
  private current(s:{c:AdvancedCredentials;until:number}){
    if(this.now()>=s.until||this.stamp(this.credentials())!==this.stamp(s.c))
      throw new AdvancedTwitchError('unauthorized');
  }
  private async request(c:AdvancedCredentials,url:string,method='GET',body?:unknown){
    try{
      const response=await this.fetchApi(url,{method,redirect:'error',signal:AbortSignal.timeout(8000),
        headers:{Authorization:'Bearer '+c.accessToken,'Client-Id':c.clientId,'Content-Type':'application/json'},
        ...(body===undefined?{}:{body:JSON.stringify(body)})});
      if(!response.ok)throw new AdvancedTwitchError(method==='PUT'?'uncertain':
        response.status===401?'unauthorized':response.status===403?'forbidden':response.status===429?'rate-limited':'unavailable');
      return object(await response.json());
    }catch(error){if(error instanceof AdvancedTwitchError)throw error;throw new AdvancedTwitchError(method==='PUT'?'uncertain':'unavailable')}
  }
  private async session(kind:ModerationChange['kind']){
    const c={...this.credentials()},start=this.now();
    if(!c.accessToken||!c.clientId||!/^\d{1,30}$/.test(c.broadcasterId))throw new AdvancedTwitchError('unauthorized');
    const v=await this.request(c,'https://id.twitch.tv/oauth2/validate');
    const scope=kind==='shield'?'moderator:manage:shield_mode':'moderator:manage:automod_settings';
    if(v.client_id!==c.clientId||v.user_id!==c.broadcasterId||!Array.isArray(v.scopes)||!v.scopes.includes(scope)||
      typeof v.expires_in!=='number'||!Number.isFinite(v.expires_in)||v.expires_in<=0)
      throw new AdvancedTwitchError('forbidden');
    const s={c,until:Math.min(start+45_000,start+v.expires_in*1000)};
    this.current(s);return s;
  }
  private url(kind:ModerationChange['kind'],id:string){
    return 'https://api.twitch.tv/helix/moderation/'+(kind==='shield'?'shield_mode':'automod/settings')+
      '?'+new URLSearchParams({broadcaster_id:id,moderator_id:id});
  }
  private parse(kind:ModerationChange['kind'],data:Record<string,unknown>,id:string){
    if(!Array.isArray(data.data)||data.data.length!==1)throw new AdvancedTwitchError('unavailable');
    const row=object(data.data[0]);
    if(kind==='shield'){
      if(typeof row.is_active!=='boolean')throw new AdvancedTwitchError('unavailable');
      return {is_active:row.is_active} as Record<string,boolean|number|null>;
    }
    if(row.broadcaster_id!==id||row.moderator_id!==id||!(row.overall_level===null||level(row.overall_level))||
      fields.some(f=>!level(row[f])))throw new AdvancedTwitchError('unavailable');
    return Object.fromEntries(['overall_level',...fields].map(f=>[f,row[f]])) as Record<string,number|null>;
  }
  async preview(value:unknown):Promise<ModerationTarget>{
    const change=moderationChange(value),s=await this.session(change.kind);
    const previous=this.parse(change.kind,await this.request(s.c,this.url(change.kind,s.c.broadcasterId)),s.c.broadcasterId);
    this.current(s);
    return {change,broadcasterId:s.c.broadcasterId,tokenStamp:this.stamp(s.c),previous};
  }
  async confirm(target:ModerationTarget,beforeSend:()=>Promise<void>){
    const fresh=await this.preview(target.change);
    if(fresh.broadcasterId!==target.broadcasterId||fresh.tokenStamp!==target.tokenStamp||
      JSON.stringify(fresh.previous)!==JSON.stringify(target.previous))throw new AdvancedTwitchError('precondition');
    const s=await this.session(target.change.kind);
    if(this.stamp(s.c)!==target.tokenStamp)throw new AdvancedTwitchError('unauthorized');
    const key=target.change.kind==='shield'?'is_active':'overall_level';
    await beforeSend();this.current(s);
    if(fresh.previous[key]===target.change.value)return {status:'unchanged' as const,change:target.change};
    const body={[key]:target.change.value};
    const result=await this.request(s.c,this.url(target.change.kind,s.c.broadcasterId),'PUT',body);
    try{
      this.current(s);
      const returned=this.parse(target.change.kind,result,s.c.broadcasterId);
      const observed=this.parse(target.change.kind,await this.request(s.c,this.url(target.change.kind,s.c.broadcasterId)),s.c.broadcasterId);
      this.current(s);
      if(returned[key]!==target.change.value||observed[key]!==target.change.value)throw Error('READBACK');
    }catch{throw new AdvancedTwitchError('uncertain')}
    return {status:'confirmed' as const,change:target.change};
  }
}
