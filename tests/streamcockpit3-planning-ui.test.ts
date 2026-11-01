import { expect, it } from 'vitest';
// @ts-expect-error Standalone browser module intentionally has no generated declaration.
import { mountPlanningProposal } from '../apps/mobile/control/streamcockpit-planning.js';
import { proposeSessionDuplicate, type PlanningObservation } from '../packages/core/src/streamcockpit-planning.js';

/** DOM contract fixture, not a browser/device qualification. */
class Element {
  children: Element[] = [];
  textContent = '';
  disabled = false;
  removed = false;
  type = '';
  attrs: Record<string, string> = {};
  ownerDocument = { createElement: () => new Element() };
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  append(...children: Element[]) { this.children.push(...children); }
  addEventListener() {}
  removeEventListener() {}
  remove() { this.removed = true; }
}
const now = Date.parse('2026-03-28T08:00:00Z');
const observations = (): PlanningObservation[] => [
  { source: 'local', status: 'observed', observedAt: '2026-03-28T08:00:00Z', from: '2026-03-28T00:00:00Z', to: '2026-03-30T00:00:00Z', items: [
    { id: 'a', title: '<img src=x onerror=alert(1)>', category: 'live', startAtUtc: '2026-03-28T19:00:00Z', endAtUtc: '2026-03-28T21:00:00Z' },
  ] },
  { source: 'google', status: 'disabled', observedAt: '', from: '', to: '', items: [] },
];
function setup(readLatest = async () => observations()) {
  const root = new Element();
  const proposal = proposeSessionDuplicate(observations(), { source: 'local', id: 'a' }, { from: '2026-03-29T18:00:00Z', to: '2026-03-29T20:00:00Z' }, now);
  const ui = mountPlanningProposal(root, { proposal, readLatest, now: () => now });
  return { root, ui, proposal, status: root.children[0].children[2] };
}
it('affiche texte sûr et Paris, prépare un brouillon sans prétendre l’enregistrer', async () => {
  const { root, ui, status } = setup();
  expect(root.children[0].children[0].textContent).toContain('<img');
  expect(root.children[0].children[1].textContent).toContain('20:00');
  expect(status.textContent).toContain('lecture seule');
  expect(ui.getDraft()).toBeUndefined();
  await ui.confirm();
  expect(status.textContent).toContain('non enregistré et non publié');
  const draft = ui.getDraft(); draft.title = 'changed';
  expect(ui.getDraft().title).toContain('<img');
  await ui.confirm(); expect(ui.getDraft().id).toBe(draft.id);
});
it('affiche les erreurs de lecture et permet de réessayer', async () => {
  let fail = true;
  const { ui, status } = setup(async () => { if (fail) throw new Error('Google hors ligne'); return observations(); });
  await ui.confirm(); expect(status.textContent).toContain('Google hors ligne'); expect(ui.getDraft()).toBeUndefined();
  fail = false; await ui.confirm(); expect(ui.getDraft()).toBeDefined();
});
it.each(['cancel', 'destroy'])('ignore une lecture tardive après %s', async action => {
  let resolve!: (value: PlanningObservation[]) => void;
  const { ui, proposal } = setup(() => new Promise(r => { resolve = r; }));
  const pending = ui.confirm();
  ui[action](); resolve(observations()); await pending;
  expect(ui.getDraft()).toBeUndefined(); expect(proposal.state).toBe('cancelled');
});
it('bloque les doubles confirmations pendant la relecture', async () => {
  let reads = 0, resolve!: (value: PlanningObservation[]) => void;
  const { ui } = setup(() => { reads++; return new Promise(r => { resolve = r; }); });
  const pending = ui.confirm(); await ui.confirm();
  expect(reads).toBe(1); resolve(observations()); await pending;
});
it('affiche un conflit apparu à la confirmation sans faux succès', async () => {
  const { ui, status } = setup(async () => {
    const latest = observations(); latest[0].items.push({ id: 'busy', title: 'Occupé', startAtUtc: '2026-03-29T18:00:00Z', endAtUtc: '2026-03-29T20:00:00Z' }); return latest;
  });
  await ui.confirm(); expect(status.textContent).toContain('Chevauchement'); expect(ui.getDraft()).toBeUndefined();
});
