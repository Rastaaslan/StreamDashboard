import { createHash } from 'node:crypto';
import { AdvancedTwitchError, type AdvancedCredentials } from './streamcockpit-advanced.js';

const ids = /^[A-Za-z0-9-]{1,128}$/;
const numeric = /^[0-9]{1,30}$/;
const object = (input: unknown): Record<string, unknown> =>
  input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
export type PredictionEndAction = 'RESOLVED' | 'CANCELED';
export interface PredictionEndChoice { id: string; title: string }
export interface PredictionEndDraft {
  action: PredictionEndAction;
  winnerId?: string;
}
export function normalizePredictionEnd(input: unknown): PredictionEndDraft {
  const row = object(input);
  if (row.action === 'CANCELED' && Object.keys(row).join(',') === 'action')
    return { action:'CANCELED' };
  if (row.action === 'RESOLVED' && Object.keys(row).sort().join(',') === 'action,winnerId' &&
      typeof row.winnerId === 'string' && ids.test(row.winnerId))
    return { action:'RESOLVED', winnerId:row.winnerId };
  throw new AdvancedTwitchError('invalid');
}

/** F08: source-only terminal PATCH. The calling FIXE router owns the unique
 * one-use consent, OBS epoch and committed SQLite intent BEFORE provider IO. */
export class PredictionEndTwitch {
  constructor(private readonly credentials: () => AdvancedCredentials,
    private readonly fetchApi: typeof fetch, private readonly now=Date.now) {}
  private fingerprint(c: AdvancedCredentials) {
    return createHash('sha256').update(c.clientId+':'+c.broadcasterId+':'+c.accessToken).digest('hex');
  }
  private assertCurrent(c: AdvancedCredentials, until: number) {
    const current = this.credentials();
    if (this.now() >= until || current.accessToken !== c.accessToken ||
        current.clientId !== c.clientId || current.broadcasterId !== c.broadcasterId)
      throw new AdvancedTwitchError('unauthorized');
  }
  private async get(c: AdvancedCredentials, url: string) {
    let response: Response;
    try {
      response = await this.fetchApi(url, {
        method:'GET', redirect:'error', signal:AbortSignal.timeout(8000),
        headers:{Authorization:'Bearer '+c.accessToken,'Client-Id':c.clientId},
      });
    } catch { throw new AdvancedTwitchError('unavailable'); }
    if (!response.ok) throw new AdvancedTwitchError(response.status===401?'unauthorized':
      response.status===403?'forbidden':response.status===429?'rate-limited':'unavailable');
    try { return object(await response.json()); }
    catch { throw new AdvancedTwitchError('unavailable'); }
  }

  async inspect(id: string, owner: string) {
    if (!ids.test(id) || !numeric.test(owner)) throw new AdvancedTwitchError('precondition');
    const c={...this.credentials()}, started=this.now();
    if (!c.clientId || !c.accessToken || c.broadcasterId !== owner)
      throw new AdvancedTwitchError('unauthorized');
    const validation=await this.get(c,'https://id.twitch.tv/oauth2/validate');
    if (validation.client_id!==c.clientId || validation.user_id!==owner ||
        !Array.isArray(validation.scopes) || !validation.scopes.every(x=>typeof x==='string') ||
        !validation.scopes.includes('channel:manage:predictions') ||
        typeof validation.expires_in!=='number' || !Number.isFinite(validation.expires_in) ||
        validation.expires_in<=0) throw new AdvancedTwitchError('forbidden');
    const until=Math.min(started+30_000,started+validation.expires_in*1000);
    this.assertCurrent(c,until);
    const data=await this.get(c,'https://api.twitch.tv/helix/predictions?broadcaster_id='+
      encodeURIComponent(owner)+'&id='+encodeURIComponent(id));
    this.assertCurrent(c,until);
    if (!Array.isArray(data.data) || data.data.length!==1)
      throw new AdvancedTwitchError('precondition');
    const item=object(data.data[0]);
    if (item.id!==id || item.broadcaster_id!==owner ||
        !['ACTIVE','LOCKED'].includes(String(item.status)) ||
        !Array.isArray(item.outcomes) || item.outcomes.length<2 || item.outcomes.length>10)
      throw new AdvancedTwitchError('precondition');
    const outcomes:PredictionEndChoice[]=[];
    for (const entry of item.outcomes) {
      const row=object(entry);
      if (typeof row.id!=='string' || !ids.test(row.id) ||
          typeof row.title!=='string' || !row.title.trim() ||
          [...row.title].length>25) throw new AdvancedTwitchError('unavailable');
      outcomes.push({id:row.id,title:row.title});
    }
    if (new Set(outcomes.map(x=>x.id)).size!==outcomes.length)
      throw new AdvancedTwitchError('unavailable');
    return {status:item.status as 'ACTIVE'|'LOCKED',outcomes,
      owner,id,fingerprint:this.fingerprint(c),until};
  }

  validateChoice(observation: Awaited<ReturnType<PredictionEndTwitch['inspect']>>,
    draft: PredictionEndDraft) {
    if (draft.action==='RESOLVED') {
      // Resolve only a LOCKED prediction: end users must have stopped voting.
      if (observation.status!=='LOCKED' ||
          !observation.outcomes.some(choice=>choice.id===draft.winnerId))
        throw new AdvancedTwitchError('precondition');
    } else if (draft.action!=='CANCELED') throw new AdvancedTwitchError('invalid');
  }

  async endConfirmed(id: string, owner: string, fingerprint: string, draft: PredictionEndDraft,
    beforePatch:(observedStatus:'ACTIVE'|'LOCKED')=>Promise<void>) {
    const observation=await this.inspect(id,owner);
    if (observation.fingerprint!==fingerprint) throw new AdvancedTwitchError('precondition');
    this.validateChoice(observation,draft);
    const c={...this.credentials()};
    // Host must first recheck pairing+OBS and durably commit its intent.
    await beforePatch(observation.status);
    this.assertCurrent(c,observation.until);
    try {
      const body = {broadcaster_id:owner,id,status:draft.action,
        ...(draft.action==='RESOLVED'?{winning_outcome_id:draft.winnerId}:{})};
      const response=await this.fetchApi('https://api.twitch.tv/helix/predictions',{
        method:'PATCH',redirect:'error',signal:AbortSignal.timeout(8000),
        headers:{Authorization:'Bearer '+c.accessToken,'Client-Id':c.clientId,
          'Content-Type':'application/json'},body:JSON.stringify(body),
      });
      if (!response.ok) throw Error('Unconfirmed end');
      const payload=object(await response.json());
      const item=object(Array.isArray(payload.data) && payload.data.length===1?payload.data[0]:null);
      this.assertCurrent(c,observation.until);
      if (item.id!==id || item.broadcaster_id!==owner || item.status!==draft.action ||
          (draft.action==='RESOLVED' && item.winning_outcome_id!==draft.winnerId))
        throw Error('Unconfirmed end receipt');
      return {predictionId:id,status:draft.action.toLowerCase() as 'resolved'|'canceled'};
    } catch { throw new AdvancedTwitchError('uncertain'); }
  }
}
