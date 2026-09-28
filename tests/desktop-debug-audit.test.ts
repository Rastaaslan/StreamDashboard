import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const renderer = readFileSync(new URL('../apps/web/preview/preview.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../apps/web/preview/preview.css', import.meta.url), 'utf8');
const preload = readFileSync(new URL('../apps/desktop/src/preload.cts', import.meta.url), 'utf8');

describe('audit debug Desktop', () => {
  it('garde chaque appel du bridge Electron exposé par le preload', () => {
    const used = [...new Set([...renderer.matchAll(/streamDashboardDesktop\?\.([A-Za-z0-9_]+)/g)].map(match => match[1]))];
    const exposed = new Set([...preload.matchAll(/^\s{2}([A-Za-z0-9_]+):/gm)].map(match => match[1]));
    expect(used.filter(name => !exposed.has(name))).toEqual([]);
  });

  it('branche chaque action de connexion statique à un handler', () => {
    const rendered = [...new Set([...renderer.matchAll(/data-connection-action="([^"]+)"/g)].map(match => match[1]))].filter(action => !action.includes('${'));
    const handled = new Set([...renderer.matchAll(/action==='([^']+)'/g)].map(match => match[1]));
    expect(rendered.filter(action => !handled.has(action))).toEqual([]);
  });

  it('branche chaque action Application statique à un handler', () => {
    const rendered = [...new Set([...renderer.matchAll(/data-camp-action="([^"]+)"/g)].map(match => match[1]))];
    expect(rendered.filter(action => renderer.split(`data-camp-action="${action}"`).length < 3)).toEqual([]);
  });

  it('présente les participants du chat en liste verticale, distincte du viewer count', () => {
    expect(renderer).toContain('Participants du chat ·');
    expect(renderer).toContain("broadcaster:'Streamer'");
    expect(renderer).toContain("viewer:'Chatteur'");
    expect(css).toContain('.audience-list{display:grid;grid-template-columns:1fr');
    expect(css).toContain('grid-template-columns:minmax(0,1fr) auto');
  });

  it('garde le raccourci Application lisible dans la sidebar', () => {
    expect(css).toContain('.camp{display:grid!important');
    expect(css).toContain('.camp>small');
    expect(css).toContain('white-space:nowrap');
  });

  it('désactive les actions Twitch impossibles avant le clic', () => {
    expect(renderer).toContain("twitchCapability('chatWrite')");
    expect(renderer).toContain("twitchCapability('createClip')");
    expect(renderer).toContain("twitchCapability('updateChannel')");
    expect(renderer).toContain("request('/api/v1/twitch/moderation/capabilities')");
    expect(renderer).toContain("Le live doit être démarré pour créer un clip.");
  });

  it('désactive les actions providers qui nécessitent encore une configuration', () => {
    expect(renderer).toContain("target?'':'disabled'");
    expect(renderer).toContain("state.dashboard?.discord?.connected?'':'disabled'");
    expect(renderer).toContain("values.provider?.status==='CONNECTED'?'':'disabled'");
  });
  it('affiche réellement le Runtime hors ligne quand son chargement échoue', () => {
    expect(renderer).toContain("runtimeUi(false,'Runtime indisponible')");
    expect(renderer).not.toContain("runtimeUi(true,'Runtime indisponible')");
  });

});
