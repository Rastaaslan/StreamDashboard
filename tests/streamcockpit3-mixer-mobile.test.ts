import { expect, it } from 'vitest';
// @ts-expect-error Isolated browser JS has no declaration file.
import { mountMixerTable } from '../apps/mobile/control/streamcockpit-mixer.js';
import { mixerTelemetry } from '../packages/core/src/streamcockpit-mixer.js';
class Element {
  children: Element[] = []; textContent = ''; removed = false;
  ownerDocument = { createElement: (_tag: string): Element => new Element() };
  setAttribute(_key: string, _value: string) {}
  append(...children: Element[]) { this.children.push(...children); }
  replaceChildren() { this.children = []; }
  remove() { this.removed = true; }
}
const data = () => mixerTelemetry({ owner: 'FIXE', revision: '1', observedAt: 100, connected: true, errors: [], outputs: [], sources: [{ id: 'x', name: '<img onerror=evil>' }] }, 100);
it('renders text-only table and unknown readings; clears failure', async () => {
  const root = new Element(); let value: unknown = data();
  const view = mountMixerTable(root, { read: async () => value }); await view.refresh();
  const [status, table] = root.children[0].children;
  expect(status.textContent).toContain('Lecture seule');
  expect(table.children[1].children[0].textContent).toBe('<img onerror=evil>');
  expect(table.children[1].children[1].textContent).toContain('Inconnu');
  value = null; await view.refresh(); expect(table.children).toEqual([]); expect(status.textContent).toContain('indisponible');
});
it('discards older responses and responses after destruction', async () => {
  const root = new Element(), pending: ((v: unknown) => void)[] = [];
  const view = mountMixerTable(root, { read: () => new Promise(resolve => pending.push(resolve)) });
  const next = view.refresh(); pending[1](data()); await next;
  pending[0](null); await Promise.resolve();
  expect(root.children[0].children[1].children.length).toBe(2);
  const last = view.refresh(); view.destroy(); pending[2](data()); await last;
  expect(root.children[0].removed).toBe(true);
});
