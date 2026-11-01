import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
// @ts-expect-error Browser JS module without generated declarations.
import { renderMobilePlus } from '../apps/mobile/control/mobile-five-tab-ui.js';
// @ts-expect-error Browser JS module without generated declarations.
import { mountMomentsPage } from '../apps/mobile/control/streamcockpit-moments-page.js';

class Node {
  children: Node[] = [];
  textContent = '';
  value = '';
  hidden = false;
  disabled = false;
  removed = false;
  attributes: Record<string, string> = {};
  listeners = new Map<string, (event?: {preventDefault(): void}) => void>();
  ownerDocument = { createElement: (_tag: string): Node => new Node() };
  setAttribute(key: string, value: string) { this.attributes[key] = value; }
  append(...children: Node[]) { this.children.push(...children); }
  replaceChildren(...children: Node[]) { this.children = [...children]; }
  remove() { this.removed = true; }
  addEventListener(name: string, cb: (event?: {preventDefault(): void}) => void) { this.listeners.set(name, cb); }
  dispatch(name: string) { this.listeners.get(name)?.({ preventDefault() {} }); }
}
function controls(root: Node) {
  const section = root.children[0];
  const [, , form, refresh, status, results] = section.children;
  const [label, submit] = form.children;
  const [input] = label.children;
  return { section, form, refresh, status, results, input, submit };
}
function journal(title = '<img src=x onerror=alert(1)>') {
  return {
    schemaVersion: 1, kind: 'streamcockpit-markers', timebase: 'unix-ms',
    sessionId: 'session_1', readOnly: true,
    markers: [{ sessionId: 'session_1', source: 'obs', status: 'observed',
      title, instant: 1000, sequence: 1 }],
  };
}
it('F09 Plus reads only an explicitly named session, via the paired authenticated request', async () => {
  const root = new Node(), request = vi.fn(async (_path: string) => journal());
  const page = mountMomentsPage(root, {online: true, request});
  const c = controls(root);
  expect(page.isAvailable()).toBe(true);
  expect(request).not.toHaveBeenCalled();
  expect(c.refresh.hidden).toBe(true);
  c.input.value = 'not/a/session';
  c.form.dispatch('submit');
  expect(request).not.toHaveBeenCalled();
  expect(c.status.textContent).toContain('invalide');
  c.input.value = 'session_1';
  c.form.dispatch('submit');
  await vi.waitFor(() => {
    expect(request).toHaveBeenCalledExactlyOnceWith('/api/v1/streamcockpit-moments/session_1');
    expect(c.results.children[0].children[1].children[0].textContent).toContain('<img src=x onerror=alert(1)>');
  });
  expect(c.refresh.hidden).toBe(false);
  c.refresh.dispatch('click');
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  page.destroy();
  expect(c.section.removed).toBe(true);
});

it('F09 clears observed data on session edit, disconnect, and after any late response', async () => {
  const pending: ((data: unknown) => void)[] = [];
  const request = vi.fn((_path: string) => new Promise(resolve => pending.push(resolve)));
  const root = new Node(), page = mountMomentsPage(root, {online: true, request});
  const c = controls(root);
  c.input.value = 'session_1';
  c.form.dispatch('submit');
  expect(request).toHaveBeenCalledTimes(1);
  page.unavailable();
  expect(page.isAvailable()).toBe(false);
  expect(c.input.disabled).toBe(true);
  expect(c.submit.disabled).toBe(true);
  expect(c.results.children).toEqual([]);
  pending[0](journal('late-secret'));
  await Promise.resolve(); await Promise.resolve();
  expect(c.results.children).toEqual([]);
  c.form.dispatch('submit');
  expect(request).toHaveBeenCalledTimes(1);
  expect(c.status.textContent).toContain('déconnecté');
  page.destroy();
});

it('F09 does not fabricate missing sessions or show external errors and rejects unverified responses', async () => {
  const root = new Node();
  const request = vi.fn()
    .mockRejectedValueOnce(new Error('Bearer private-secret'))
    .mockResolvedValueOnce({...journal(), readOnly: false})
    .mockResolvedValueOnce({...journal(), sessionId: 'someone-else'})
    .mockResolvedValueOnce({...journal(), markers: []});
  const page = mountMomentsPage(root, {online: true, request});
  const c = controls(root);
  c.input.value = 'session_1';
  for (let n = 0; n < 4; n++) {
    c.form.dispatch('submit');
    await vi.waitFor(() => {
      const state = c.results.children[0].children[0].textContent;
      if (n < 3) expect(state).toContain('indisponibles');
      else expect(state).toContain('Aucun moment pour cette session');
    });
  }
  expect(c.results.children[0].children[0].textContent).not.toContain('private-secret');
  c.input.value = 'different'; c.input.dispatch('input');
  expect(c.results.children).toEqual([]);
  page.destroy();
});

it('F09 has no offline request path or hidden fallback on the local device', () => {
  const root = new Node(), request = vi.fn();
  const page = mountMomentsPage(root, {online: false, request});
  const c = controls(root);
  expect(c.input.disabled).toBe(true);
  expect(c.submit.disabled).toBe(true);
  c.input.value = 'session_1'; c.form.dispatch('submit');
  c.refresh.dispatch('click');
  expect(request).not.toHaveBeenCalled();
  expect(c.results.children).toEqual([]);
  expect(c.status.textContent).toContain('déconnecté');
  page.destroy();
});

it('F09 is reachable from Plus and included in the production mobile cache graph', () => {
  const html = renderMobilePlus({ data: {host: {}}, online: true, server: 'http://paired.example', esc: (value: unknown) => String(value) });
  expect(html).toContain('data-page="moments"');
  const app = readFileSync('apps/mobile/control/control.js', 'utf8');
  expect(app).toContain("page==='moments'");
  expect(app).toContain('mountMomentsPage($(\'#moments-page\')');
  expect(app).toContain('momentsPage?.unavailable()');
  const sw = readFileSync('apps/mobile/control-sw.js', 'utf8');
  expect(sw).toContain('/mobile/control/streamcockpit-moments-page.js');
  expect(sw).toContain('/mobile/control/streamcockpit-moments.js');
});
