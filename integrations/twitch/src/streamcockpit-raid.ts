import { createHash } from 'node:crypto';
import { AdvancedTwitchError, type AdvancedCredentials } from './streamcockpit-advanced.js';

export type RaidTarget = { id: string; login: string; broadcasterId: string; oauthBinding: string };
type Session = { credentials: AdvancedCredentials; broadcasterId: string; expiresAt: number };
const numericId = /^[0-9]{1,30}$/;
const twitchLogin = /^[a-z0-9_]{4,25}$/;
const scope = 'channel:manage:raids';
const binding = (c: AdvancedCredentials) => createHash('sha256')
  .update(JSON.stringify([c.clientId, c.broadcasterId, c.accessToken])).digest('hex');
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};

export function normalizeRaidTarget(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).join(',') !== 'login') throw new AdvancedTwitchError('invalid');
  const raw = (value as Record<string, unknown>).login;
  if (typeof raw !== 'string' || raw !== raw.trim() ||
      !twitchLogin.test(raw.toLowerCase())) throw new AdvancedTwitchError('invalid');
  return raw.toLowerCase();
}

/** F08: Twitch raids must be explicitly previewed then confirmed on the paired FIXE host.
 * A 200 from /helix/raids merely QUEUES a raid; Twitch may automatically transfer
 * viewers after 90 seconds. Never claim the actual raid was observed.
 */
export class RaidTwitch {
  constructor(private readonly credentials: () => AdvancedCredentials,
    private readonly fetchApi: typeof fetch, private readonly now = Date.now) {}

  private current(session: Session) {
    const c = this.credentials();
    if (this.now() >= session.expiresAt ||
        c.clientId !== session.credentials.clientId ||
        c.accessToken !== session.credentials.accessToken ||
        c.broadcasterId !== session.broadcasterId)
      throw new AdvancedTwitchError('unauthorized');
  }

  private async read(c: AdvancedCredentials, path: string): Promise<Record<string, unknown>> {
    try {
      const response = await this.fetchApi(path, {
        method: 'GET', redirect: 'error', signal: AbortSignal.timeout(8000),
        headers: { Authorization: 'Bearer ' + c.accessToken, 'Client-Id': c.clientId },
      });
      if (!response.ok) throw new AdvancedTwitchError(response.status === 401 ? 'unauthorized' :
        response.status === 403 ? 'forbidden' : response.status === 429 ? 'rate-limited' : 'unavailable');
      const data: unknown = await response.json();
      if (!data || typeof data !== 'object' || Array.isArray(data))
        throw new AdvancedTwitchError('unavailable');
      return object(data);
    } catch (cause) {
      if (cause instanceof AdvancedTwitchError) throw cause;
      throw new AdvancedTwitchError('unavailable');
    }
  }

  private async session(): Promise<Session> {
    const c = { ...this.credentials() };
    if (!c.clientId || !c.accessToken || !numericId.test(c.broadcasterId))
      throw new AdvancedTwitchError('unauthorized');
    const start = this.now();
    const claim = await this.read(c, 'https://id.twitch.tv/oauth2/validate');
    if (claim.client_id !== c.clientId || claim.user_id !== c.broadcasterId ||
        !Array.isArray(claim.scopes) || !claim.scopes.every(s => typeof s === 'string') ||
        !claim.scopes.includes(scope) || typeof claim.expires_in !== 'number' ||
        !Number.isFinite(claim.expires_in) || claim.expires_in <= 0)
      throw new AdvancedTwitchError('forbidden');
    const session = { credentials: c, broadcasterId: c.broadcasterId,
      expiresAt: Math.min(start + 45_000, start + claim.expires_in * 1000) };
    this.current(session);
    return session;
  }

  private async resolve(session: Session, login: string): Promise<RaidTarget> {
    const data = await this.read(session.credentials,
      'https://api.twitch.tv/helix/users?login=' + encodeURIComponent(login));
    const rows = Array.isArray(data.data) ? data.data : [];
    if (rows.length !== 1) throw new AdvancedTwitchError('precondition');
    const row = object(rows[0]);
    if (row.login !== login || typeof row.id !== 'string' || !numericId.test(row.id) ||
        row.id === session.broadcasterId) throw new AdvancedTwitchError('precondition');
    this.current(session);
    return { id: row.id, login, broadcasterId: session.broadcasterId,
      oauthBinding: binding(session.credentials) };
  }

  async preview(value: unknown): Promise<RaidTarget> {
    const login = normalizeRaidTarget(value);
    const session = await this.session();
    return this.resolve(session, login);
  }

  /** The caller's barrier rechecks paired identity and FIXE OBS epoch before the
   * sole provider POST. Any error after dispatch is UNCERTAIN and never retried.
   */
  async sendConfirmed(target: RaidTarget, confirmed: boolean,
      beforeSend: () => Promise<void>): Promise<{ status: 'queued'; targetLogin: string }> {
    if (confirmed !== true || !target || !twitchLogin.test(target.login) ||
        !numericId.test(target.id)) throw new AdvancedTwitchError('precondition');
    const session = await this.session();
    if (session.broadcasterId !== target.broadcasterId)
      throw new AdvancedTwitchError('precondition');
    if (target.oauthBinding !== binding(session.credentials))
      throw new AdvancedTwitchError('unauthorized');
    const currentTarget = await this.resolve(session, target.login);
    if (currentTarget.id !== target.id) throw new AdvancedTwitchError('precondition');
    this.current(session);
    await beforeSend();
    this.current(session);
    let response: Response;
    try {
      const query = new URLSearchParams({
        from_broadcaster_id: session.broadcasterId, to_broadcaster_id: target.id,
      });
      response = await this.fetchApi('https://api.twitch.tv/helix/raids?' + query, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
        headers: { Authorization: 'Bearer ' + session.credentials.accessToken,
          'Client-Id': session.credentials.clientId },
      });
    } catch { throw new AdvancedTwitchError('uncertain'); }
    if (response.status !== 200) throw new AdvancedTwitchError('uncertain');
    try {
      const body: unknown = await response.json();
      const data = object(body).data;
      const row = Array.isArray(data) && data.length === 1 ? object(data[0]) : {};
      if (typeof row.created_at !== 'string' ||
          !/^\d{4}-\d{2}-\d{2}T/.test(row.created_at) ||
          !Number.isFinite(Date.parse(row.created_at))) throw new Error('BAD_RAID_RECEIPT');
      this.current(session);
    } catch { throw new AdvancedTwitchError('uncertain'); }
    return { status: 'queued', targetLogin: target.login };
  }
}
