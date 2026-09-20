import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../apps/desktop/src/main.ts', import.meta.url), 'utf8');
const html = readFileSync(new URL('../apps/web/preview/index.html', import.meta.url), 'utf8');
const renderer = readFileSync(new URL('../apps/web/preview/preview.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../apps/web/preview/preview.css', import.meta.url), 'utf8');
const server = readFileSync(new URL('../apps/server/src/index.ts', import.meta.url), 'utf8');

describe('Desktop V2 promu en production', () => {
  it('est bien le shell chargé par Electron et possède une CSP', () => {
    expect(main).toContain("'/preview/?runtime=1'");
    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain("script-src 'self'");
    expect(html).toContain('id="brand-context"');
    expect(html).toContain('>Application<');
  });

  it('consomme le ProductProfile partagé au lieu d’une configuration parallèle', () => {
    expect(renderer).toContain("request('/api/v1/profile')");
    expect(renderer).toContain("request('/api/v1/connections')");
    expect(renderer).toContain('applyProductAppearance');
    expect(renderer).toContain('projectProductShell');
    expect(renderer).toContain('data-profile-module');
    expect(renderer).toContain("campItem==='Personnalisation'");
    expect(renderer).toContain("'/api/v1/profile/export'");
    expect(renderer).toContain("'/api/v1/profile/import'");
  });

  it('projette modules, dépendances, providers et onboarding sans bloquer le cockpit', () => {
    expect(renderer).toContain("soundboard:['obs']");
    expect(renderer).toContain("streamerPings:['twitch']");
    expect(renderer).toContain("googleCalendar:['planning']");
    expect(renderer).toContain('connectionModuleByName');
    expect(renderer).toContain('onboardingCard');
    expect(renderer).toContain('Rien ne bloque l’utilisation du cockpit');
    expect(renderer).toContain("next.onboarding={completed:true}");
  });

  it('applique les tokens de personnalisation au shell réel', () => {
    for (const token of ['--product-accent:', '--product-font-scale:', '--radius:', '--section-pad:', '--layout-gap:']) expect(css).toContain(token);
    for (const theme of ['data-theme="light"', 'data-theme="dark"', 'data-theme="oled"']) expect(css).toContain(theme);
    expect(css).toContain('data-density="compact"');
    expect(css).toContain('data-radius="round"');
    expect(css).toContain('.module-grid');
    expect(css).toContain('.camp-nav-group');
  });

  it('organise Application par intention tout en conservant les domaines existants', () => {
    for (const group of ['PRÉPARER', 'COMMUNAUTÉ', 'AUTOMATISER', 'APPLICATION']) expect(renderer).toContain(group);
    for (const item of ['Préparation','Notes','Templates','Soutiens','Alertes viewers','Automatisations','Médias OBS','Connexions','Personnalisation','Réglages','Diagnostics']) expect(renderer).toContain(item);
  });
  it('reconstruit Accueil, Live et Planning autour de leur intention principale', () => {
    expect(renderer).toContain('const nextLiveCopy=');
    expect(renderer).toContain('État de préparation');
    expect(renderer).not.toContain('<h2>Scènes principales</h2><span class="label">Active');
    expect(renderer).toContain('id="desktop-chat-form"');
    expect(renderer).toContain('data-live-clip');
    expect(renderer).toContain('Audience ·');
    expect(renderer).toContain('class="planning-more"');
    expect(renderer).toContain('Partager & exporter');
    expect(css).toContain('.live-desktop-grid');
    expect(css).toContain('.desktop-chat-list');
    expect(css).toContain('.home-hero');
  });

  it('ne réexpose pas la Media Source interne de la Soundboard dans les médias utilisateur', () => {
    expect(renderer).toContain("OBS_SOUNDBOARD_INPUT='StreamDashboard • Soundboard'");
    expect(renderer).toContain('publicObsMediaInputs');
    expect(renderer).toContain('const media=publicObsMediaInputs(obs.mediaInputs)');
  });
  it('utilise l’identité du ProductProfile comme source canonique côté Desktop', () => {
    expect(renderer).toContain("state.productProfile?.profile?.displayName||state.dashboard?.settings?.streamerName");
    expect(renderer).toContain("state.productProfile?.profile?.displayName||state.dashboard.settings?.streamerName");
    expect(renderer).not.toContain('Nom local<input name="streamerName"');
  });

  it('raccorde aussi la Soundboard OBS aux scènes personnalisées du profil', () => {
    expect(server).toContain('...productProfile.obs.scenes.map(item => item.scene)');
    expect(server).toContain('soundboardTargetScenes');
  });

  it('rend les scènes et actions rapides réellement configurables par profil', () => {
    expect(renderer).toContain('const sceneEntries=');
    expect(renderer).toContain('state.productProfile?.obs?.scenes');
    expect(renderer).toContain("type:'obs.scene',scene:entry.scene");
    expect(renderer).toContain('data-profile-scene-label');
    expect(renderer).toContain('data-profile-scene-name');
    expect(renderer).toContain('data-profile-quick');
    expect(renderer).toContain('data-profile-quick-action');
    expect(renderer).toContain("quickActions:[...form.querySelectorAll('[data-profile-quick]:checked')]");
    expect(css).toContain('.profile-scene-row');
    expect(css).toContain('.live-quick-actions');
  });

  it('replace les fonctions Twitch et Streamer Pings dans leur contexte naturel', () => {
    expect(renderer).toContain("items:['Soutiens','Alertes viewers']");
    expect(renderer).toContain("item==='Alertes viewers'");
    expect(renderer).toContain('id="live-twitch-settings"');
    expect(renderer).toContain('data-live-twitch-category-search');
    expect(renderer).not.toContain('id="camp-twitch-live-settings"');
    expect(css).toContain('.live-twitch-settings');
  });

  it('fait de Sons une bibliothèque autonome avec filtres et volume maître', () => {
    expect(renderer).toContain('data-sound-category');
    expect(renderer).toContain('data-sound-favorites');
    expect(renderer).toContain('data-sound-master');
    expect(renderer).toContain('streamdashboard.desktopSoundboardVolume');
    expect(renderer).toContain("'/api/v1/soundboard/volume'");
    expect(renderer).toContain('(sound?.volume??1)*state.soundMasterVolume');
    expect(css).toContain('.soundboard-hero');
    expect(css).toContain('.soundboard-filters');
    expect(css).toContain('.sound-master');
  });
});
