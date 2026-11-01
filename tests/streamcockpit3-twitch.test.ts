import { describe, expect, it, vi } from 'vitest';
import { AdvancedTwitch, advancedScopes, normalizePoll } from '../integrations/twitch/src/streamcockpit-advanced.js';
import { StreamcockpitTwitchService } from '../apps/server/src/streamcockpit-twitch-service.js';
// @ts-ignore Browser ES module deliberately has no dependency on server contracts.
import { twitchCapabilitiesMarkup } from '../apps/mobile/control/streamcockpit-twitch-capabilities.js';
const draft = { title: 'Quel jeu ?', choices: ['A', 'B'], duration: 60 };
const actor = { id: 'paired-owner', canRead: true, canInteract: true };
function setup(options: { scopes?: string[]; userId?: string; clientId?: string; expires?: number; failPath?: string; status?: number; malformed?: boolean; active?: boolean; eligible?: boolean; network?: boolean } = {}) {
  let time = 1000;
  const credentials = { clientId: 'client', accessToken: 'fake-token', broadcasterId: '123' };
  const fetchApi = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url);
    if (options.failPath && path.includes(options.failPath)) {
      if (options.network) throw new Error('fake-token MUST NOT LEAK');
      return new Response(options.malformed ? '{}' : 'not-json', { status: options.status ?? 200, headers: { 'retry-after': '10' } });
    }
    let result: unknown;
    if (path.endsWith('/validate')) result = { client_id: options.clientId ?? 'client', user_id: options.userId ?? '123', expires_in: options.expires ?? 3600, scopes: options.scopes ?? [...advancedScopes.shield, ...advancedScopes.automod, ...advancedScopes.poll] };
    else if (path.includes('shield_mode')) result = { data: [{ is_active: false }] };
    else if (path.includes('automod/settings')) result = { data: [{ broadcaster_id: '123', moderator_id: options.userId ?? '123', overall_level: 2 }] };
    else if (path.includes('/users')) result = { data: [{ id: '123', broadcaster_type: options.eligible === false ? '' : 'affiliate' }] };
    else if (init?.method === 'POST') result = { data: [{ ...JSON.parse(String(init.body)), id: 'poll-1', status: 'ACTIVE' }] };
    else result = { data: options.active ? [{ status: 'ACTIVE' }] : [] };
    return Response.json(result);
  });
  const api = new AdvancedTwitch(() => credentials, fetchApi as typeof fetch, () => time);
  const service = new StreamcockpitTwitchService(api, () => time);
  return { api, service, fetchApi, credentials, advance: () => { time += 60001; }, writes: () => fetchApi.mock.calls.filter(c => c[1]?.method === 'POST') };
}
describe('Lot B isolated Twitch contracts', () => {
  it('verifies scopes and role with GETs using token moderator identity', async () => {
    const s = setup({ userId: '456' });
    const snapshot = await s.service.capabilities(actor);
    expect(snapshot.shield.status).toBe('verified');
    expect(snapshot.automod.status).toBe('verified');
    expect(snapshot.shield.mutationAvailable).toBe(false);
    expect(s.fetchApi.mock.calls[1][0]).toContain('moderator_id=456');
    expect(s.writes()).toHaveLength(0);
    expect(JSON.stringify(snapshot)).not.toContain('fake-token');
  });
  it('does not probe missing scopes and accepts manage scope for reads', async () => {
    const s = setup({ scopes: [] });
    expect((await s.api.capabilities()).shield.status).toBe('missing-scope');
    expect(s.fetchApi).toHaveBeenCalledTimes(1);
    expect((await setup({ scopes: ['moderator:manage:shield_mode'] }).api.capabilities()).shield.status).toBe('verified');
  });
  it.each([{ clientId: 'wrong' }, { userId: '' }, { expires: 0 }])('rejects invalid validated identity %j', async options => {
    await expect(setup(options).api.capabilities()).rejects.toMatchObject({ code: 'unauthorized' });
  });
  it.each([[401, 'unauthorized'], [403, 'forbidden'], [429, 'rate-limited'], [503, 'unavailable']] as const)('maps validation HTTP %s', async (status, code) => {
    await expect(setup({ failPath: '/validate', status }).api.capabilities()).rejects.toMatchObject({ code, retryAfter: '10' });
  });
  it.each([[403, 'forbidden'], [429, 'rate-limited'], [503, 'unavailable']] as const)('reports probe HTTP %s without false authorization', async (status, code) => {
    const v = await setup({ failPath: 'shield_mode', status }).api.capabilities();
    expect(v.shield.status).toBe(code); expect(v.automod.status).toBe('verified');
  });
  it('invalidates earlier observations after a 401', async () => {
    await expect(setup({ failPath: 'automod/settings', status: 401 }).api.capabilities()).rejects.toMatchObject({ code: 'unauthorized' });
  });
  it('malformed probe cannot verify permission', async () => {
    expect((await setup({ failPath: 'shield_mode', malformed: true }).api.capabilities()).shield.status).toBe('unavailable');
  });
  it.each([{}, { ...draft, duration: 14 }, { ...draft, duration: 1801 }, { ...draft, duration: 15.5 }, { ...draft, choices: ['A'] }, { ...draft, choices: ['A', 'A'] }, { ...draft, title: 'x'.repeat(61) }])('rejects invalid poll %j', input => {
    expect(() => normalizePoll(input)).toThrow('invalid');
  });
  it.each([{ scopes: [] }, { userId: '456' }, { active: true }, { eligible: false }])('blocks preconditions before any mutation %j', async options => {
    const s = setup(options);
    await expect(s.service.previewPoll(actor, draft)).rejects.toThrow();
    expect(s.writes()).toHaveLength(0);
  });
  it('requires authorization and explicit confirmation; binds actor and draft; consumes concurrently', async () => {
    const s = setup();
    expect(() => s.service.capabilities({ ...actor, canRead: false })).toThrow('forbidden');
    await expect(s.service.previewPoll({ ...actor, canInteract: false }, draft)).rejects.toThrow('forbidden');
    const p = await s.service.previewPoll(actor, draft);
    p.draft.title = 'tampered';
    await expect(s.service.confirmPoll(actor, p.confirmationId, false)).rejects.toThrow('precondition');
    await expect(s.service.confirmPoll({ ...actor, id: 'other' }, p.confirmationId, true)).rejects.toThrow('precondition');
    expect(s.writes()).toHaveLength(0);
    const results = await Promise.allSettled([s.service.confirmPoll(actor, p.confirmationId, true), s.service.confirmPoll(actor, p.confirmationId, true)]);
    expect(results.map(r => r.status)).toEqual(['fulfilled', 'rejected']);
    expect(s.writes()).toHaveLength(1);
    expect(JSON.parse(String(s.writes()[0][1]?.body)).title).toBe(draft.title);
    expect(s.fetchApi.mock.calls.filter(c => String(c[0]).endsWith('/validate'))).toHaveLength(2);
  });
  it('rejects expired confirmation and changed broadcaster', async () => {
    const s = setup(); const p = await s.service.previewPoll(actor, draft); s.advance();
    await expect(s.service.confirmPoll(actor, p.confirmationId, true)).rejects.toThrow('precondition');
    const other = setup(); const p2 = await other.service.previewPoll(actor, draft); other.credentials.broadcasterId = '999';
    await expect(other.service.confirmPoll(actor, p2.confirmationId, true)).rejects.toThrow();
    expect(other.writes()).toHaveLength(0);
  });
  it.each([[401, 'unauthorized'], [403, 'forbidden'], [429, 'rate-limited'], [503, 'uncertain'], [200, 'uncertain']] as const)('never retries POST HTTP %s', async (status, code) => {
    const s = setup(); const p = await s.service.previewPoll(actor, draft);
    const normal = s.fetchApi.getMockImplementation()!;
    s.fetchApi.mockImplementation(async (url, init) => init?.method === 'POST' ? new Response('{}', { status }) : normal(url, init));
    await expect(s.service.confirmPoll(actor, p.confirmationId, true)).rejects.toMatchObject({ code });
    await expect(s.service.confirmPoll(actor, p.confirmationId, true)).rejects.toThrow('precondition');
    expect(s.writes()).toHaveLength(1);
  });
  it('redacts network exceptions and treats write disconnect as uncertain', async () => {
    const s = setup(); const p = await s.service.previewPoll(actor, draft);
    const normal = s.fetchApi.getMockImplementation()!;
    s.fetchApi.mockImplementation(async (url, init) => { if (init?.method === 'POST') throw new Error('fake-token'); return normal(url, init); });
    await expect(s.service.confirmPoll(actor, p.confirmationId, true)).rejects.toThrow('uncertain');
    await expect(setup({ failPath: '/validate', network: true }).api.capabilities()).rejects.toThrow('unavailable');
  });
  it('revalidates revoked scopes at confirmation without POST', async () => {
    const s = setup(); const p = await s.service.previewPoll(actor, draft);
    const normal = s.fetchApi.getMockImplementation()!;
    s.fetchApi.mockImplementation(async (url, init) => String(url).endsWith('/validate') ? Response.json({ client_id: 'client', user_id: '123', expires_in: 3600, scopes: [] }) : normal(url, init));
    await expect(s.service.confirmPoll(actor, p.confirmationId, true)).rejects.toThrow('forbidden');
    expect(s.writes()).toHaveLength(0);
  });
  it('reports uncertainty when account changes while POST is in flight', async () => {
    const s = setup(); const p = await s.service.previewPoll(actor, draft);
    const normal = s.fetchApi.getMockImplementation()!;
    s.fetchApi.mockImplementation(async (url, init) => { const result = await normal(url, init); if (init?.method === 'POST') s.credentials.accessToken = 'changed'; return result; });
    await expect(s.service.confirmPoll(actor, p.confirmationId, true)).rejects.toThrow('uncertain');
  });
  it('renders read-only capabilities, escapes data and drops expired observations', async () => {
    const s = setup(); const snapshot = await s.api.capabilities();
    snapshot.shield.requiredAny = ['<img onerror=alert(1)>'];
    const html = twitchCapabilitiesMarkup(snapshot, 1000);
    expect(html).toContain('Lecture autorisée'); expect(html).toContain('&lt;img');
    expect(html).not.toMatch(/<button|<input|<img|onclick=/);
    expect(twitchCapabilitiesMarkup(snapshot, 61000)).toContain('périmées');
    expect(twitchCapabilitiesMarkup(null)).toContain('à revérifier');
  });
});
