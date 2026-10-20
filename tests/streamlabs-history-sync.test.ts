import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MemorySecretStore } from '../apps/server/src/storage.js';
import { parseStreamlabsWidgetToken, StreamlabsHistory } from '../apps/server/src/streamlabs-history.js';

const TOKEN_A = 'widget_account_a_12345678901234567890';
const TOKEN_B = 'widget_account_b_12345678901234567890';
const INITIAL_TIME = Date.parse('2026-10-20T18:00:00Z');
const SECRET_MARKER = 'PRIVATE_PROVIDER_PAYLOAD_DO_NOT_RETAIN';
const directories: string[] = [];
const services: StreamlabsHistory[] = [];
const pendingCleanups: Array<() => void> = [];

function payload(account = 'A') {
  return {
    data: {
      follows: [{
        _id: `follow-${account}`, id: 'viewer-id', type: 'follow', platform: 'twitch_account',
        name: `Ada-${account}`, created_at: '2026-10-20 15:12:34',
        access_token: SECRET_MARKER, platformcredentials: { secret: SECRET_MARKER },
      }],
      subscriptions: [{
        _id: `gift-${account}`, type: 'subscription', platform: 'twitch_account',
        name: `Recipient-${account}`, gifter: `Gifter-${account}`, sub_type: 'gift', months: 1,
        created_at: '2026-10-20 15:10:00', raw: { credential: SECRET_MARKER },
      }],
      donations: [{
        _id: `donation-${account}`, type: 'donation', platform: 'streamlabs',
        name: `Donor-${account}`, amount: '5.25', currency: 'EUR', message: 'Merci',
        created_at: '2026-10-19 09:00:00', private_profile: SECRET_MARKER,
      }],
    },
    platforms: [{ access_token: SECRET_MARKER }],
    platforms2: { refresh_token: SECRET_MARKER },
    thirdpartyplatforms: { credential: SECRET_MARKER },
    token: TOKEN_A,
  };
}

function json(value: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(value), {
    status, headers: { 'content-type': 'application/json', ...headers },
  });
}

function deferredResponse() {
  let resolve!: (response: Response) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Response>((yes, no) => { resolve = yes; reject = no; });
  pendingCleanups.push(() => reject(new Error('Test cleanup')));
  return { promise, resolve };
}

async function fixture(fetchApi: typeof fetch) {
  const directory = await mkdtemp(path.join(tmpdir(), 'sl-history-sync-'));
  directories.push(directory);
  const secrets = new MemorySecretStore();
  const clock = { now: INITIAL_TIME };
  const history = new StreamlabsHistory({ directory, secrets, fetchApi, now: () => clock.now });
  services.push(history);
  return { history, secrets, clock, directory };
}

afterEach(async () => {
  for (const finish of pendingCleanups.splice(0)) finish();
  await Promise.all(services.splice(0).map(service => service.stop()));
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

describe('Streamlabs cloud history synchronization', () => {
  it('extracts one widget credential and refuses other origins or ambiguous URLs', () => {
    expect(parseStreamlabsWidgetToken(`  ${TOKEN_A}  `)).toBe(TOKEN_A);
    expect(parseStreamlabsWidgetToken(`https://streamlabs.com/alert-box/v3/${TOKEN_A}`)).toBe(TOKEN_A);
    expect(parseStreamlabsWidgetToken(`https://www.streamlabs.com/dashboard/recent-events?token=${TOKEN_A}&mode=night`)).toBe(TOKEN_A);
    for (const value of [
      undefined, {}, '', 'too-short',
      `http://streamlabs.com/alert-box/v3/${TOKEN_A}`,
      `https://streamlabs.com.evil.example/alert-box/v3/${TOKEN_A}`,
      `https://evil.example/?token=${TOKEN_A}`,
      `https://streamlabs.com:444/alert-box/v3/${TOKEN_A}`,
      `https://user:password@streamlabs.com/alert-box/v3/${TOKEN_A}`,
      `https://streamlabs.com/dashboard/recent-events?token=${TOKEN_A}&token=${TOKEN_B}`,
      `https://streamlabs.com/dashboard/recent-events?token=${TOKEN_A}&token=${TOKEN_A}`,
      `https://streamlabs.com/alert-box/v3/${TOKEN_A}?token=${TOKEN_B}`,
      `https://streamlabs.com/widgets/${TOKEN_A}/${TOKEN_B}`,
    ]) expect(() => parseStreamlabsWidgetToken(value), String(value)).toThrow();
  });

  it('imports original dates into a public-only cache while keeping credentials in SecretStore', async () => {
    const fetchApi = vi.fn<typeof fetch>().mockImplementation(async () => json(payload()));
    const { history, secrets, directory } = await fixture(fetchApi);
    const state = await history.configure(`https://streamlabs.com/alert-box/v3/${TOKEN_A}?unused=ignored`);
    expect(await secrets.getStreamlabsWidgetToken()).toBe(TOKEN_A);
    expect(state).toMatchObject({ status: 'SYNCED', configured: true, count: 3, lastError: null });
    expect(fetchApi).toHaveBeenCalledTimes(1);
    const [url, options] = fetchApi.mock.calls[0];
    expect(String(url)).toBe(`https://streamlabs.com/api/v5/slobs/recentevents/${TOKEN_A}`);
    expect(options).toMatchObject({ method: 'GET', redirect: 'error', credentials: 'omit' });
    const items = history.list();
    expect(items.find(item => item.type === 'follow')).toMatchObject({
      displayName: 'Ada-A', occurredAt: '2026-10-20T15:12:34.000Z',
      receivedAt: new Date(INITIAL_TIME).toISOString(), origin: 'cloud',
    });
    expect(items.find(item => item.type === 'subscription')).toMatchObject({
      displayName: 'Gifter-A', recipient: 'Recipient-A', months: 1,
    });
    expect(items.find(item => item.type === 'donation')).toMatchObject({ amount: 5.25, currency: 'EUR' });
    const files = await readdir(directory);
    expect(files).toEqual([`${createHash('sha256').update(TOKEN_A).digest('hex')}.json`]);
    const cacheText = await readFile(path.join(directory, files[0]), 'utf8');
    const cached = JSON.parse(cacheText);
    expect(Object.keys(cached).sort()).toEqual(['items', 'lastSyncAt']);
    expect(cached.items).toEqual(items);
    const exposed = JSON.stringify({ state, items, cache: cached, filenames: files });
    for (const privateValue of [TOKEN_A, SECRET_MARKER, 'platformcredentials', 'platforms2', 'thirdpartyplatforms', 'access_token', 'private_profile', '"raw"']) {
      expect(exposed).not.toContain(privateValue);
    }
  });

  it('coalesces overlapping refreshes and imports the same activity only once', async () => {
    const fetchApi = vi.fn<typeof fetch>().mockImplementation(async () => json(payload()));
    const { history, clock } = await fixture(fetchApi);
    await history.configure(TOKEN_A);
    const original = history.list();
    clock.now += 60_000;
    await Promise.all([history.refresh(), history.refresh(), history.refresh()]);
    expect(fetchApi).toHaveBeenCalledTimes(2);
    expect(history.snapshot()).toMatchObject({ status: 'SYNCED', count: 3 });
    expect(history.list()).toEqual(original);
    expect(new Set(history.list().map(item => item.id)).size).toBe(3);
  });

  it('keeps the last successful history during a network failure and after a restart without leaking the error URL', async () => {
    const fetchApi = vi.fn<typeof fetch>().mockImplementation(async () => json(payload()));
    const { history, secrets, clock, directory } = await fixture(fetchApi);
    await history.configure(TOKEN_A);
    const original = history.list();
    const lastSyncAt = history.snapshot().lastSyncAt;
    const transportError = new Error(`Failed GET https://streamlabs.com/api/v5/slobs/recentevents/${TOKEN_A}?credential=${SECRET_MARKER}`);
    fetchApi.mockRejectedValue(transportError);
    clock.now += 60_000;
    await history.refresh();
    expect(history.snapshot()).toMatchObject({ status: 'ERROR', count: 3, lastSyncAt });
    expect(history.list()).toEqual(original);
    await history.stop();
    const restored = new StreamlabsHistory({ directory, secrets, fetchApi, now: () => clock.now });
    services.push(restored);
    await restored.refresh(true);
    expect(restored.snapshot()).toMatchObject({ status: 'ERROR', configured: true, count: 3, lastSyncAt });
    expect(restored.list()).toEqual(original);
    for (const state of [history.snapshot(), restored.snapshot()]) {
      expect(state.lastError).toBeTruthy();
      expect(JSON.stringify(state)).not.toContain(TOKEN_A);
      expect(JSON.stringify(state)).not.toContain(SECRET_MARKER);
      expect(JSON.stringify(state)).not.toContain('https://');
    }
  });

  it('ignores an old account response even if the transport completes after an account switch', async () => {
    const old = deferredResponse();
    const fetchApi = vi.fn<typeof fetch>()
      .mockImplementationOnce(async () => old.promise)
      .mockImplementation(async () => json(payload('B')));
    const { history, secrets, directory } = await fixture(fetchApi);
    const first = history.configure(TOKEN_A);
    await vi.waitFor(() => expect(fetchApi).toHaveBeenCalledTimes(1));
    const oldSignal = fetchApi.mock.calls[0][1]?.signal;
    await history.configure(TOKEN_B);
    expect(oldSignal?.aborted).toBe(true);
    const current = history.list();
    old.resolve(json(payload('A')));
    await first;
    expect(await secrets.getStreamlabsWidgetToken()).toBe(TOKEN_B);
    expect(history.list()).toEqual(current);
    expect(history.list().every(item => item.displayName.endsWith('-B'))).toBe(true);
    expect(history.snapshot()).toMatchObject({ status: 'SYNCED', count: 3 });
    expect(await readdir(directory)).toEqual([`${createHash('sha256').update(TOKEN_B).digest('hex')}.json`]);
  });

  it('keeps history cleared when a delayed response arrives after disconnecting the account', async () => {
    const old = deferredResponse();
    const fetchApi = vi.fn<typeof fetch>().mockImplementation(async () => old.promise);
    const { history, secrets, directory } = await fixture(fetchApi);
    const first = history.configure(TOKEN_A);
    await vi.waitFor(() => expect(fetchApi).toHaveBeenCalledTimes(1));
    await history.clear();
    expect(fetchApi.mock.calls[0][1]?.signal?.aborted).toBe(true);
    old.resolve(json(payload()));
    await first;
    expect(await secrets.getStreamlabsWidgetToken()).toBe('');
    expect(history.snapshot()).toMatchObject({ status: 'NOT_CONFIGURED', configured: false, count: 0, lastSyncAt: null });
    expect(history.list()).toEqual([]);
    expect(await readdir(directory)).toEqual([]);
  });

  it.each(['seconds', 'http-date'] as const)('honors Retry-After %s even when a refresh is forced', async kind => {
    const retryAfter = kind === 'seconds' ? '120' : new Date(INITIAL_TIME + 120_000).toUTCString();
    const fetchApi = vi.fn<typeof fetch>()
      .mockImplementationOnce(async () => json({ error: SECRET_MARKER }, 429, { 'retry-after': retryAfter }))
      .mockImplementation(async () => json(payload()));
    const { history, clock } = await fixture(fetchApi);
    await history.configure(TOKEN_A);
    expect(history.snapshot()).toMatchObject({ status: 'ERROR', count: 0 });
    expect(history.snapshot().lastError).not.toContain(SECRET_MARKER);
    clock.now += 61_000;
    await history.refresh(true);
    expect(fetchApi).toHaveBeenCalledTimes(1);
    clock.now = INITIAL_TIME + 120_000;
    await history.refresh(true);
    expect(fetchApi).toHaveBeenCalledTimes(2);
    expect(history.snapshot()).toMatchObject({ status: 'SYNCED', count: 3 });
  });

  it('aborts the active request on stop and performs no further fetch or cache write', async () => {
    let activeSignal: AbortSignal | null | undefined;
    const fetchApi = vi.fn<typeof fetch>().mockImplementation(async (_url, options) => {
      activeSignal = options?.signal;
      return new Promise<Response>((_resolve, reject) => {
        const abort = () => reject(new DOMException('Stopped', 'AbortError'));
        if (activeSignal?.aborted) abort();
        else activeSignal?.addEventListener('abort', abort, { once: true });
      });
    });
    const { history, directory, clock } = await fixture(fetchApi);
    const running = history.configure(TOKEN_A);
    await vi.waitFor(() => expect(fetchApi).toHaveBeenCalledTimes(1));
    await history.stop();
    await running;
    expect(activeSignal?.aborted).toBe(true);
    clock.now += 120_000;
    await history.refresh(true);
    expect(fetchApi).toHaveBeenCalledTimes(1);
    expect(history.list()).toEqual([]);
    expect(await readdir(directory)).toEqual([]);
  });
});
