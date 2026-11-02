import { createHash } from 'node:crypto';
import { AdvancedTwitchError, type AdvancedCredentials } from './streamcockpit-advanced.js';

const id = /^[0-9]{1,30}$/;
const value = (x: unknown): Record<string, unknown> =>
  x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : {};

export interface PredictionCreateDraft {
  title: string;
  outcomes: string[];
  predictionWindow: number;
}
export function normalizePredictionCreate(input: unknown): PredictionCreateDraft {
  const row = value(input);
  if (Object.keys(row).sort().join(',') !== 'outcomes,predictionWindow,title' ||
      typeof row.title !== 'string' || !Array.isArray(row.outcomes) ||
      !row.outcomes.every(x => typeof x === 'string') ||
      !Number.isInteger(row.predictionWindow) ||
      Number(row.predictionWindow) < 30 || Number(row.predictionWindow) > 1800)
    throw new AdvancedTwitchError('invalid');
  const title = row.title.trim();
  const outcomes = (row.outcomes as string[]).map(x => x.trim());
  if (!title || [...title].length > 45 || outcomes.length < 2 || outcomes.length > 10 ||
      outcomes.some(x => !x || [...x].length > 25) || new Set(outcomes).size !== outcomes.length)
    throw new AdvancedTwitchError('invalid');
  return { title, outcomes, predictionWindow: Number(row.predictionWindow) };
}

/** Source-only F08 mutation. No global fetch, retry, token storage or live control. */
export class PredictionCreateTwitch {
  constructor(private readonly credentials: () => AdvancedCredentials,
    private readonly fetchApi: typeof fetch, private readonly now = Date.now) {}

  private fingerprint(c: AdvancedCredentials) {
    return createHash('sha256').update(c.clientId + ':' + c.broadcasterId + ':' + c.accessToken).digest('hex');
  }
  private assertCurrent(c: AdvancedCredentials, expiresAt: number) {
    const current = this.credentials();
    if (this.now() >= expiresAt || current.clientId !== c.clientId ||
        current.accessToken !== c.accessToken || current.broadcasterId !== c.broadcasterId)
      throw new AdvancedTwitchError('unauthorized');
  }
  private async get(c: AdvancedCredentials, url: string): Promise<Record<string, unknown>> {
    try {
      const response = await this.fetchApi(url, {
        method: 'GET', redirect: 'error', signal: AbortSignal.timeout(8000),
        headers: { Authorization: 'Bearer ' + c.accessToken, 'Client-Id': c.clientId },
      });
      if (!response.ok) throw new AdvancedTwitchError(response.status === 401 ? 'unauthorized' :
        response.status === 403 ? 'forbidden' : response.status === 429 ? 'rate-limited' : 'unavailable');
      const payload: unknown = await response.json();
      if (!payload || typeof payload !== 'object' || Array.isArray(payload))
        throw new AdvancedTwitchError('unavailable');
      return payload as Record<string, unknown>;
    } catch (error) {
      if (error instanceof AdvancedTwitchError) throw error;
      throw new AdvancedTwitchError('unavailable');
    }
  }
  async preflight() {
    const c = { ...this.credentials() }, started = this.now();
    if (!c.clientId || !c.accessToken || !id.test(c.broadcasterId))
      throw new AdvancedTwitchError('unauthorized');
    const claim = await this.get(c, 'https://id.twitch.tv/oauth2/validate');
    if (claim.client_id !== c.clientId || claim.user_id !== c.broadcasterId ||
        !Array.isArray(claim.scopes) || !claim.scopes.every(x => typeof x === 'string') ||
        !claim.scopes.includes('channel:manage:predictions') ||
        typeof claim.expires_in !== 'number' || !Number.isFinite(claim.expires_in) ||
        claim.expires_in <= 0) throw new AdvancedTwitchError('forbidden');
    const validUntil = Math.min(started + 45_000, started + claim.expires_in * 1000);
    this.assertCurrent(c, validUntil);
    const users = await this.get(c, 'https://api.twitch.tv/helix/users?id=' + encodeURIComponent(c.broadcasterId));
    this.assertCurrent(c, validUntil);
    const account = value(Array.isArray(users.data) && users.data.length === 1 ? users.data[0] : null);
    if (account.id !== c.broadcasterId ||
        !['affiliate', 'partner'].includes(String(account.broadcaster_type)))
      throw new AdvancedTwitchError('precondition');
    const predictions = await this.get(c, 'https://api.twitch.tv/helix/predictions?broadcaster_id=' +
      encodeURIComponent(c.broadcasterId) + '&first=1');
    this.assertCurrent(c, validUntil);
    if (!Array.isArray(predictions.data) || predictions.data.length > 1 ||
        predictions.data.some(x => {
          const p = value(x);
          return p.broadcaster_id !== c.broadcasterId ||
            !['RESOLVED', 'CANCELED'].includes(String(p.status));
        })) throw new AdvancedTwitchError('precondition');
    return { broadcasterId: c.broadcasterId, fingerprint: this.fingerprint(c), validUntil };
  }
  /** Never called except behind a one-use user consent on the single FIXE host. */
  async createConfirmed(draft: PredictionCreateDraft, expectedBroadcaster: string,
      expectedFingerprint: string, beforeSend: () => Promise<void>) {
    const session = await this.preflight();
    if (session.broadcasterId !== expectedBroadcaster ||
        session.fingerprint !== expectedFingerprint) throw new AdvancedTwitchError('precondition');
    const c = { ...this.credentials() };
    // Check the pairing/host OBS epoch after ALL provider preflight awaits.
    await beforeSend();
    this.assertCurrent(c, session.validUntil);
    let response: Response;
    // A POST may have reached Twitch as soon as fetch is invoked. Even HTTP
    // errors, lost receipts, JSON errors and token rotation are UNCERTAIN.
    try {
      response = await this.fetchApi('https://api.twitch.tv/helix/predictions', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
        headers: {
          Authorization: 'Bearer ' + c.accessToken, 'Client-Id': c.clientId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          broadcaster_id: c.broadcasterId, title: draft.title,
          outcomes: draft.outcomes.map(title => ({ title })),
          prediction_window: draft.predictionWindow,
        }),
      });
      if (!response.ok) throw new Error('Unconfirmed Twitch response');
      const payload: unknown = await response.json();
      const row = value(Array.isArray(value(payload).data) && (value(payload).data as unknown[]).length === 1
        ? (value(payload).data as unknown[])[0] : null);
      this.assertCurrent(c, session.validUntil);
      if (typeof row.id !== 'string' || !/^[A-Za-z0-9-]{1,128}$/.test(row.id) ||
          row.broadcaster_id !== c.broadcasterId || row.title !== draft.title ||
          row.status !== 'ACTIVE') throw new Error('Unconfirmed Twitch receipt');
      return { predictionId: row.id, status: 'confirmed' as const };
    } catch { throw new AdvancedTwitchError('uncertain'); }
  }
}
