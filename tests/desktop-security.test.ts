import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isAllowedTwitchUrl } from '../apps/desktop/src/security.js';
const windowSource = readFileSync(new URL('../apps/desktop/src/window.ts', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../apps/desktop/src/main.ts', import.meta.url), 'utf8');
const html = readFileSync(new URL('../apps/web/index.html', import.meta.url), 'utf8');
const renderer = readFileSync(new URL('../apps/web/app.js', import.meta.url), 'utf8');
describe('sécurité hôte Electron', () => {
  it('active toutes les protections BrowserWindow', () => {
    expect(windowSource).toContain('nodeIntegration: false'); expect(windowSource).toContain('contextIsolation: true');
    expect(windowSource).toContain('sandbox: true'); expect(windowSource).toContain('webSecurity: true'); expect(html).toContain('Content-Security-Policy');
    expect(html).toContain("script-src 'self'"); expect(renderer).not.toContain('onclick="');
  });
  it('n’autorise que les URL HTTPS Twitch externes', () => {
    expect(isAllowedTwitchUrl('https://www.twitch.tv/activate')).toBe(true);
    expect(isAllowedTwitchUrl('http://www.twitch.tv/activate')).toBe(false);
    expect(isAllowedTwitchUrl('https://twitch.tv.evil.example/')).toBe(false);
    expect(isAllowedTwitchUrl('file:///C:/Windows/System32')).toBe(false);
  });
  it('prend un verrou d’instance unique', () => { expect(mainSource).toContain('requestSingleInstanceLock'); expect(mainSource).toContain("app.on('second-instance'"); });
});
