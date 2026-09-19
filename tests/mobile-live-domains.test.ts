import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../apps/mobile/index.html', import.meta.url), 'utf8');
const mobile = readFileSync(new URL('../apps/mobile/mobile.js', import.meta.url), 'utf8');

describe('Android Live domains', () => {
  it('expose Soundboard, Supports, Automations et Diagnostics', () => { for (const panel of ['supports', 'automations']) expect(html).toContain(`data-hub-panel="${panel}"`); expect(html).toContain('data-view="sounds"'); expect(html).toContain('Diagnostics développeur · Events'); });
  it('attend l’ACK runtime avant le succès soundboard et gère PC offline', () => { const ack = mobile.indexOf('await transport.playSound'); const success = mobile.indexOf('Lecture confirmée par le PC'); expect(ack).toBeGreaterThan(0); expect(success).toBeGreaterThan(ack); expect(mobile).toContain('PC hors ligne. Le son n’a pas été joué.'); });
  it('offre les opérations CRUD Automation et les agrégats Support', () => { expect(mobile).toContain('transport.createAutomation'); expect(mobile).toContain('transport.updateAutomation'); expect(mobile).toContain('transport.deleteAutomation'); for (const value of ['session', 'day', 'month']) expect(mobile).toContain(`['${value}'`); });
});
