import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { apiUrl, nextRetry, normalizeServer, parsePairing, websocketUrl } from '../apps/mobile/runtime.js';

const mobileIndex = readFileSync(new URL('../apps/mobile/index.html', import.meta.url), 'utf8');
const mobileScript = readFileSync(new URL('../apps/mobile/mobile.js', import.meta.url), 'utf8');
const templatesFeature = readFileSync(new URL('../apps/mobile/features/templates.js', import.meta.url), 'utf8');
const remotePolicy = readFileSync(new URL('../apps/server/src/remote-policy.ts', import.meta.url), 'utf8');
const androidActivity = readFileSync(new URL('../android/app/src/main/java/com/rastaaslan/streamdashboard/remote/MainActivity.java', import.meta.url), 'utf8');
const androidManifest = readFileSync(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
const androidFilePaths = readFileSync(new URL('../android/app/src/main/res/xml/file_paths.xml', import.meta.url), 'utf8');

describe('Android remote runtime', () => {
  it('expose Pause avec les quatre modes et conserve le flux mode.set partagé', () => {
    for (const mode of ['intro', 'live', 'pause', 'end']) expect(mobileIndex).toContain(`data-mode="${mode}"`);
    expect(mobileScript).toContain("command({ type: 'mode.set', mode: button.dataset.mode })");
    expect(mobileScript).toContain("button.dataset.mode === next.mode && !(button.dataset.mode === 'live' && chattingActive)");
    expect(remotePolicy).toContain("new Set(['intro', 'live', 'pause', 'end'])");
  });
  it('expose le preset Chatting sans créer de RunMode ni accepter une scène arbitraire', () => {
    expect(mobileIndex).toMatch(/data-chatting[^>]*>[\s\S]*?Chatting/);
    expect(mobileScript).toContain("command({ type: 'scene.chatting' })");
    expect(mobileScript).toContain("next.mode === 'live'");
    expect(mobileScript).toContain("next.obs.scene === next.settings.chattingScene");
    expect(remotePolicy).toContain("case 'scene.chatting'");
    expect(remotePolicy).not.toContain("case 'obs.scene'");
  });
  it('présente cinq destinations et un menu secondaire sans reconnecter le WebSocket', () => {
    for (const tab of ['home', 'live', 'sounds', 'planning', 'more']) expect(mobileIndex).toContain(`data-tab="${tab}"`);
    expect(mobileIndex).toContain('Modèles de live');
    expect(mobileIndex).toContain('Avant le live');
    expect(mobileIndex).toContain('id="menu-trigger"');
    expect(mobileScript).toContain("localStorage.setItem('streamdashboard.mobileTab', tab)");
    expect(mobileScript).not.toMatch(/selectTab[\s\S]{0,300}(connect\(|location\.reload)/);
    expect(mobileIndex).toContain('+ Ajouter');
  });
  it('propose les trois périodes d’export et une note éditoriale persistante', () => {
    for (const period of ['today', 'this-week', 'next-week']) expect(mobileIndex).toContain(`value="${period}"`);
    expect(mobileIndex).toContain('id="export-note-enabled"');
    expect(mobileIndex).toContain('id="export-note-text"');
    expect(mobileScript).toContain('streamdashboard.exportNote');
  });
  it('branche l’événement sur un sélecteur Twitch officiel debounced et anti-réponse obsolète', () => {
    expect(mobileIndex).toContain('id="slot-twitch-category"');
    expect(mobileIndex).toContain('id="slot-twitch-game-id"');
    expect(mobileScript).toContain('query.length<2');
    expect(mobileScript).toContain('request!==generation');
    expect(mobileScript).toContain("attachCategoryPicker('slot-twitch-category','slot-twitch-game-id','slot-twitch-results')");
    expect(mobileScript).toContain('Sélectionnez une catégorie Twitch officielle.');
  });
  it('intègre les templates directement au formulaire Planning sans masquer la périodicité', () => {
    expect(mobileIndex).toContain('id="event-template"');
    expect(mobileIndex).toContain('name="recurrence"');
    expect(mobileIndex).toContain('name="recurrenceUntil"');
    expect(templatesFeature).toContain('applyTemplate(template');
    expect(templatesFeature).toContain('La périodicité reste libre');
    expect(templatesFeature).toContain('CRÉER UN ÉVÉNEMENT');
  });
  it('répare le démarrage live Android avec préparation et confirmation de bypass checklist', () => {
    expect(mobileScript).toContain("command({ type: 'session.prepare' })");
    expect(mobileScript).toContain("command({ type: 'session.start', force: requiresBypass }");
    expect(mobileScript).toContain('Démarrer quand même ?');
    expect(templatesFeature).not.toContain("$('stream').onclick");
    expect(remotePolicy).toContain("force: command.force === true");
    expect(remotePolicy).not.toContain('Le contournement de checklist est réservé au PC.');
  });
  it('partage uniquement un PNG du cache privé avec FileProvider', () => {
    expect(androidManifest).toContain('androidx.core.content.FileProvider');
    expect(androidManifest).toContain('${applicationId}.fileprovider');
    expect(androidFilePaths).toContain('<cache-path name="shared_planning" path="shared/" />');
    expect(androidFilePaths).not.toContain('external-path');
    expect(androidActivity).toContain('@JavascriptInterface public String shareImage');
    expect(androidActivity).toContain('Intent.FLAG_GRANT_READ_URI_PERMISSION');
    expect(androidActivity).toContain('"image/png".equals(mimeType)');
    for (const permission of ['READ_MEDIA_IMAGES', 'READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE', 'MANAGE_EXTERNAL_STORAGE']) expect(androidManifest).not.toContain(permission);
  });
  it('durcit la WebView Android et conserve les dialogues JavaScript', () => {
    expect(androidActivity).toContain('MIXED_CONTENT_NEVER_ALLOW');
    expect(androidActivity).toContain('WebViewAssetLoader');
    expect(androidActivity).not.toContain('MIXED_CONTENT_ALWAYS_ALLOW');
    expect(androidActivity).toContain('import android.webkit.WebChromeClient;');
    expect(androidActivity).toContain('webView.setWebChromeClient(new WebChromeClient());');
  });
  it.each([
    ['192.168.1.10', 'http://192.168.1.10:47832'],
    ['192.168.1.10:47832', 'http://192.168.1.10:47832'],
    ['http://192.168.1.10:47832/', 'http://192.168.1.10:47832'],
  ])('normalizes %s', (input, expected) => expect(normalizeServer(input)).toBe(expected));

  it.each(['https://example.com', 'http://8.8.8.8', 'ftp://192.168.1.2', 'http://user:pass@192.168.1.2'])('rejects unsafe server %s', input => {
    expect(() => normalizeServer(input)).toThrow();
  });

  it('parses a versioned pairing link', () => {
    expect(parsePairing('streamdashboard://pair?v=1&server=http%3A%2F%2F192.168.1.2%3A47832&id=abc&code=123456')).toEqual({
      server: 'http://192.168.1.2:47832', id: 'abc', code: '123456',
    });
  });

  it.each([
    'https://pair?v=1&server=192.168.1.2&id=x&code=y',
    'streamdashboard://pair?v=2&server=192.168.1.2&id=x&code=y',
    'streamdashboard://pair?v=1&server=192.168.1.2&code=y',
    'streamdashboard://pair?v=1&server=192.168.1.2&id=x',
  ])('rejects malformed pairing payload %s', value => expect(() => parsePairing(value)).toThrow());

  it('builds REST and one-use-ticket websocket URLs without a credential', () => {
    expect(apiUrl('http://192.168.1.2:47832/', '/api/v1/state')).toBe('http://192.168.1.2:47832/api/v1/state');
    expect(websocketUrl('http://192.168.1.2:47832', 'short-ticket')).toBe('ws://192.168.1.2:47832/ws/v1?ticket=short-ticket');
    expect(websocketUrl('https://localhost:47832', 'ticket').startsWith('wss://')).toBe(true);
    expect(websocketUrl('http://192.168.1.2:47832', 'ticket')).not.toContain('credential');
  });

  it('affiche et acquitte les Streamer Pings Twitch sur Android', () => {
    expect(mobileScript).toContain('streamer-ping-dialog');
    expect(mobileScript).toContain('syncMobileStreamerPing(next.streamerPings || [])');
    expect(mobileScript).toContain("haptic?.('strong')");
    expect(mobileScript).toContain('transport.acknowledgeStreamerPing(id)');
  });

  it('notifie les Streamer Pings quand l’application Android passe en arrière-plan', () => {
    expect(androidManifest).toContain('android.permission.POST_NOTIFICATIONS');
    expect(androidActivity).toContain('NotificationChannel');
    expect(androidActivity).toContain('@JavascriptInterface public void notifyStreamerPing');
    expect(androidActivity).toContain('PING_CHANNEL_ID');
    expect(mobileScript).toContain('notifyMobileStreamerPing');
    expect(mobileScript).toContain('document.hidden');
    expect(mobileScript).toContain('notifyStreamerPing?.(');
  });

  it('édite les automatisations avec le vocabulaire Runtime actuel', () => {
    for (const trigger of ['support.received','twitch.reward.redeemed','streamer.ping.received','stream.started','stream.stopped','obs.state.changed','chat.message.received']) expect(mobileIndex).toContain(`value="${trigger}"`);
    expect(mobileIndex).not.toContain('twitch.raid');
    expect(mobileIndex).toContain('id="automation-conditions"');
    expect(mobileIndex).toContain('id="automation-actions"');
    expect(mobileScript).toContain('transport.automationCapabilities()');
    expect(mobileScript).toContain("'obs.scene':'Changer de scène'");
    expect(mobileScript).toContain("'timer.add':'Ajouter au timer'");
  });

  it('bounds reconnect backoff at ten seconds', () => {
    expect(nextRetry(500)).toBe(1000);
    expect(nextRetry(8000)).toBe(10000);
    expect(nextRetry(10000)).toBe(10000);
  });
});
