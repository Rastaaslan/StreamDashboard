import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { apiUrl, nextRetry, normalizeServer, parsePairing, websocketUrl } from '../apps/mobile/runtime.js';

const mobileIndex = readFileSync(new URL('../apps/mobile/index.html', import.meta.url), 'utf8');
const mobileScript = readFileSync(new URL('../apps/mobile/mobile.js', import.meta.url), 'utf8');
const remotePolicy = readFileSync(new URL('../apps/server/src/remote-policy.ts', import.meta.url), 'utf8');

describe('Android remote runtime', () => {
  it('expose Pause avec les quatre modes et conserve le flux mode.set partagé', () => {
    for (const mode of ['intro', 'live', 'pause', 'end']) expect(mobileIndex).toContain(`data-mode="${mode}"`);
    expect(mobileScript).toContain("command({ type: 'mode.set', mode: button.dataset.mode })");
    expect(mobileScript).toContain("button.dataset.mode === next.mode && !(button.dataset.mode === 'live' && chattingActive)");
    expect(remotePolicy).toContain("new Set(['intro', 'live', 'pause', 'end'])");
  });
  it('expose le preset Chatting sans créer de RunMode ni accepter une scène arbitraire', () => {
    expect(mobileIndex).toContain('<button data-chatting>CHATTING</button>');
    expect(mobileScript).toContain("command({ type: 'scene.chatting' })");
    expect(mobileScript).toContain("next.mode === 'live'");
    expect(mobileScript).toContain("next.obs.scene === next.settings.chattingScene");
    expect(remotePolicy).toContain("case 'scene.chatting'");
    expect(remotePolicy).not.toContain("case 'obs.scene'");
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

  it('bounds reconnect backoff at ten seconds', () => {
    expect(nextRetry(500)).toBe(1000);
    expect(nextRetry(8000)).toBe(10000);
    expect(nextRetry(10000)).toBe(10000);
  });
});
