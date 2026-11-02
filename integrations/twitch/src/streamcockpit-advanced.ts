/** Lot B: no global fetch, token persistence, retry or automatic action. */
export type FailureCode = 'unauthorized' | 'forbidden' | 'rate-limited' | 'unavailable' | 'invalid' | 'precondition' | 'uncertain';
export class AdvancedTwitchError extends Error {
  constructor(readonly code: FailureCode, readonly retryAfter: string | null = null) {
    super(code); this.name = 'AdvancedTwitchError';
  }
}
export interface AdvancedCredentials { clientId: string; accessToken: string; broadcasterId: string }
export interface PollDraft { title: string; choices: string[]; duration: number }
export const advancedScopes = {
  shield: ['moderator:read:shield_mode', 'moderator:manage:shield_mode'],
  automod: ['moderator:read:automod_settings', 'moderator:manage:automod_settings'],
  poll: ['channel:manage:polls'],
} as const;
export interface Capability {
  status: 'verified' | 'missing-scope' | FailureCode;
  requiredAny: readonly string[];
  manageScopeGranted: boolean;
  mutationAvailable: false;
}
export interface Capabilities {
  broadcasterId: string; checkedAt: number; validUntil: number;
  shield: Capability; automod: Capability;
}
const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
export function normalizePoll(value: unknown): PollDraft {
  const v = object(value);
  if (typeof v.title !== 'string' || !Array.isArray(v.choices) || !v.choices.every(c => typeof c === 'string')) throw new AdvancedTwitchError('invalid');
  const title = v.title.trim(), choices = (v.choices as string[]).map(c => c.trim());
  if (!title || [...title].length > 60 || choices.length < 2 || choices.length > 5 || choices.some(c => !c || [...c].length > 25) || new Set(choices).size !== choices.length || !Number.isInteger(v.duration) || Number(v.duration) < 15 || Number(v.duration) > 1800) throw new AdvancedTwitchError('invalid');
  return { title, choices, duration: Number(v.duration) };
}
export class AdvancedTwitch {
  constructor(private readonly credentials: () => AdvancedCredentials, private readonly fetchApi: typeof fetch, private readonly now = Date.now) {}

  private async request(c: AdvancedCredentials, path: string, body?: unknown): Promise<Record<string, unknown>> {
    const writing = body !== undefined;
    try {
      const response = await this.fetchApi(path.startsWith('https://id.twitch.tv/') ? path : `https://api.twitch.tv/helix${path}`, {
        method: writing ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(8000),
        headers: { Authorization: `Bearer ${c.accessToken}`, 'Client-Id': c.clientId, 'Content-Type': 'application/json' },
        ...(writing ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) throw new AdvancedTwitchError(response.status === 401 ? 'unauthorized' : response.status === 403 ? 'forbidden' : response.status === 429 ? 'rate-limited' : response.status >= 500 ? (writing ? 'uncertain' : 'unavailable') : 'precondition', response.headers.get('retry-after'));
      return object(await response.json());
    } catch (error) {
      if (error instanceof AdvancedTwitchError) throw error;
      throw new AdvancedTwitchError(writing ? 'uncertain' : 'unavailable');
    }
  }
  private async session() {
    const c = { ...this.credentials() };
    if (!c.accessToken || !c.clientId || !/^\d+$/.test(c.broadcasterId)) throw new AdvancedTwitchError('unauthorized');
    const started = this.now();
    const v = await this.request(c, 'https://id.twitch.tv/oauth2/validate');
    if (v.client_id !== c.clientId || typeof v.user_id !== 'string' || !/^\d+$/.test(v.user_id) || !Array.isArray(v.scopes) || !v.scopes.every(s => typeof s === 'string') || typeof v.expires_in !== 'number' || !Number.isFinite(v.expires_in) || v.expires_in <= 0) throw new AdvancedTwitchError('unauthorized');
    return { c, userId: v.user_id, scopes: v.scopes as string[], validUntil: Math.min(started + 60_000, started + v.expires_in * 1000) };
  }
  private assertCurrent(s: Awaited<ReturnType<AdvancedTwitch['session']>>) {
    const c = this.credentials();
    if (this.now() >= s.validUntil || c.accessToken !== s.c.accessToken || c.clientId !== s.c.clientId || c.broadcasterId !== s.c.broadcasterId) throw new AdvancedTwitchError('unauthorized');
  }
  async capabilities(): Promise<Capabilities> {
    const s = await this.session();
    const probe = async (key: 'shield' | 'automod'): Promise<Capability> => {
      const requiredAny = advancedScopes[key];
      const base = { requiredAny, manageScopeGranted: s.scopes.includes(requiredAny[1]), mutationAvailable: false as const };
      if (!requiredAny.some(scope => s.scopes.includes(scope))) return { ...base, status: 'missing-scope' };
      try {
        const path = key === 'shield' ? 'shield_mode' : 'automod/settings';
        const v = await this.request(s.c, `/moderation/${path}?broadcaster_id=${s.c.broadcasterId}&moderator_id=${s.userId}`);
        const row = object(Array.isArray(v.data) ? v.data[0] : null);
        if (key === 'shield' ? typeof row.is_active !== 'boolean' : row.broadcaster_id !== s.c.broadcasterId || row.moderator_id !== s.userId || !(row.overall_level === null || Number.isInteger(row.overall_level) && Number(row.overall_level) >= 0 && Number(row.overall_level) <= 4)) throw new AdvancedTwitchError('unavailable');
        return { ...base, status: 'verified' };
      } catch (e) { return { ...base, status: e instanceof AdvancedTwitchError ? e.code : 'unavailable' }; }
    };
    const shield = await probe('shield'), automod = await probe('automod');
    this.assertCurrent(s);
    // A revoked token must invalidate the whole view, including earlier probes.
    if (shield.status === 'unauthorized' || automod.status === 'unauthorized') throw new AdvancedTwitchError('unauthorized');
    return { broadcasterId: s.c.broadcasterId, checkedAt: this.now(), validUntil: s.validUntil, shield, automod };
  }
  async pollPreflight() {
    const s = await this.session();
    if (s.userId !== s.c.broadcasterId) throw new AdvancedTwitchError('forbidden');
    if (!s.scopes.includes(advancedScopes.poll[0])) throw new AdvancedTwitchError('forbidden');
    const users = await this.request(s.c, `/users?id=${s.c.broadcasterId}`);
    const user = object(Array.isArray(users.data) ? users.data[0] : null);
    if (user.id !== s.c.broadcasterId || !['affiliate', 'partner'].includes(String(user.broadcaster_type))) throw new AdvancedTwitchError('precondition');
    const polls = await this.request(s.c, `/polls?broadcaster_id=${s.c.broadcasterId}&first=1`);
    if (!Array.isArray(polls.data) || polls.data.some(p => typeof object(p).status !== 'string' || object(p).status === 'ACTIVE')) throw new AdvancedTwitchError('precondition');
    this.assertCurrent(s);
    return s;
  }
  /** Only call through the server confirmation service. Rechecks permissions immediately. */
  async createConfirmedPoll(value: unknown, expectedBroadcaster: string, confirmed: boolean,
    stillAuthorized?: () => Promise<boolean> | boolean) {
    if (confirmed !== true) throw new AdvancedTwitchError('precondition');
    const draft = normalizePoll(value), s = await this.pollPreflight();
    if (s.c.broadcasterId !== expectedBroadcaster) throw new AdvancedTwitchError('precondition');
    // The paired actor, OBS and Twitch live state may change while the
    // Twitch preflight awaits. Recheck immediately before the sole POST.
    if (stillAuthorized && !await stillAuthorized()) throw new AdvancedTwitchError('forbidden');
    this.assertCurrent(s);
    const v = await this.request(s.c, '/polls', { broadcaster_id: s.c.broadcasterId, ...draft, choices: draft.choices.map(title => ({ title })), channel_points_voting_enabled: false });
    try { this.assertCurrent(s); } catch { throw new AdvancedTwitchError('uncertain'); }
    const poll = object(Array.isArray(v.data) ? v.data[0] : null);
    if (typeof poll.id !== 'string' || !poll.id || poll.broadcaster_id !== expectedBroadcaster || poll.title !== draft.title || poll.status !== 'ACTIVE' || poll.duration !== draft.duration || !Array.isArray(poll.choices) || JSON.stringify(poll.choices.map(c => object(c).title)) !== JSON.stringify(draft.choices)) throw new AdvancedTwitchError('uncertain');
    return { status: 'confirmed' as const, pollId: poll.id, broadcasterId: expectedBroadcaster };
  }
}
