import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {mountTwitchAdvanced, normalizeAdvancedCapabilities} from '../apps/mobile/control/streamcockpit-twitch-advanced.js';
vi.mock('../apps/mobile/control/agent-v2-status.js', () => ({mountAgentStatus: () => ({destroy: vi.fn()})}));
vi.mock('../apps/mobile/control/twitch-chat.js', () => ({createTwitchChat: () => ({update: vi.fn(), destroy: vi.fn()})}));
// @ts-expect-error existing untyped browser module
import {createLiveMonitor} from '../apps/mobile/control/live-monitor.js';

// DOM/navigation fixture: real EventTarget dispatch, selectors mapped for the existing monitor template.
class Node extends EventTarget {
  ownerDocument = doc; children: Node[] = []; dataset: Record<string, string> = {};
  textContent = ''; className = ''; hidden = false; disabled = false; type = ''; value = '';
  isConnected = true; innerHTML = ''; attributes: Record<string, string> = {}; selectors = new Map<string, Node>();
  classList = {add() {}};
  append(...nodes: Node[]) {this.children.push(...nodes);}
  replaceChildren() {this.children = [];}
  setAttribute(key: string, value: string) {this.attributes[key] = value;}
  removeAttribute(key: string) {delete this.attributes[key];}
  hasAttribute(key: string) {return key in this.attributes;}
  remove() {this.isConnected = false;}
  closest() {return this;}
  querySelector(selector: string): Node {
    if (!this.selectors.has(selector)) this.selectors.set(selector, new Node());
    return this.selectors.get(selector)!;
  }
  querySelectorAll(selector: string) {return [this.querySelector(selector)];}
}
const view = Object.assign(new EventTarget(), {navigator: {onLine: true}});
const doc = Object.assign(new EventTarget(), {defaultView: view, visibilityState: 'visible', createElement: () => new Node()});
const snapshot = (status = 'verified') => ({broadcasterId: '123', checkedAt: Date.now(), validUntil: Date.now() + 60_000,
  shield: {status, mutationAvailable: false}, automod: {status, mutationAvailable: false}});
const flush = async () => {await vi.advanceTimersByTimeAsync(0);};
const mount = (request?: (...args: any[]) => Promise<unknown>) => {
  const root = new Node(); const panel = mountTwitchAdvanced(root as unknown as HTMLElement, {request});
  const section = root.children[0], rows = section.children.filter(n => n.dataset.twitchCapability);
  return {root, panel, section, rows, button: section.children.at(-1)!, status: section.children.at(-2)!};
};
const states = (rows: Node[]) => rows.map(n => n.dataset.status);
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(1_700_000_000_000); view.navigator.onLine = true; doc.visibilityState = 'visible';
});
afterEach(() => {vi.useRealTimers(); vi.unstubAllGlobals();});

describe('advanced capabilities read-only lifecycle', () => {
  it.each(['verified', 'missing-scope', 'forbidden', 'rate-limited', 'unauthorized', 'unavailable', '<img src=x onerror=alert(1)>'])('maps %s without exposing untrusted fields', status => {
    const value = normalizeAdvancedCapabilities({...snapshot(status), token: 'PRIVATE'});
    expect(value.shield).toBe(status === 'verified' ? 'available' : ['missing-scope', 'forbidden', 'rate-limited'].includes(status) ? status : 'unknown');
    expect(JSON.stringify(value)).not.toContain('PRIVATE');
  });
  it('rejects malformed, stale, future, overlong and unbounded identities', () => {
    for (const value of [null, {}, {...snapshot(), checkedAt: Date.now()+1}, {...snapshot(), validUntil: Date.now()},
      {...snapshot(), validUntil: Date.now()+60_001}, {...snapshot(), broadcasterId: '<img>'},
      {...snapshot(), shield: {status: 'verified', mutationAvailable: true}}]) {
      expect(normalizeAdvancedCapabilities(value).shield).toBe('unknown');
    }
  });
  it('does not request while offline, missing source/transport, detached or hidden', async () => {
    const request = vi.fn(async () => snapshot()), a = mount(request), b = mount();
    a.panel.update({online: false, sourceKey: 'host'}); await a.panel.refresh();
    a.panel.update({online: true}); await a.panel.refresh();
    a.root.isConnected = false; a.panel.update({online: true, sourceKey: 'host'}); await a.panel.refresh();
    a.root.isConnected = true; doc.visibilityState = 'hidden'; await a.panel.refresh();
    b.panel.update({online: true, sourceKey: 'host'}); await b.panel.refresh();
    expect(request).not.toHaveBeenCalled(); expect(states(a.rows)).toEqual(['unknown', 'unknown']);
    a.panel.destroy(); b.panel.destroy();
  });
  it('uses only injected GET and expires without polling or retry', async () => {
    const request = vi.fn(async () => snapshot()), a = mount(request);
    a.panel.update({online: true, sourceKey: 'host'}); await flush();
    expect(request.mock.calls).toEqual([['/api/v1/twitch/advanced/capabilities', undefined, 'GET', 'host']]);
    expect(states(a.rows)).toEqual(['available', 'available']);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(states(a.rows)).toEqual(['unknown', 'unknown']); expect(request).toHaveBeenCalledTimes(1);
    a.panel.destroy(); expect(vi.getTimerCount()).toBe(0);
  });
  it.each([401, 403, 429, 503])('clears previous success on HTTP %s; no retry or raw errors', async code => {
    const request = vi.fn(async () => snapshot()), a = mount(request);
    a.panel.update({online: true, sourceKey: 'host'}); await flush();
    request.mockRejectedValueOnce(Object.assign(Error('<img>PRIVATE'), {status: code}));
    const pending = a.panel.refresh(); expect(states(a.rows)).toEqual(['unknown', 'unknown']); await pending;
    expect(states(a.rows)).toEqual(Array(2).fill(code === 403 ? 'forbidden' : code === 429 ? 'rate-limited' : 'unknown'));
    expect(a.status.textContent).not.toContain('PRIVATE'); await vi.advanceTimersByTimeAsync(120_000);
    expect(request).toHaveBeenCalledTimes(2); a.panel.destroy();
  });
  it('fences late results after disconnect, source switch, reconnect and destroy', async () => {
    const pending: ((v: unknown) => void)[] = [], request = vi.fn(() => new Promise(resolve => pending.push(resolve))), a = mount(request);
    a.panel.update({online: true, sourceKey: 'old'}); await flush();
    a.panel.update({online: false, sourceKey: 'old'});
    a.panel.update({online: true, sourceKey: 'new'}); await flush();
    pending[1](snapshot('missing-scope')); await flush(); pending[0](snapshot()); await flush();
    expect(states(a.rows)).toEqual(['missing-scope', 'missing-scope']);
    void a.panel.refresh(); await flush(); a.panel.destroy(); pending[2](snapshot()); await flush();
    expect(states(a.rows)).toEqual(['unknown', 'unknown']); expect(vi.getTimerCount()).toBe(0);
  });
  it('invalidates immediately on browser offline and suspension; online requires explicit refresh', async () => {
    const request = vi.fn(async () => snapshot()), a = mount(request);
    a.panel.update({online: true, sourceKey: 'host'}); await flush();
    view.navigator.onLine = false; view.dispatchEvent(new Event('offline'));
    expect(states(a.rows)).toEqual(['unknown', 'unknown']);
    view.navigator.onLine = true; view.dispatchEvent(new Event('online')); await flush();
    expect(request).toHaveBeenCalledTimes(1);
    a.button.dispatchEvent(new Event('click')); await flush(); expect(states(a.rows)[0]).toBe('available');
    doc.visibilityState = 'hidden'; doc.dispatchEvent(new Event('visibilitychange'));
    expect(states(a.rows)[0]).toBe('unknown'); a.panel.destroy();
  });
  it('invalidates on host account change before accepting the new observation', async () => {
    const request = vi.fn(async () => snapshot()), a = mount(request);
    a.panel.update({online: true, sourceKey: 'host', accountKey: 'first'}); await flush();
    request.mockResolvedValueOnce(snapshot('missing-scope'));
    a.panel.update({online: true, sourceKey: 'host', accountKey: 'second'});
    expect(states(a.rows)).toEqual(['unknown', 'unknown']); await flush();
    expect(states(a.rows)).toEqual(['missing-scope', 'missing-scope']); a.panel.destroy();
  });
  it('does not inject fields, scopes, identities or error HTML into the DOM', async () => {
    const attack = '<img src=x onerror=alert(1)>PRIVATE';
    const a = mount(async () => ({...snapshot(attack), broadcasterId: attack, requiredAny: [attack]}));
    a.panel.update({online: true, sourceKey: 'host'}); await flush();
    expect(a.section.children.map(n => n.textContent).join('')).not.toContain(attack);
    expect(a.section.children.every(n => !n.innerHTML)).toBe(true); a.panel.destroy();
  });
});

it('mounts in actual Live Monitor Chat; hide/show, Chat-only, offline native and navigation destroy', async () => {
  const storage = new Map([['sd2.monitor-enabled', 'true']]);
  vi.stubGlobal('localStorage', {getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v)});
  vi.stubGlobal('document', doc); vi.stubGlobal('matchMedia', () => ({matches: true})); vi.stubGlobal('location', {hostname: 'fixture.invalid'});
  const request = vi.fn(async () => snapshot()), root = new Node();
  const monitor = createLiveMonitor(root, {native: true, request});
  const chat = root.querySelector('.monitor-chat'), section = chat.children[0];
  expect(section.attributes['aria-label']).toBe('Permissions Twitch avancées');
  monitor.update({}, {online: false, sourceKey: 'host', chatOnly: true}); await flush(); expect(request).not.toHaveBeenCalled();
  monitor.update({}, {online: true, sourceKey: 'host', chatOnly: true}); await flush(); expect(request).toHaveBeenCalledTimes(1);
  monitor.update({}, {online: false, sourceKey: 'host', chatOnly: true});
  expect(section.children.filter(n => n.dataset.twitchCapability).every(n => n.dataset.status === 'unknown')).toBe(true);
  monitor.destroy(); expect(section.isConnected).toBe(false); expect(vi.getTimerCount()).toBe(0);
  storage.set('sd2.monitor-enabled', 'false');
  const next = createLiveMonitor(new Node(), {request});
  next.update({}, {online: true, sourceKey: 'host', chatOnly: false}); await flush(); expect(request).toHaveBeenCalledTimes(1);
  next.update({}, {online: true, sourceKey: 'host', chatOnly: true}); await flush(); expect(request).toHaveBeenCalledTimes(2);
  next.update({}, {online: true, sourceKey: 'host', chatOnly: false}); next.destroy();
});
it('existing source/auth guard, no-store and navigation teardown remain wired', () => {
  const control = readFileSync('apps/mobile/control/control.js', 'utf8');
  expect(control).toContain('request:liveChatRequest'); expect(control).toContain('sourceKey!==target');
  expect(control).toContain('return network(path,body,method,target,target===localEndpoint?\'\':credential)');
  expect(control).toContain('liveMonitor?.destroy();liveMonitor=undefined');
  const router = readFileSync('apps/server/src/streamcockpit-twitch-router.ts', 'utf8');
  expect(router).toContain("res.set('Cache-Control', 'no-store')");
  expect(router).toContain('!current.canRead');
});
