import { AdvancedTwitchError, type AdvancedCredentials } from './streamcockpit-advanced.js';

const numericId = /^[0-9]{1,30}$/;
const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
const scopes = ['channel:read:predictions', 'channel:manage:predictions'];

export type PredictionSnapshot =
  | { status: 'none'; checkedAt: number }
  | { status: 'active' | 'locked'; checkedAt: number; title: string;
      outcomes: string[]; locksAt: string };

/** F08 read-only Twitch prediction observation; never publishes, locks or resolves a prediction.
 * The authenticated FIXE host owns credentials and does not cache this response.
 */
export class PredictionTwitch {
  constructor(private readonly credentials: () => AdvancedCredentials,
    private readonly fetchApi: typeof fetch, private readonly now = Date.now) {}

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
    try {
      const payload: unknown = await response.json();
      if (!payload || typeof payload !== 'object' || Array.isArray(payload))
        throw new Error('Invalid provider response');
      return payload as Record<string, unknown>;
    } catch { throw new AdvancedTwitchError('unavailable'); }
  }

  async observe(): Promise<PredictionSnapshot> {
    const c = { ...this.credentials() }, started = this.now();
    if (!c.clientId || !c.accessToken || !numericId.test(c.broadcasterId))
      throw new AdvancedTwitchError('unauthorized');
    const claim = await this.read(c, 'https://id.twitch.tv/oauth2/validate');
    if (claim.client_id !== c.clientId || claim.user_id !== c.broadcasterId ||
        !Array.isArray(claim.scopes) || !claim.scopes.every(s => typeof s === 'string') ||
        !claim.scopes.some(s => scopes.includes(s)) ||
        typeof claim.expires_in !== 'number' || !Number.isFinite(claim.expires_in) ||
        claim.expires_in <= 0) throw new AdvancedTwitchError('forbidden');
    const validUntil = Math.min(started + 30_000, started + claim.expires_in * 1000);
    const payload = await this.read(c, 'https://api.twitch.tv/helix/predictions?broadcaster_id=' +
      encodeURIComponent(c.broadcasterId) + '&first=1');
    // Validate the owner and token AGAIN after the provider await, including expiry.
    const current = this.credentials();
    if (this.now() >= validUntil || current.clientId !== c.clientId ||
        current.accessToken !== c.accessToken || current.broadcasterId !== c.broadcasterId)
      throw new AdvancedTwitchError('unauthorized');
    if (!Array.isArray(payload.data) || payload.data.length > 1)
      throw new AdvancedTwitchError('unavailable');
    if (payload.data.length === 0) return { status: 'none', checkedAt: this.now() };
    const row = asObject(payload.data[0]);
    if (row.broadcaster_id !== c.broadcasterId || typeof row.status !== 'string')
      throw new AdvancedTwitchError('unavailable');
    if (!['ACTIVE', 'LOCKED', 'RESOLVED', 'CANCELED'].includes(row.status))
      throw new AdvancedTwitchError('unavailable');
    if (row.status !== 'ACTIVE' && row.status !== 'LOCKED')
      return { status: 'none', checkedAt: this.now() };
    if (typeof row.title !== 'string' || !row.title.trim() ||
        [...row.title].length > 45 || !Array.isArray(row.outcomes) ||
        row.outcomes.length < 2 || row.outcomes.length > 10)
      throw new AdvancedTwitchError('unavailable');
    const outcomes = row.outcomes.map(v => asObject(v).title);
    if (outcomes.some(v => typeof v !== 'string' || !v.trim() || [...v].length > 25) ||
        new Set(outcomes).size !== outcomes.length ||
        typeof row.locks_at !== 'string' || !Number.isFinite(Date.parse(row.locks_at)))
      throw new AdvancedTwitchError('unavailable');
    return {
      status: row.status === 'ACTIVE' ? 'active' : 'locked', checkedAt: this.now(),
      title: row.title, outcomes: outcomes as string[], locksAt: row.locks_at,
    };
  }
}
