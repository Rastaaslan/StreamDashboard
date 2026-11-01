import { expect, it } from 'vitest';
// @ts-expect-error Isolated browser JS module has no declaration file.
import { mountMomentsTimeline } from '../apps/mobile/control/streamcockpit-moments.js';

/** Minimal DOM contract fixture: not browser/device qualification. */
class Element {
  children: Element[] = [];
  textContent = '';
  attrs: Record<string, string> = {};
  removed = false;
  ownerDocument = { createElement: (_tag: string): Element => new Element() };
  setAttribute(key: string, value: string) { this.attrs[key] = value; }
  append(...children: Element[]) { this.children.push(...children); }
  replaceChildren() { this.children = []; }
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
  expect(list.children[0].textContent).toContain('latest');
});
