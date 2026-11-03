import { createHash } from 'node:crypto';
import { AdvancedTwitchError, type AdvancedCredentials } from './streamcockpit-advanced.js';

const broadcaster = /^[0-9]{1,30}$/;
const providerId = /^[A-Za-z0-9-]{1,128}$/;
const object = (input: unknown): Record<string, unknown> =>
  input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown> : {};

/** F08: ONLY LOCK an exact, durable prediction ID already owned by FIXE.
 * No start/stop OBS and no Twitch polling, retry, resolve or cancellation. */
export class PredictionLockTwitch {
  constructor(private readonly credentials: () => AdvancedCredentials,
    private readonly fetchApi: typeof fetch, private readonly now = Date.now) {}

  private fingerprint(c: AdvancedCredentials) {
    return createHash('sha256').update(c.clientId + ':' + c.broadcasterId + ':' + c.accessToken).digest('hex');
  }
  private same(c: AdvancedCredentials, validUntil: number) {
    const current = this.credentials();
    if (this.now() >= validUntil || current.clientId !== c.clientId ||
        current.accessToken !== c.accessToken || current.broadcasterId !== c.broadcasterId)
      throw new AdvancedTwitchError('unauthorized');
  }
  private async read(c: AdvancedCredentials, url: string) {
    let response: Response;
    try {
      response = await this.fetchApi(url, {
        method: 'GET', redirect: 'error', signal: AbortSignal.timeout(8000),
        headers: { Authorization: 'Bearer ' + c.accessToken, 'Client-Id': c.clientId },
      });
    } catch { throw new AdvancedTwitchError('unavailable'); }
    if (!response.ok) throw new AdvancedTwitchError(response.status === 401 ? 'unauthorized' :
      response.status === 403 ? 'forbidden' : response.status === 429 ? 'rate-limited' : 'unavailable');
    try { return object(await response.json()); }
    catch { throw new AdvancedTwitchError('unavailable'); }
  }

  async preflight(predictionId: string, owner: string) {
    if (!providerId.test(predictionId) || !broadcaster.test(owner))
      throw new AdvancedTwitchError('precondition');
    const c = { ...this.credentials() }, start = this.now();
    if (!c.clientId || !c.accessToken || c.broadcasterId !== owner)
      throw new AdvancedTwitchError('unauthorized');
    const claim = await this.read(c, 'https://id.twitch.tv/oauth2/validate');
    if (claim.client_id !== c.clientId || claim.user_id !== owner ||
        !Array.isArray(claim.scopes) || !claim.scopes.every(x => typeof x === 'string') ||
        !claim.scopes.includes('channel:manage:predictions') ||
        typeof claim.expires_in !== 'number' || !Number.isFinite(claim.expires_in) ||
        claim.expires_in <= 0) throw new AdvancedTwitchError('forbidden');
    const validUntil = Math.min(start + 30_000, start + claim.expires_in * 1000);
    this.same(c, validUntil);
    const payload = await this.read(c, 'https://api.twitch.tv/helix/predictions?broadcaster_id=' +
      encodeURIComponent(owner) + '&id=' + encodeURIComponent(predictionId));
    this.same(c, validUntil);
    if (!Array.isArray(payload.data) || payload.data.length !== 1)
      throw new AdvancedTwitchError('precondition');
    const record = object(payload.data[0]);
    if (record.id !== predictionId || record.broadcaster_id !== owner ||
        record.status !== 'ACTIVE') throw new AdvancedTwitchError('precondition');
    return { owner, predictionId, fingerprint: this.fingerprint(c), validUntil };
  }

  /** The beforePatch callback must commit FIXE's durable lock intent before
   * the first possible provider PATCH. Anything after dispatch is UNCERTAIN. */
  async lockConfirmed(predictionId: string, owner: string, fingerprint: string,
    beforePatch: () => Promise<void>) {
    const check = await this.preflight(predictionId, owner);
    if (check.fingerprint !== fingerprint) throw new AdvancedTwitchError('precondition');
    const c = { ...this.credentials() };
    await beforePatch();
    this.same(c, check.validUntil); // Reject an expired or changed token before PATCH.
    try {
      const response = await this.fetchApi('https://api.twitch.tv/helix/predictions', {
        method: 'PATCH', redirect: 'error', signal: AbortSignal.timeout(8000),
        headers: { Authorization: 'Bearer ' + c.accessToken, 'Client-Id': c.clientId,
          'Content-Type': 'application/json' },
        body: JSON.stringify({ broadcaster_id: owner, id: predictionId, status: 'LOCKED' }),
      });
      if (!response.ok) throw Error('Unconfirmed lock');
      const result: unknown = await response.json();
      const rows = object(result).data;
      const row = object(Array.isArray(rows) && rows.length === 1 ? rows[0] : null);
      this.same(c, check.validUntil);
      const nowCredentials = this.credentials();
      if (nowCredentials.clientId !== c.clientId || nowCredentials.accessToken !== c.accessToken ||
          nowCredentials.broadcasterId !== c.broadcasterId ||
          row.id !== predictionId || row.broadcaster_id !== owner || row.status !== 'LOCKED')
        throw Error('Unconfirmed lock receipt');
      return { predictionId, status: 'locked' as const };
    } catch { throw new AdvancedTwitchError('uncertain'); }
  }
}
