import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createMobileFixture, devFixtureName } from '../apps/mobile/dev-fixtures.js';
const html = readFileSync(new URL('../apps/mobile/index.html', import.meta.url), 'utf8');
const mobile = readFileSync(new URL('../apps/mobile/mobile.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../apps/mobile/mobile.css', import.meta.url), 'utf8');
describe('mobile information architecture', () => {
  it('ne référence aucun id statique absent', () => { const ids=[...new Set([...mobile.matchAll(/\$\('([^']+)'\)/g)].map(m=>m[1]))]; expect(ids.filter(id=>!html.includes(`id="${id}"`))).toEqual([]); });
  it('garde exactement cinq destinations principales', () => { expect([...html.matchAll(/<button\b[^>]*\bdata-tab="([^"]+)"[^>]*>/g)].map(m=>m[1])).toEqual(['home','live','sounds','planning','more']); });
  it('supprime la palette flottante mobile', () => { expect(html).not.toContain('command-trigger'); expect(html).not.toContain('command-palette'); expect(mobile).not.toContain('mobileRecentCommands'); });
  it('réduit le header à la marque et un indicateur ouvrant les détails', () => { for(const id of ['status-trigger','status-dot','status-sheet','connection','obs-status-detail','twitch-status-detail','last-sync']) expect(html).toContain(`id="${id}"`); expect(html).not.toContain('id="focus-toggle"'); expect(css).toContain('white-space:nowrap'); });
  it('rend le chat et les contrôles essentiels visibles dans Live', () => { for(const id of ['hub-chat','chat-form','live-viewers','open-scenes-live','quick-mic','live-stream']) expect(html).toContain(`id="${id}"`); expect(html).toContain('id="live-tools-sheet"'); expect(html).toContain('data-open-live-tool="timer"'); expect(html).not.toContain('hub-tool-tabs'); expect(html).not.toMatch(/sr-only[^>]*>[\s\S]{0,80}id="timer"/); });
  it('réserve Sons à sa destination principale', () => { expect(html).toContain('data-view="sounds"'); expect(html).toContain('id="sound-search"'); expect(html).toContain('id="stop-sound"'); expect(html).toContain('id="sound-volume"'); expect(html).not.toContain('id="sound-volume" type="range" min="0" max="100" value="100" disabled'); expect(html).not.toContain('data-open-tab="sounds"'); expect(html).not.toContain('data-hub-panel="soundboard"'); expect(mobile).toContain('setSoundVolume'); expect(mobile).toContain("StreamDashboard • Soundboard"); expect(mobile).toContain('publicObsMediaInputs'); expect(mobile).not.toContain('renderCommandSounds()'); });
  it('organise Plus par intentions sans doublonner les onglets', () => { for(const label of ['Préparer','Communauté','Automatiser','Application','Avant le live','Notes','Modèles de live','Comptes connectés','État technique']) expect(html).toContain(label); });
  it('stabilise le sizing réel du Planning et des Modèles', () => {
    expect(mobile).toContain('planningWhenParts');
    expect(mobile).toContain("actions.className = 'planning-actions'");
    expect(css).toContain('grid-template-columns:88px minmax(0,1fr)');
    expect(css).toContain('#add-slot{flex:0 0 auto');
    expect(css).toContain('.template-summary{display:grid');
    expect(css).toContain('.template-use{width:max-content');
    expect(css).toContain('padding:max(24px,env(safe-area-inset-top))');
  });
  it('conserve modules, offline et retour Android', () => { expect(mobile).toContain("document.querySelectorAll('[data-module]')"); expect(mobile).toContain('window.StreamDashboardHandleBack'); expect(mobile).toContain('offlineState'); });
  it('couvre petits écrans, safe areas et thèmes', () => { expect(css).toContain('@media(max-width:360px)'); for(const x of ['safe-area-inset-top','safe-area-inset-bottom','safe-area-inset-left','safe-area-inset-right','data-theme="light"','data-theme="oled"']) expect(css).toContain(x); });
  it('borne les fixtures au développement local', () => { expect(devFixtureName({hostname:'localhost',search:'?fixture=live'} as Location)).toBe('live'); expect(devFixtureName({hostname:'stream.example',search:'?fixture=live'} as Location)).toBeNull(); expect(createMobileFixture('live').state.controlHub.audience.viewerCount).toBe(17); });
});
