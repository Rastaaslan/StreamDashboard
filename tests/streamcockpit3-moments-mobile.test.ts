import { expect, it } from 'vitest';
// @ts-expect-error Isolated browser JS module has no declaration file.
import { mountMomentsTimeline } from '../apps/mobile/control/streamcockpit-moments.js';

/** Minimal DOM contract fixture: not browser/device qualification. */
class Element {
  children: Element[] = [];
  textContent = '';
  value = '';
  hidden = false;
  listeners = new Map<string, () => void>();
  attrs: Record<string, string> = {};
  removed = false;
  ownerDocument = { createElement: (_tag: string): Element => new Element() };
  setAttribute(key: string, value: string) { this.attrs[key] = value; }
  append(...children: Element[]) { this.children.push(...children); }
  replaceChildren(...children: Element[]) { this.children = [...children]; }
  addEventListener(name: string, callback: () => void) { this.listeners.set(name, callback); }
  dispatch(name: string) { this.listeners.get(name)?.(); }
  remove() { this.removed = true; }
}
const data = (title = '<img src=x onerror=alert(1)>') => ({
  schemaVersion: 1, kind: 'streamcockpit-markers', timebase: 'unix-ms', sessionId: 'session',
  markers: [{ sessionId: 'session', instant: 1000, sequence: 1, source: 'manual', status: 'uncertain', title }],
});
it('renders read-only text, empty and unavailable states; removes stale data on failure', async () => {
  const root = new Element(); let value: unknown = data();
  const component = mountMomentsTimeline(root, { sessionId: 'session', read: async () => value });
  await component.refresh();
  const [status, list] = root.children[0].children;
  expect(list.children[0].textContent).toContain('<img src=x onerror=alert(1)>');
  expect(status.textContent).toContain('lecture seule');
  value = { ...data(), markers: [] }; await component.refresh();
  expect(status.textContent).toContain('Aucun moment');
  value = { ...data(), sessionId: 'foreign' }; await component.refresh();
  expect(status.textContent).toContain('indisponibles'); expect(list.children).toEqual([]);
  component.destroy(); expect(root.children[0].removed).toBe(true);
});
it('ignores stale and post-destroy responses', async () => {
  const pending: ((value: unknown) => void)[] = [], root = new Element();
  const component = mountMomentsTimeline(root, { sessionId: 'session', read: () => new Promise(resolve => pending.push(resolve)) });
  const latest = component.refresh(); pending[1](data('latest')); await latest;
  pending[0](data('old')); await Promise.resolve();
  const list = root.children[0].children[1]; expect(list.children[0].textContent).toContain('latest');
  const last = component.refresh(); component.destroy(); pending[2](data('destroyed')); await last;
  expect(list.children).toEqual([]); // Destroy must erase private data, even from detached DOM.
});

it('offers factual observed-marker summaries and local source/status filters without another request', async () => {
  const root = new Element();
  let calls = 0;
  const feed = {
    ...data(), markers: [
      { sessionId: 'session', instant: 62000, sequence: 2, source: 'twitch', status: 'confirmed', title: 'Clip confirmé' },
      { sessionId: 'session', instant: 2000, sequence: 1, source: 'obs', status: 'uncertain', title: 'OBS incertain' },
      { sessionId: 'session', instant: 122000, sequence: 3, source: 'manual', status: 'observed', title: 'Note' },
    ],
  };
  const component = mountMomentsTimeline(root, { sessionId: 'session', read: async () => { calls++; return feed; } });
  await component.refresh();
  const [status, list, filters, summary] = root.children[0].children;
  const sourceSelect = filters.children[0].children[0];
  const statusSelect = filters.children[1].children[0];
  expect(list.children.map(c => c.textContent)).toEqual([
    expect.stringContaining('OBS incertain'),
    expect.stringContaining('Clip confirmé'),
    expect.stringContaining('Note'),
  ]);
  expect(summary.textContent).toContain('3 repère(s) observé(s)');
  expect(summary.textContent).toContain('1 confirmé(s)');
  expect(summary.textContent).toContain('1 incertain(s)');
  expect(summary.textContent).toContain('Écart entre repères : 2 min');
  expect(summary.textContent).not.toContain('durée du live');
  expect(filters.hidden).toBe(false);
  const readsBeforeFilters = calls;
  sourceSelect.value = 'twitch'; sourceSelect.dispatch('change');
  expect(list.children).toHaveLength(1);
  expect(list.children[0].textContent).toContain('Clip confirmé');
  statusSelect.value = 'uncertain'; statusSelect.dispatch('change');
  expect(list.children).toEqual([]);
  expect(status.textContent).toContain('0 sur 3');
  expect(calls).toBe(readsBeforeFilters);
  component.destroy();
  expect(summary.textContent).toBe('');
  expect(list.children).toEqual([]);
  expect(filters.hidden).toBe(true);
});

it('fails closed on an oversized or invalid feed and never keeps a prior marker after a bad refresh', async () => {
  const root = new Element();
  let current: unknown = data('private');
  const component = mountMomentsTimeline(root, { sessionId: 'session', read: async () => current });
  await component.refresh();
  const [status, list, filters, summary] = root.children[0].children;
  expect(list.children).toHaveLength(1);
  current = { ...data(), markers: new Array(10001).fill(data().markers[0]) };
  await component.refresh();
  expect(list.children).toEqual([]);
  expect(summary.textContent).toBe('');
  expect(filters.hidden).toBe(true);
  expect(status.textContent).toContain('indisponibles');
  current = { ...data(), markers: [{ ...data().markers[0], title: 'a'.repeat(241) }] };
  await component.refresh();
  expect(status.textContent).toContain('indisponibles');
  expect(list.children).toEqual([]);
  component.destroy();
});
