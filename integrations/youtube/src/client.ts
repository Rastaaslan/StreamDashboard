import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { SecretStore } from '../../../apps/server/src/storage.js';
import type { LiveMetadata } from '../../../packages/contracts/src/control.js';

interface Broadcast { id: string; snippet: { title: string; channelId: string; liveChatId?: string }; status: { lifeCycleStatus: string }; contentDetails: { boundStreamId?: string } }
interface VideoSnippet { title: string; description: string; categoryId: string; channelId: string; tags?: string[]; defaultLanguage?: string; defaultAudioLanguage?: string }
export class YouTubeClient {
  private attempt?: { state: string; verifier: string; redirect: string; clientId: string; expires: number };
  private refreshFlight?: Promise<Record<string,string>>;
  constructor(private secrets: SecretStore, private configuration: () => { clientId: string; broadcastId: string; channelId: string }, private request: typeof fetch = fetch) {}
  async status() { return { configured:Boolean(this.configuration().clientId), connected:Boolean((await this.secrets.getYouTubeTokens?.())?.refreshToken), ...this.configuration(), pending:Boolean(this.attempt && this.attempt.expires > Date.now()) }; }
  authorize(redirect: string) {
    const clientId = this.configuration().clientId;
    if (!clientId) throw new Error('Renseignez le Client ID Google Desktop pour YouTube.');
    const verifier = randomBytes(48).toString('base64url'), state = randomBytes(32).toString('base64url');
    this.attempt = { state, verifier, redirect, clientId, expires:Date.now()+600_000 };
    const params = new URLSearchParams({client_id:clientId, redirect_uri:redirect, response_type:'code', scope:'https://www.googleapis.com/auth/youtube.force-ssl', access_type:'offline', prompt:'consent', state, code_challenge:createHash('sha256').update(verifier).digest('base64url'), code_challenge_method:'S256'});
    return { url:`https://accounts.google.com/o/oauth2/v2/auth?${params}`, expiresAt:this.attempt.expires, openOn:'stream-host' };
  }
  private async tokenRequest(body: Record<string,string>) {
    const secret = await this.secrets.getGoogleClientSecret?.();
    const response = await this.request('https://oauth2.googleapis.com/token', {method:'POST', body:new URLSearchParams({...body,...(secret?{client_secret:secret}:{})}), signal:AbortSignal.timeout(15_000)});
    if (!response.ok) throw new Error(`Authentification YouTube refusée (${response.status}). Reconnectez le compte.`);
    return await response.json() as {access_token:string; refresh_token?:string; expires_in:number};
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
  private async api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const tokens=await this.tokens();
    const response=await this.request(`https://www.googleapis.com/youtube/v3/${path}`, {...init,headers:{Authorization:`Bearer ${tokens.accessToken}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(15_000)});
    if (!response.ok) throw new Error(`YouTube : requête refusée (${response.status}). Vérifiez autorisation, quota et diffusion sélectionnée.`);
    return await response.json() as T;
  }
  async broadcasts() {
    const value=await this.api<{items:Broadcast[]}>('liveBroadcasts?part=id,snippet,status,contentDetails&mine=true&maxResults=50');
    return value.items.filter(v=>v.status.lifeCycleStatus!=='complete'&&v.status.lifeCycleStatus!=='revoked').map(v=>({id:v.id,title:v.snippet.title,channelId:v.snippet.channelId,status:v.status.lifeCycleStatus,bound:Boolean(v.contentDetails.boundStreamId)}));
  }
  private async target() {
    const config=this.configuration(); if (!config.broadcastId || !config.channelId) throw new Error('Sélectionnez la diffusion YouTube et sa chaîne dans Configuration.');
    const value=await this.api<{items:Broadcast[]}>(`liveBroadcasts?part=id,snippet,status,contentDetails&id=${encodeURIComponent(config.broadcastId)}`);
    const target=value.items[0];
    if (!target || target.snippet.channelId!==config.channelId) throw new Error('La diffusion YouTube sélectionnée est absente ou appartient à une autre chaîne.');
    return target;
  }
  async live() { const target=await this.target(); return target.status.lifeCycleStatus==='live'; }
  async transition(start: boolean) {
    const target=await this.target();
    if (start && ['complete','revoked'].includes(target.status.lifeCycleStatus)) throw new Error('La diffusion YouTube est terminée. Sélectionnez une nouvelle diffusion préparée.');
    if ((start && target.status.lifeCycleStatus==='live') || (!start && target.status.lifeCycleStatus!=='live')) return;
    if (start) {
      if (!target.contentDetails.boundStreamId) throw new Error('Aucun flux lié à cette diffusion YouTube. Préparez la diffusion dans YouTube Studio.');
      const streams=await this.api<{items:Array<{status:{streamStatus:string}}>}>(`liveStreams?part=status&id=${encodeURIComponent(target.contentDetails.boundStreamId)}`);
      if (streams.items[0]?.status.streamStatus!=='active') return; // Confirmation loop waits for ingestion; no duplicate broadcast is created.
    }
    await this.api(`liveBroadcasts/transition?part=id,status&id=${encodeURIComponent(target.id)}&broadcastStatus=${start?'live':'complete'}`,{method:'POST'});
  }
  async update(value: LiveMetadata) {
    const target=await this.target();
    if (['complete','revoked'].includes(target.status.lifeCycleStatus)) throw new Error('La diffusion sélectionnée est terminée.');
    const result=await this.api<{items:Array<{id:string;snippet:VideoSnippet}>}>(`videos?part=snippet&id=${encodeURIComponent(target.id)}`);
    const snippet=result.items[0]?.snippet; if (!snippet || snippet.channelId!==this.configuration().channelId) throw new Error('Vidéo YouTube introuvable sur la chaîne sélectionnée.');
    // Retain writable fields omitted by the common form: videos.update replaces snippet properties.
    const updated={title:value.title,description:value.description,categoryId:value.youtubeCategoryId,tags:value.tags,...(snippet.defaultLanguage?{defaultLanguage:snippet.defaultLanguage}:{}),...(snippet.defaultAudioLanguage?{defaultAudioLanguage:snippet.defaultAudioLanguage}:{})};
    await this.api('videos?part=snippet',{method:'PUT',body:JSON.stringify({id:target.id,snippet:updated})});
    const check=await this.api<{items:Array<{snippet:VideoSnippet}>}>(`videos?part=snippet&id=${encodeURIComponent(target.id)}`);
    const actual=check.items[0]?.snippet;
    if (!actual || actual.title!==value.title || actual.description!==value.description || actual.categoryId!==value.youtubeCategoryId || JSON.stringify(actual.tags??[])!==JSON.stringify(value.tags)) throw new Error('YouTube n’a pas confirmé toutes les informations demandées.');
  }
  async chat(message: string) {
    const target=await this.target();
    if (target.status.lifeCycleStatus!=='live'||!target.snippet.liveChatId) throw new Error('Le chat de la diffusion YouTube sélectionnée est indisponible.');
    await this.api('liveChat/messages?part=snippet',{method:'POST',body:JSON.stringify({snippet:{liveChatId:target.snippet.liveChatId,type:'textMessageEvent',textMessageDetails:{messageText:message}}})});
  }
}
