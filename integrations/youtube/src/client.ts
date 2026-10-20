import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { SecretStore } from '../../../apps/server/src/storage.js';
import type { LiveMetadata } from '../../../packages/contracts/src/control.js';

interface Broadcast { id: string; snippet: { title: string; channelId: string; liveChatId?: string; scheduledStartTime?: string }; status: { lifeCycleStatus: string }; contentDetails: { boundStreamId?: string } }
interface YouTubeSelection { clientId: string; broadcastId: string; channelId: string }
interface VideoSnippet { title: string; description: string; categoryId: string; channelId: string; tags?: string[]; defaultLanguage?: string; defaultAudioLanguage?: string }
type MetadataField = 'title' | 'description' | 'categoryId' | 'tags';

const metadataFieldLabels: Record<MetadataField,string> = {title:'titre',description:'description',categoryId:'catégorie YouTube',tags:'tags'};
function sameTags(actual: unknown, expected: string[]) {
  const tags=actual === undefined ? [] : actual;
  if (!Array.isArray(tags) || tags.some(tag=>typeof tag !== 'string') || tags.length !== expected.length) return false;
  // Tag order has no meaning here; retain exact spelling and duplicate counts.
  const sortedExpected=[...expected].sort();
  return [...tags].sort().every((tag,index)=>tag===sortedExpected[index]);
}
function metadataDifferences(actual: VideoSnippet | undefined, expected: LiveMetadata): MetadataField[] {
  const fields: MetadataField[] = [];
  if (actual?.title !== expected.title) fields.push('title');
  if (actual?.description !== expected.description) fields.push('description');
  if (actual?.categoryId !== expected.youtubeCategoryId) fields.push('categoryId');
  if (!actual || !sameTags(actual.tags,expected.tags)) fields.push('tags');
  return fields;
}

/** Exposes field names only: provider payloads and metadata values stay out of errors. */
export class YouTubeMetadataVerificationError extends Error {
  readonly fields: MetadataField[];
  constructor(fields: MetadataField[]) {
    super('YouTube n’a pas confirmé les champs suivants : '+fields.map(field=>metadataFieldLabels[field]).join(', ')+'. Vérifiez ces champs dans YouTube Studio avant de réessayer.');
    this.name='YouTubeMetadataVerificationError';this.fields=[...fields];
  }
}
export interface YouTubeChannelIdentity { id: string; title: string; customUrl?: string }
export interface YouTubeBroadcastState { id:string; channelId:string; broadcastState:string; live:boolean; bound:boolean; ingestionStatus:string|null; observedAt:string }
export interface YouTubeMetadata { broadcastId:string; channelId:string; title:string; description:string; youtubeCategoryId:string; tags:string[] }
const reasonMessages: Record<string,string> = {
  authError:'Autorisation expirée ou invalide. Reconnectez YouTube.',
  invalid_grant:'Autorisation expirée ou révoquée. Reconnectez YouTube.',
  invalid_client:'Client ID et Client Secret Google incompatibles.',
  invalid_request:'Configuration OAuth incomplète. Vérifiez le Client ID et le Client Secret Google.',
  access_denied:'Autorisation YouTube refusée par le compte.',
  insufficientPermissions:'Autorisation insuffisante. Reconnectez le compte avec les droits YouTube.',
  insufficientLivePermissions:'Ce compte ne peut pas gérer cette diffusion YouTube.',
  liveStreamingNotEnabled:'Le direct n’est pas activé sur cette chaîne YouTube.',
  livePermissionBlocked:'La diffusion en direct est actuellement bloquée sur cette chaîne YouTube.',
  youtubeSignupRequired:'Aucune chaîne YouTube utilisable pour ce compte.',
  forbidden:'Opération non autorisée pour ce compte ou cette diffusion.',
  quotaExceeded:'Quota YouTube épuisé. Attendez son renouvellement.',
  dailyLimitExceeded:'Limite quotidienne YouTube atteinte.',
  rateLimitExceeded:'Trop de requêtes YouTube. Attendez avant de réessayer.',
  userRequestsExceedRateLimit:'Trop de requêtes YouTube. Attendez avant de réessayer.',
  concurrentBroadcastsExceedLimit:'Limite de diffusions simultanées atteinte.',
  sharedIngestionBroadcastsExceedLimit:'Ce flux alimente déjà le nombre maximal de diffusions.',
  liveBroadcastNotFound:'Diffusion YouTube introuvable. Vérifiez la chaîne et la cible.',
  liveStreamNotFound:'Flux YouTube introuvable.',
  videoNotFound:'Vidéo YouTube introuvable.',
  errorStreamInactive:'YouTube ne reçoit pas encore le flux lié. Vérifiez la sortie OBS.',
  invalidTransition:'Transition impossible dans cet état. Vérifiez la diffusion dans YouTube Studio.',
  redundantTransition:'La diffusion est déjà dans cet état ou sa transition est en cours.',
  errorExecutingTransition:'YouTube n’a pas confirmé la transition. Vérifiez son état avant de recommencer.',
  backendError:'Service YouTube temporairement indisponible.',
  networkError:'Réponse YouTube non reçue. Vérifiez la connexion et le résultat.',
  invalidResponse:'Réponse YouTube incomplète ou illisible.',
  invalidPagination:'Pagination YouTube incohérente. Rechargez la liste.',
  catalogTooLarge:'Le catalogue YouTube dépasse la limite de lecture complète.',
  unknown:'Requête refusée. Vérifiez le compte, ses autorisations et la diffusion sélectionnée.',
};
/** Never expose provider bodies, token values, or arbitrary provider messages. */
export class YouTubeApiError extends Error {
  readonly httpStatus:number;
  readonly reason:string;
  constructor(httpStatus:number, reason:string) {
    const safeReason=Object.hasOwn(reasonMessages,reason)?reason:'unknown';
    super('YouTube : '+reasonMessages[safeReason]+' ('+(httpStatus?'HTTP '+httpStatus+' · ':'')+safeReason+')');
    this.name='YouTubeApiError';this.httpStatus=httpStatus;this.reason=safeReason;
  }
}
async function responseError(response:Response) {
  const body=await response.json().catch(()=>null) as {error?:string|{errors?:Array<{reason?:string}>}}|null;
  const candidates=typeof body?.error==='string'?[body.error]:Array.isArray(body?.error?.errors)?body.error.errors.map(item=>item?.reason):[];
  const reason=candidates.find(value=>typeof value==='string'&&Object.hasOwn(reasonMessages,value));
  return new YouTubeApiError(response.status,reason||(response.status===401?'authError':response.status===429?'rateLimitExceeded':response.status>=500?'backendError':response.status===403?'forbidden':'unknown'));
}
const uncertainTransition=(message:string)=>Object.assign(new Error('Transition YouTube non confirmée. '+message+' Vérifiez son état avant une nouvelle commande.'),{name:'ACTION_UNCERTAIN'});
const transientObservation=(error:unknown)=>error instanceof YouTubeApiError&&(error.httpStatus===0||error.httpStatus>=500||error.reason==='invalidResponse');
const observationUnavailable=(error:YouTubeApiError)=>Object.assign(new Error('Lecture YouTube temporairement indisponible. '+error.message),{name:'ACTION_OBSERVATION_UNAVAILABLE'});

export class YouTubeClient {
  private attempt?: { state: string; verifier: string; redirect: string; clientId: string; expires: number };
  private refreshFlight?: Promise<Record<string,string>>;
  private transitionAttempts = new Set<string>();
  constructor(private secrets: SecretStore, private configuration: () => YouTubeSelection, private request: typeof fetch = fetch) {}
  private selection(): YouTubeSelection { return {...this.configuration()}; }
  private assertSelection(selected: YouTubeSelection) {
    const current=this.configuration();
    if (current.clientId!==selected.clientId || current.channelId!==selected.channelId || current.broadcastId!==selected.broadcastId) throw new Error('La cible YouTube a changé pendant la lecture. Actualisez les informations.');
  }
  async status() {
    const configuration=this.configuration(),tokens=await this.secrets.getYouTubeTokens?.();
    return {configured:Boolean(configuration.clientId),connected:Boolean(configuration.clientId&&tokens?.refreshToken&&tokens.clientId===configuration.clientId),...configuration,pending:Boolean(this.attempt&&this.attempt.clientId===configuration.clientId&&this.attempt.expires>Date.now())};
  }
  authorize(redirect: string) {
    const clientId = this.configuration().clientId;
    if (!clientId) throw new Error('Renseignez le Client ID Google Desktop pour YouTube.');
    const verifier = randomBytes(48).toString('base64url'), state = randomBytes(32).toString('base64url');
    this.attempt = { state, verifier, redirect, clientId, expires:Date.now()+600_000 };
    const params = new URLSearchParams({client_id:clientId, redirect_uri:redirect, response_type:'code', scope:'https://www.googleapis.com/auth/youtube.force-ssl', access_type:'offline', prompt:'consent', state, code_challenge:createHash('sha256').update(verifier).digest('base64url'), code_challenge_method:'S256'});
    return { url:`https://accounts.google.com/o/oauth2/v2/auth?${params}`, expiresAt:this.attempt.expires, openOn:'stream-host' };
  }
  private async tokenRequest(body:Record<string,string>) {
    const secret=await this.secrets.getGoogleClientSecret?.();
    const response=await this.request('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({...body,...(secret?{client_secret:secret}:{})}),signal:AbortSignal.timeout(15_000)})
      .catch(()=>{throw new YouTubeApiError(0,'networkError');});
    if(!response.ok)throw await responseError(response);
    const value=await response.json().catch(()=>{throw new YouTubeApiError(response.status,'invalidResponse');}) as {access_token:string;refresh_token?:string;expires_in:number};
    if(typeof value?.access_token!=='string'||!value.access_token||!Number.isFinite(value.expires_in)||value.expires_in<=0)throw new YouTubeApiError(response.status,'invalidResponse');
    return value;
  }
  async exchange(code: string, state: string) {
    const attempt = this.attempt;
    if (!attempt || attempt.expires < Date.now() || state.length !== attempt.state.length || !timingSafeEqual(Buffer.from(state),Buffer.from(attempt.state)) || !code || code.length > 4000) throw new Error('Retour OAuth expiré ou invalide.');
    this.attempt = undefined;
    if (attempt.clientId !== this.configuration().clientId) throw new Error('Configuration YouTube modifiée pendant la connexion.');
    const value = await this.tokenRequest({client_id:attempt.clientId,code,code_verifier:attempt.verifier,redirect_uri:attempt.redirect,grant_type:'authorization_code'});
    if (!value.refresh_token || !value.access_token || !this.secrets.setYouTubeTokens) throw new Error('Autorisation YouTube incomplète. Reconnectez le compte.');
    await this.secrets.setYouTubeTokens({clientId:attempt.clientId, accessToken:value.access_token,refreshToken:value.refresh_token,expiresAt:String(Date.now()+value.expires_in*1000)});
  }
  async disconnect() { this.attempt=undefined; await this.secrets.clearYouTubeTokens?.(); }
  private async tokens() {
    const tokens = await this.secrets.getYouTubeTokens?.();
    if (!tokens?.refreshToken || tokens.clientId !== this.configuration().clientId) throw new Error('Connectez YouTube dans Configuration.');
    if (Number(tokens.expiresAt)>Date.now()+60_000) return tokens;
    if (!this.refreshFlight) {
      this.refreshFlight=(async()=>{const value=await this.tokenRequest({client_id:tokens.clientId,refresh_token:tokens.refreshToken,grant_type:'refresh_token'}); const next={...tokens,accessToken:value.access_token,expiresAt:String(Date.now()+value.expires_in*1000)}; await this.secrets.setYouTubeTokens?.(next); return next;})();
      void this.refreshFlight.finally(()=>{this.refreshFlight=undefined;}).catch(()=>{});
    }
    return this.refreshFlight;
  }
  private async api<T>(path:string,init:RequestInit={},selected?:YouTubeSelection):Promise<T> {
    if(selected)this.assertSelection(selected);
    const tokens=await this.tokens();
    if(selected)this.assertSelection(selected);
    const response=await this.request('https://www.googleapis.com/youtube/v3/'+path,{...init,headers:{Authorization:'Bearer '+tokens.accessToken,'Content-Type':'application/json'},signal:AbortSignal.timeout(15_000)})
      .catch(()=>{throw new YouTubeApiError(0,'networkError');});
    if(!response.ok)throw await responseError(response);
    return await response.json().catch(()=>{throw new YouTubeApiError(response.status,'invalidResponse');}) as T;
  }
  private async pages<T>(resource:string,parameters:Record<string,string>):Promise<T[]> {
    const items:T[]=[],seen=new Set<string>();let pageToken='';
    for(let page=0;page<100;page++){
      const query=new URLSearchParams({...parameters,maxResults:'50',...(pageToken?{pageToken}:{})});
      const result=await this.api<{items?:T[];nextPageToken?:string}>(resource+'?'+query);
      if(!Array.isArray(result.items))throw new YouTubeApiError(200,'invalidResponse');
      items.push(...result.items);
      if(!result.nextPageToken)return items;
      if(typeof result.nextPageToken!=='string'||result.nextPageToken.length>2000||seen.has(result.nextPageToken))throw new YouTubeApiError(200,'invalidPagination');
      seen.add(result.nextPageToken);pageToken=result.nextPageToken;
    }
    throw new YouTubeApiError(200,'catalogTooLarge');
  }
  async broadcasts() {
    const items=await this.pages<Broadcast>('liveBroadcasts',{part:'id,snippet,status,contentDetails',mine:'true',broadcastType:'all'});
    return [...new Map(items.filter(v=>v.status.lifeCycleStatus!=='complete'&&v.status.lifeCycleStatus!=='revoked').map(v=>[v.id,v])).values()]
      .map(v=>({id:v.id,title:v.snippet.title,channelId:v.snippet.channelId,status:v.status.lifeCycleStatus,bound:Boolean(v.contentDetails.boundStreamId),scheduledStartTime:v.snippet.scheduledStartTime||null}));
  }
  async authorizedChannels():Promise<YouTubeChannelIdentity[]> {
    const items=await this.pages<{id:string;snippet:{title:string;customUrl?:string}}>('channels',{part:'id,snippet',mine:'true'});
    return [...new Map(items.map(item=>[item.id,item])).values()].map(item=>({id:item.id,title:item.snippet.title,...(item.snippet.customUrl?{customUrl:item.snippet.customUrl}:{})}));
  }
  private async target(selected=this.selection()) {
    if (!selected.broadcastId || !selected.channelId) throw new Error('Sélectionnez la diffusion YouTube et sa chaîne dans Configuration.');
    const value=await this.api<{items?:Broadcast[]}>(`liveBroadcasts?part=id,snippet,status,contentDetails&id=${encodeURIComponent(selected.broadcastId)}`,{},selected);
    this.assertSelection(selected);
    const target=Array.isArray(value.items)?value.items.find(item=>item?.id===selected.broadcastId):undefined;
    if (!target || target.snippet?.channelId!==selected.channelId) throw new Error('La diffusion YouTube sélectionnée est absente ou appartient à une autre chaîne.');
    if (typeof target.status?.lifeCycleStatus!=='string' || !target.contentDetails || typeof target.contentDetails!=='object') throw new YouTubeApiError(200,'invalidResponse');
    return target;
  }
  private assertStartTarget(target: Broadcast) {
    if (['complete','revoked'].includes(target.status.lifeCycleStatus)) throw new Error('La diffusion YouTube est terminée. Sélectionnez une nouvelle diffusion préparée.');
    if (!target.contentDetails.boundStreamId) throw new Error('Aucun flux lié à cette diffusion YouTube. Préparez la diffusion dans YouTube Studio.');
  }
  /** Read-only preflight, called before starting the associated OBS output. */
  async assertStartable():Promise<void> {
    const selected=this.selection(),target=await this.target(selected);
    this.assertStartTarget(target);
  }
  async broadcastState():Promise<YouTubeBroadcastState> {
    const selected=this.selection(),target=await this.target(selected);
    const streamId=target.contentDetails.boundStreamId;
    let ingestionStatus:string|null=null;
    if(streamId){
      // Only status is requested: ingestion addresses and stream keys never enter this response.
      const streams=await this.api<{items:Array<{status?:{streamStatus?:string}}>} >('liveStreams?part=status&id='+encodeURIComponent(streamId),{},selected);
      this.assertSelection(selected);
      const status=streams.items?.[0]?.status?.streamStatus;
      if(typeof status==='string')ingestionStatus=status;
    }
    const broadcastState=target.status.lifeCycleStatus;
    return {id:target.id,channelId:target.snippet.channelId,broadcastState,live:broadcastState==='live',bound:Boolean(streamId),ingestionStatus,observedAt:new Date().toISOString()};
  }
  async live() { const target=await this.target(); return target.status.lifeCycleStatus==='live'; }
  /** Read only the selected broadcast's public metadata; never exposes provider bodies or tokens. */
  async readMetadata():Promise<YouTubeMetadata> {
    const selected=this.selection(),target=await this.target(selected);
    if (target.id!==selected.broadcastId || target.snippet.channelId!==selected.channelId) throw new Error('La diffusion YouTube relue ne correspond pas à la cible sélectionnée.');
    const result=await this.api<{items?:Array<{id:string;snippet?:VideoSnippet}>}>(`videos?part=snippet&id=${encodeURIComponent(target.id)}`,{},selected);
    this.assertSelection(selected);
    const video=Array.isArray(result.items)?result.items.find(item=>item?.id===target.id):undefined,snippet=video?.snippet;
    if (!snippet || snippet.channelId!==selected.channelId) throw new Error('Vidéo YouTube introuvable sur la chaîne sélectionnée.');
    if (typeof snippet.title!=='string' || typeof snippet.description!=='string' || typeof snippet.categoryId!=='string' || (snippet.tags!==undefined && (!Array.isArray(snippet.tags) || snippet.tags.some(tag=>typeof tag!=='string')))) throw new YouTubeApiError(200,'invalidResponse');
    return {broadcastId:target.id,channelId:snippet.channelId,title:snippet.title,description:snippet.description,youtubeCategoryId:snippet.categoryId,tags:[...(snippet.tags??[])]};
  }
  async transition(start:boolean,operationId='') {
    const selected=this.selection(),key=JSON.stringify([selected.clientId,selected.channelId,selected.broadcastId,start,operationId]);
    let target:Broadcast;
    try{target=await this.target(selected);}
    catch(error){
      if(this.transitionAttempts.has(key))throw uncertainTransition(error instanceof Error?error.message:'État indisponible.');
      if(transientObservation(error))throw observationUnavailable(error as YouTubeApiError);
      throw error;
    }
    if(start&&['complete','revoked'].includes(target.status.lifeCycleStatus))throw new Error('La diffusion YouTube est terminée. Sélectionnez une nouvelle diffusion préparée.');
    if((start&&['live','liveStarting','testStarting'].includes(target.status.lifeCycleStatus))||(!start&&target.status.lifeCycleStatus!=='live'))return;
    // A stale observation must not repeat an accepted or unacknowledged POST.
    if(this.transitionAttempts.has(key))return;
    if(start){
      this.assertStartTarget(target);
      let streams:{items:Array<{status:{streamStatus:string}}>};
      try{streams=await this.api('liveStreams?part=status&id='+encodeURIComponent(target.contentDetails.boundStreamId!),{},selected);}
      catch(error){if(transientObservation(error))throw observationUnavailable(error as YouTubeApiError);throw error;}
      this.assertSelection(selected);
      if(streams.items[0]?.status.streamStatus!=='active')return;
    }
    // Another caller may have sent the same operation while ingestion was being read.
    if(this.transitionAttempts.has(key))return;
    this.transitionAttempts.add(key);
    if(this.transitionAttempts.size>256)this.transitionAttempts.delete(this.transitionAttempts.values().next().value!);
    try{
      await this.api('liveBroadcasts/transition?part=id,status&id='+encodeURIComponent(target.id)+'&broadcastStatus='+(start?'live':'complete'),{method:'POST'},selected);
    }catch(error){
      if(error instanceof YouTubeApiError&&error.reason==='redundantTransition'){
        let observed:Broadcast;
        try{observed=await this.target(selected);}
        catch(readError){throw uncertainTransition(readError instanceof Error?readError.message:'État indisponible.');}
        if(start&&['complete','revoked'].includes(observed.status.lifeCycleStatus))throw new Error('La diffusion YouTube est terminée. Sélectionnez une nouvelle diffusion préparée.');
        return;
      }
      if(!(error instanceof YouTubeApiError)||error.httpStatus===0||error.httpStatus>=500||error.reason==='invalidResponse')throw uncertainTransition(error instanceof Error?error.message:'Réponse non reçue.');
      this.transitionAttempts.delete(key);
      throw error;
    }
  }
  async update(value: LiveMetadata) {
    const selected=this.selection(),target=await this.target(selected);
    if (['complete','revoked'].includes(target.status.lifeCycleStatus)) throw new Error('La diffusion sélectionnée est terminée.');
    const result=await this.api<{items:Array<{id:string;snippet:VideoSnippet}>}>(`videos?part=snippet&id=${encodeURIComponent(target.id)}`,{},selected);
    this.assertSelection(selected);
    const snippet=result.items.find(item=>item.id===target.id)?.snippet; if (!snippet || snippet.channelId!==selected.channelId) throw new Error('Vidéo YouTube introuvable sur la chaîne sélectionnée.');
    // Retain writable fields omitted by the common form: videos.update replaces snippet properties.
    const updated={title:value.title,description:value.description,categoryId:value.youtubeCategoryId,tags:value.tags,...(snippet.defaultLanguage?{defaultLanguage:snippet.defaultLanguage}:{}),...(snippet.defaultAudioLanguage?{defaultAudioLanguage:snippet.defaultAudioLanguage}:{})};
    await this.api('videos?part=snippet',{method:'PUT',body:JSON.stringify({id:target.id,snippet:updated})},selected);
    const check=await this.api<{items:Array<{id:string;snippet:VideoSnippet}>}>(`videos?part=snippet&id=${encodeURIComponent(target.id)}`,{},selected);
    this.assertSelection(selected);
    const actual=check.items.find(item=>item.id===target.id&&item.snippet.channelId===selected.channelId)?.snippet;
    const differences=metadataDifferences(actual,value);
    if (differences.length) throw new YouTubeMetadataVerificationError(differences);
  }
  async chat(message: string) {
    const selected=this.selection(),target=await this.target(selected);
    if (target.status.lifeCycleStatus!=='live'||!target.snippet.liveChatId) throw new Error('Le chat de la diffusion YouTube sélectionnée est indisponible.');
    await this.api('liveChat/messages?part=snippet',{method:'POST',body:JSON.stringify({snippet:{liveChatId:target.snippet.liveChatId,type:'textMessageEvent',textMessageDetails:{messageText:message}}})},selected);
  }
}
