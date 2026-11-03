import {createHash} from 'node:crypto';
import {AdvancedTwitchError,type AdvancedCredentials} from './streamcockpit-advanced.js';
export interface SimpleMomentDraft {kind:'marker'|'clip';description:string}
export interface SimpleMomentTarget {draft:SimpleMomentDraft;broadcasterId:string;streamId:string;tokenStamp:string}
const object=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
export function simpleMomentDraft(v:unknown):SimpleMomentDraft{
  const d=object(v);
  if(Object.keys(d).sort().join(',')!=='description,kind'||!['marker','clip'].includes(String(d.kind))||
    typeof d.description!=='string'||[...d.description].length>140||/[\x00-\x1f\x7f]/.test(d.description))
    throw new AdvancedTwitchError('invalid');
  return {kind:d.kind as SimpleMomentDraft['kind'],description:d.description.trim()};
}
/** Original Twitch media only. No FFmpeg, local video file or editing pipeline. */
export class SimpleMomentsTwitch{
  constructor(private credentials:()=>AdvancedCredentials,private fetchApi:typeof fetch,private now=Date.now){}
  private stamp(c:AdvancedCredentials){return createHash('sha256').update(JSON.stringify(c)).digest('hex')}
  private current(s:{c:AdvancedCredentials;until:number}){
    if(this.now()>=s.until||this.stamp(this.credentials())!==this.stamp(s.c))throw new AdvancedTwitchError('unauthorized');
  }
  private async request(c:AdvancedCredentials,url:string,method='GET',body?:unknown){
    try{
      const res=await this.fetchApi(url,{method,redirect:'error',signal:AbortSignal.timeout(8000),headers:{
        Authorization:'Bearer '+c.accessToken,'Client-Id':c.clientId,'Content-Type':'application/json'},
        ...(body===undefined?{}:{body:JSON.stringify(body)})});
      if(!res.ok)throw new AdvancedTwitchError(method==='POST'?'uncertain':res.status===401?'unauthorized':res.status===403?'forbidden':res.status===429?'rate-limited':'unavailable');
      return object(await res.json());
    }catch(error){if(error instanceof AdvancedTwitchError)throw error;throw new AdvancedTwitchError(method==='POST'?'uncertain':'unavailable')}
  }
  private async session(kind:SimpleMomentDraft['kind']){
    const c={...this.credentials()},start=this.now();
    if(!c.clientId||!c.accessToken||!/^\d{1,30}$/.test(c.broadcasterId))throw new AdvancedTwitchError('unauthorized');
    const v=await this.request(c,'https://id.twitch.tv/oauth2/validate');
    if(v.client_id!==c.clientId||v.user_id!==c.broadcasterId||!Array.isArray(v.scopes)||
      !v.scopes.includes(kind==='marker'?'channel:manage:broadcast':'clips:edit')||
      typeof v.expires_in!=='number'||!Number.isFinite(v.expires_in)||v.expires_in<=0)
      throw new AdvancedTwitchError('forbidden');
    const s={c,until:Math.min(start+45_000,start+v.expires_in*1000)};this.current(s);return s;
  }
  async preview(value:unknown):Promise<SimpleMomentTarget>{
    const draft=simpleMomentDraft(value),s=await this.session(draft.kind);
    const live=await this.request(s.c,'https://api.twitch.tv/helix/streams?user_id='+s.c.broadcasterId);
    const stream=Array.isArray(live.data)&&live.data.length===1?object(live.data[0]):{};
    // A channel can stop and restart within the consent window. Bind consent to
    // the actual Twitch stream, not merely the broadcaster's current live flag.
    if(stream.user_id!==s.c.broadcasterId||stream.type!=='live'||
      typeof stream.id!=='string'||!/^\d{1,30}$/.test(stream.id))throw new AdvancedTwitchError('precondition');
    this.current(s);return {draft,broadcasterId:s.c.broadcasterId,streamId:stream.id,tokenStamp:this.stamp(s.c)};
  }
  async confirm(target:SimpleMomentTarget,beforeSend:()=>Promise<void>){
    const fresh=await this.preview(target.draft);
    if(fresh.broadcasterId!==target.broadcasterId||fresh.streamId!==target.streamId||
      fresh.tokenStamp!==target.tokenStamp)throw new AdvancedTwitchError('precondition');
    const s=await this.session(target.draft.kind);
    if(this.stamp(s.c)!==target.tokenStamp)throw new AdvancedTwitchError('unauthorized');
    await beforeSend();this.current(s);
    const marker=target.draft.kind==='marker';
    const value=await this.request(s.c,'https://api.twitch.tv/helix/'+(marker?'streams/markers':'clips?broadcaster_id='+s.c.broadcasterId),'POST',
      marker?{user_id:s.c.broadcasterId,description:target.draft.description}:undefined);
    try{
      this.current(s);
      if(!Array.isArray(value.data)||value.data.length!==1)throw Error('INVALID_RECEIPT');
      const row=object(value.data[0]),id=typeof row.id==='number'&&Number.isSafeInteger(row.id)?String(row.id):row.id;
      if(typeof id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(id))throw Error('INVALID_ID');
      if(marker){
        if(typeof row.created_at!=='string'||!Number.isFinite(Date.parse(row.created_at))||
          !Number.isSafeInteger(row.position_seconds)||Number(row.position_seconds)<0||row.description!==target.draft.description)throw Error('INVALID_MARKER');
        return {status:'confirmed' as const,kind:'marker' as const,id,instant:Date.parse(row.created_at),positionSeconds:Number(row.position_seconds)};
      }
      const url=new URL(String(row.edit_url));
      // A Twitch hostname alone is insufficient: bind the edit link to the
      // exact provider clip ID, default TLS port, and canonical edit route.
      // Never hand a different clip, arbitrary endpoint or tracking redirect
      // to the operator as the receipt of this confirmed request.
      if(url.protocol!=='https:'||url.hostname!=='clips.twitch.tv'||url.username||url.password||
        url.port||url.search||url.hash||url.pathname!==`/${id}/edit`)throw Error('INVALID_CLIP_LINK');
      // A successful Create Clip response acknowledges asynchronous processing.
      // Never describe this receipt as a verified playable video.
      return {status:'accepted' as const,kind:'clip' as const,id,instant:this.now(),editUrl:url.href};
    }catch{throw new AdvancedTwitchError('uncertain')}
  }
}
