import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createMobileFixture, devFixtureName } from '../apps/mobile/dev-fixtures.js';

const html = readFileSync(new URL('../apps/mobile/index.html', import.meta.url), 'utf8');
const mobile = readFileSync(new URL('../apps/mobile/mobile.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../apps/mobile/mobile.css', import.meta.url), 'utf8');

describe('Android Mobile 2.3 focus surface', () => {
  it('expose quatre destinations stables avec Le camp en secondaire', () => {
    const tabs = [...html.matchAll(/<button data-tab="([^"]+)"/g)].map(match => match[1]);
    expect(tabs).toEqual(['home', 'live', 'sounds', 'planning']);
    expect(html).toContain('id="menu-trigger"');
    expect(html).toContain('data-view="more"');
    expect(html).toContain('id="command-trigger"');
    expect(html).toContain('id="command-palette"');
    expect(html).toContain('id="command-search"');
    expect(mobile).toContain('streamdashboard.mobileRecentCommands');
  });

  it('fournit les deep links et commandes instantanées sans ancien portail', () => {
    for (const link of ['home-viewers-link', 'home-chatters-link', 'open-scenes', 'quick-clip', 'home-mic']) expect(html).toContain(`id="${link}"`);
    for (const tool of ['chat', 'audience', 'supports', 'vod']) expect(html).toContain(`data-open-live-tool="${tool}"`);
    expect(html).not.toContain('<small>OUTILS LIVE</small>');
    expect(html).toContain('class="scene-sheet-grid"');
  });

  it('conserve les fonctions et présente Sons/Plus comme matrices et lignes', () => {
    for (const feature of ['data-hub-panel="chat"', 'data-hub-panel="audience"', 'data-hub-panel="supports"', 'data-hub-panel="vod"', 'data-hub-panel="clips"', 'id="primary-soundboard"', 'id="more-automations"', 'id="diagnostics"']) expect(html).toContain(feature);
    expect(css).toContain('.sound-pad::before');
    expect(css).toContain('.more-group>button,.integration-card');
    expect(mobile).toContain('Le catalogue Soundboard est vide.');
    expect(mobile).toContain('PC StreamDashboard hors ligne.');
  });

  it('remplace l’ancien CSS par un design system accessible', () => {
    for (const token of ['--surface-1:', '--surface-2:', '--surface-3:', '--text-secondary:', '--violet:', '--ember:', '--lavender:', '--warning:', '--line:', '--space-8:', '--motion-normal:']) expect(css).toContain(token);
    expect(css).toContain('min-height:44px');
    expect(css).toContain(':focus-visible');
    expect(css).toContain('prefers-reduced-motion:reduce');
    expect(html).not.toContain('mobile-shell.css');
    expect(css).toContain('gap:var(--space-4);row-gap:var(--space-4)');
    expect(css).toContain('grid-template-columns:repeat(4,minmax(0,1fr))');
    expect(css).toContain('@keyframes campfire-live');
  });

  it('durcit toutes les largeurs mobiles et safe areas', () => {
    expect(css).toContain('html,body{width:100%;max-width:100%;overflow-x:hidden}');
    expect(css).toContain('grid-template-columns:repeat(2,minmax(0,1fr))');
    expect(css).toContain('@media(min-width:540px){.sound-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}');
    expect(css).not.toMatch(/\.sound-pad\{[^}]*width:128px/);
    for (const inset of ['safe-area-inset-top', 'safe-area-inset-bottom', 'safe-area-inset-left', 'safe-area-inset-right']) expect(css).toContain(inset);
  });

  it('garde chaque fonction secondaire accessible depuis Le camp', () => {
    for (const feature of ['Checklist', 'Notes', 'Templates', 'Automatisations', 'Soutiens', 'VOD &amp; Clips', 'Appairage', 'Réglages', 'Diagnostics']) expect(html).toContain(feature);
    expect(html).toContain('id="scene-sheet"');
    expect(html).toContain('id="direct-mic-state"');
  });

  it('propose des préférences locales de focus, mouvement et densité', () => {
    for (const id of ['focus-toggle', 'ui-preferences', 'focus-mode', 'reduce-motion', 'ui-density']) expect(html).toContain(`id="${id}"`);
    expect(mobile).toContain('streamdashboard.mobileUx');
    expect(html).toMatch(/id="ui-preferences"[\s\S]*id="focus-mode"[\s\S]*id="android-options"/);
    expect(mobile).toContain("$('focus-toggle').onclick");
    expect(css).toContain('.focus-mode .focus-secondary');
    expect(css).toContain('.reduce-motion *');
    expect(css).toContain('body[data-density="comfort"]');
  });

  it('sépare Checklist, Notes et Templates en intentions exclusives', () => {
    for (const tab of ['checklist', 'notes', 'templates']) {
      expect(html).toContain(`data-prepare-tab="${tab}"`);
      expect(html).toContain(`data-prepare-panel="${tab}"`);
    }
    expect(mobile).toContain('selectPreparationTab');
    expect(html).not.toContain('Le bouton Préparer t’amène ici');
    expect(html).toContain('class="inline-create"');
  });

  it('stabilise les quatre actions vitales sans modules secondaires dans Live', () => {
    for (const id of ['quick-clip', 'open-scenes', 'home-mic', 'live-clip', 'open-scenes-live', 'quick-mic']) expect(html).toContain(`id="${id}"`);
    expect(css).toContain('gap:20px 16px');
    expect(css).toContain('.sound-pad small{display:none}');
    expect(css).toContain('.hub-tool-tabs [data-hub-tool="supports"]');
  });

  it('borne les fixtures visuelles au développement local', () => {
    expect(devFixtureName({ hostname: 'localhost', search: '?fixture=live' } as Location)).toBe('live');
    expect(devFixtureName({ hostname: 'stream.example', search: '?fixture=live' } as Location)).toBeNull();
    expect(createMobileFixture('live').state.controlHub.audience.viewerCount).toBe(17);
    expect(createMobileFixture('offline').state.obs.streaming).toBe(false);
  });
});
