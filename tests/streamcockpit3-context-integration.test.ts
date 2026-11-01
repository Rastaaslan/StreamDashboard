import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { renderContextPreview } from '../apps/mobile/control/streamcockpit-context-preview.js';
import { contextBrowserSource } from '../apps/mobile/control/streamcockpit-context-build.mjs';
// @ts-expect-error Existing five-tab presentation has no declaration file.
import { renderMobileHome, renderMobilePlus } from '../apps/mobile/control/mobile-five-tab-ui.js';
import { MOBILE_PANES } from '../apps/mobile/control/mobile-panes.js';

const read = (path: string) => readFile(new URL('../' + path, import.meta.url), 'utf8');
const actions = [{ id: 'live.start', label: '<img src=x onerror="alert(1)">' }];
describe('Mounted mobile context preview, deliberately not authorized', () => {
  it('ships exactly the canonical core compiled for the browser', async () => {
    expect(await read('apps/mobile/control/streamcockpit-context-core.js')).toBe(await contextBrowserSource());
  });
  it.each([false, true, false, true])('neutralizes offline and reconnect without trusting cached state (%s)', online => {
    const html = renderContextPreview({ online, server: 'paired', actions });
    expect(html).toContain('UNKNOWN');
    expect(html).toContain('Sélection contextuelle suspendue');
    expect(html).toContain('scene, game, streamState, role, capabilities');
    expect(html).not.toContain('Agent connecté');
    expect(html).not.toMatch(/data-action=|data-command=|<button|Présentation disponible/);
    expect(html).toContain(online ? 'contexte maître non vérifié' : 'contexte neutralisé');
  });
  it('never promotes an unpaired client and escapes labels and routing payloads', () => {
    const html = renderContextPreview({ online: true, actions });
    expect(html).toContain('non associée');
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('live.start');
    expect(renderContextPreview({ actions: null })).toContain('(0)');
  });
  it('mounts inside the existing Sons Deck and preserves the manual command circuit', async () => {
    const source = await read('apps/mobile/control/control.js');
    expect(source).toContain("choice==='actions'&&group==='sounds'");
    expect(source).toContain('renderContextPreview({online,server,actions:available})');
    expect(source).toContain("mobilePerformancePage('deck')");
    expect(source).toContain('async function runAction(');
    const preview = await read('apps/mobile/control/streamcockpit-context-preview.js');
    expect(preview).not.toMatch(/fetch\(|setInterval\(|setTimeout\(|runAction\(|localStorage/);
    expect(preview).not.toContain('data-timer-clock');
  });
  it('keeps the five top-level tabs', async () => {
    const html = await read('apps/mobile/control/index.html');
    for (const id of ['home', 'live', 'sounds', 'planning', 'plus']) expect(html).toContain('data-page="' + id + '"');
  });
  it('keeps navigation, master timer, Diffusion, DJI and service access', () => {
    const args = { data: {host: {state: {timer: {remaining: 75, duration: 300}}}},
      online: false, server: 'paired', live: {}, esc: (v: unknown) => String(v) };
    const home = renderMobileHome(args), plus = renderMobilePlus(args);
    expect(home).toContain('00:01:15');
    expect(home).toContain('Minuteur du fixe');
    expect(home).toContain('Hôte indisponible');
    expect(home).toContain('live:control');
    expect(home).toContain('sounds:actions');
    expect(home).toContain('data-page="planning"');
    expect(plus).toContain('DJI');
    expect(plus).toContain('sounds:wizebot');
    expect(plus).toContain('sounds:streamlabs');
    expect(MOBILE_PANES.deck.map(p => p.id)).toEqual(['sounds','actions','wizebot','streamlabs']);
  });
});
