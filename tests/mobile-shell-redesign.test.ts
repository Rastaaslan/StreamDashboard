import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createMobileFixture, devFixtureName } from '../apps/mobile/dev-fixtures.js';

const html = readFileSync(new URL('../apps/mobile/index.html', import.meta.url), 'utf8');
const mobile = readFileSync(new URL('../apps/mobile/mobile.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../apps/mobile/mobile.css', import.meta.url), 'utf8');

describe('Android Mobile 2.0 control surface', () => {
  it('expose quatre destinations, le menu secondaire et la palette globale', () => {
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
    for (const link of ['home-viewers-link', 'home-chatters-link', 'home-scene-link', 'quick-clip', 'quick-mic']) expect(html).toContain(`id="${link}"`);
    for (const tool of ['chat', 'audience', 'supports', 'vod']) expect(html).toContain(`data-open-live-tool="${tool}"`);
    expect(html).not.toContain('<small>OUTILS LIVE</small>');
    expect(html).toContain('class="scene-bank"');
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
    expect(css).toContain('grid-template-columns:repeat(4,1fr)');
    expect(css).toContain('@keyframes campfire-live');
  });

  it('borne les fixtures visuelles au développement local', () => {
    expect(devFixtureName({ hostname: 'localhost', search: '?fixture=live' } as Location)).toBe('live');
    expect(devFixtureName({ hostname: 'stream.example', search: '?fixture=live' } as Location)).toBeNull();
    expect(createMobileFixture('live').state.controlHub.audience.viewerCount).toBe(17);
    expect(createMobileFixture('offline').state.obs.streaming).toBe(false);
  });
});
