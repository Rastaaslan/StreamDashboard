import { AdvancedTwitchError, type AdvancedCredentials } from './streamcockpit-advanced.js';

type OAuthSession = { credentials: AdvancedCredentials; expiry: number; broadcasterId: string };
export type ShoutoutTarget = { id: string; login: string; broadcasterId: string };
const numericId = /^[0-9]{1,30}$/;
const twitchLogin = /^[a-z0-9_]{4,25}$/;
const scope = 'moderator:manage:shoutouts';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function normalizeShoutoutTarget(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).join(',') !== 'login') throw new AdvancedTwitchError('invalid');
  const raw = (value as Record<string, unknown>).login;
  if (typeof raw !== 'string' || raw !== raw.trim() || !twitchLogin.test(raw.toLowerCase()))
    throw new AdvancedTwitchError('invalid');
  return raw.toLowerCase();
}

/** F08: Twitch-only public shoutout provider. No stored credentials, retry or polling.
 * A successful 204 means Twitch accepted the request, NOT that it was seen by viewers.
 * The host must independently prove a live and ask the user for separate confirmation.
 */
export class ShoutoutTwitch {
  constructor(private readonly credentials: () => AdvancedCredentials,
    private readonly fetchApi: typeof fetch, private readonly now = Date.now) {}

  private current(s: OAuthSession) {
    const c = this.credentials();
    if (this.now() >= s.expiry || c.clientId !== s.credentials.clientId ||
        c.accessToken !== s.credentials.accessToken ||
        c.broadcasterId !== s.broadcasterId) throw new AdvancedTwitchError('unauthorized');
  }

  private async read(s: AdvancedCredentials, uri: string): Promise<Record<string, unknown>> {
    try {
      const response = await this.fetchApi(uri, {
        method: 'GET', redirect: 'error', signal: AbortSignal.timeout(8000),
        headers: { Authorization: 'Bearer ' + s.accessToken, 'Client-Id': s.clientId },
      });
      if (!response.ok) throw new AdvancedTwitchError(
        response.status === 401 ? 'unauthorized' : response.status === 403 ? 'forbidden' :
        response.status === 429 ? 'rate-limited' : 'unavailable'
      );
      const body: unknown = await response.json();
      if (!body || typeof body !== 'object' || Array.isArray(body))
        throw new AdvancedTwitchError('unavailable');
      return record(body);
    } catch (error) {
      if (error instanceof AdvancedTwitchError) throw error;
      throw new AdvancedTwitchError('unavailable');
    }
  }

  private async session(): Promise<OAuthSession> {
    const credentials = { ...this.credentials() };
    if (!credentials.clientId || !credentials.accessToken ||
        !numericId.test(credentials.broadcasterId)) throw new AdvancedTwitchError('unauthorized');
    const started = this.now();
    const response = await this.read(credentials, 'https://id.twitch.tv/oauth2/validate');
    if (response.client_id !== credentials.clientId ||
        response.user_id !== credentials.broadcasterId ||
        !Array.isArray(response.scopes) ||
        !response.scopes.every(x => typeof x === 'string') ||
        !response.scopes.includes(scope) ||
        !Number.isFinite(response.expires_in) ||
        Number(response.expires_in) <= 0) throw new AdvancedTwitchError('forbidden');
    const result = { credentials, broadcasterId: credentials.broadcasterId,
      expiry: Math.min(started + 45_000, started + Number(response.expires_in) * 1000) };
    this.current(result);
    return result;
  }

  private async resolve(s: OAuthSession, login: string): Promise<ShoutoutTarget> {
    const data = await this.read(s.credentials, 'https://api.twitch.tv/helix/users?login=' +
      encodeURIComponent(login));
    const matches = Array.isArray(data.data) ? data.data : [];
    if (matches.length !== 1) throw new AdvancedTwitchError('precondition');
    const user = record(matches[0]);
    if (user.login !== login || typeof user.id !== 'string' || !numericId.test(user.id) ||
        user.id === s.broadcasterId) throw new AdvancedTwitchError('precondition');
    this.current(s);
    return { login, id: user.id, broadcasterId: s.broadcasterId };
  }

  async preview(value: unknown): Promise<ShoutoutTarget> {
    const login = normalizeShoutoutTarget(value);
    const s = await this.session();
    return this.resolve(s, login);
  }

  /** The beforeSend barrier rechecks paired identity + host LIVE immediately before
   * the ONLY provider POST. Callers mark the response UNCERTAIN after this barrier.
   */
  async sendConfirmed(target: ShoutoutTarget, confirmed: boolean,
      beforeSend: () => Promise<void>): Promise<{status:'accepted'; targetLogin:string}> {
    if (confirmed !== true || !target || !twitchLogin.test(target.login) ||
        !numericId.test(target.id)) throw new AdvancedTwitchError('precondition');
    const s = await this.session();
    if (s.broadcasterId !== target.broadcasterId) throw new AdvancedTwitchError('precondition');
    const fresh = await this.resolve(s, target.login);
    if (fresh.id !== target.id) throw new AdvancedTwitchError('precondition');
    this.current(s);
    await beforeSend();
    this.current(s);
    let response: Response;
    try {
      const query = new URLSearchParams({
        from_broadcaster_id: s.broadcasterId,
        to_broadcaster_id: target.id,
        moderator_id: s.broadcasterId,
      });
      response = await this.fetchApi('https://api.twitch.tv/helix/chat/shoutouts?' + query, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
        headers: { Authorization: 'Bearer ' + s.credentials.accessToken,
          'Client-Id': s.credentials.clientId },
      });
    } catch {
      throw new AdvancedTwitchError('uncertain');
    }
    if (response.status !== 204) throw new AdvancedTwitchError('uncertain');
    try { this.current(s); } catch { throw new AdvancedTwitchError('uncertain'); }
    return { status: 'accepted', targetLogin: target.login };
  }
}
