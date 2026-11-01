import { expect, it } from 'vitest';
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

/** Opt-in real Edge/Chromium on FIXE. No remote API, secrets or OBS operations. */
it.skipIf(process.env.MOMENTS_BROWSER_TEST !== '1')('F09 Plus timeline is readable at 320px and drops private markers on disconnect', async () => {
  const output = await build({
    stdin: {
      contents: "import {mountMomentsPage} from './apps/mobile/control/streamcockpit-moments-page.js';globalThis.mountMomentsPage=mountMomentsPage;",
      resolveDir: process.cwd(),
    },
    bundle: true, write: false, format: 'iife', platform: 'browser',
  });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 320, height: 720 }, hasTouch: true });
    const external: string[] = [];
    await page.route('**/*', route => {
      external.push(route.request().url());
      return route.abort();
    });
    await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><main id="root" class="compact-app" style="width:100%;min-width:0"></main>');
    await page.addStyleTag({content:readFileSync('apps/mobile/control/streamcockpit-mobile-v2.css','utf8')});
    await page.addScriptTag({ content: output.outputFiles[0].text });
    await page.evaluate(() => {
      const w = window as any;
      w.calls = [];
      w.presenter = w.mountMomentsPage(document.getElementById('root'), {
        online: true,
        request: async (path: string) => {
          w.calls.push(path);
          if (path === '/api/v1/streamcockpit-moments') return {
            schemaVersion: 1, kind: 'streamcockpit-moment-sessions', readOnly: true,
            sessions: [{ sessionId: 'sess_1', markerCount: 1, lastMarkerAt: 1762010000000 }],
          };
          return {
            schemaVersion: 1, kind: 'streamcockpit-markers', timebase: 'unix-ms', readOnly: true,
            sessionId: 'sess_1', markers: [{
              sessionId: 'sess_1', instant: 1762010000000, sequence: 1,
              source: 'obs', status: 'observed',
              title: '<img src="https://attacker.invalid/tracker" onerror="alert(1)"> Marker réel',
            }],
          };
        },
      });
    });
    expect(await page.evaluate(() => (window as any).calls.length)).toBe(0);
    await page.getByRole('button', { name: 'Lister les sessions enregistrées sur le fixe' }).click();
    await expect.poll(() => page.getByLabel('Choisir une session réellement enregistrée').isVisible()).toBe(true);
    await page.getByLabel('Choisir une session réellement enregistrée').selectOption('sess_1');
    expect(await page.locator('input[aria-label="Identifiant exact de session"]').inputValue()).toBe('sess_1');
    expect(await page.evaluate(() => (window as any).calls)).toEqual(['/api/v1/streamcockpit-moments']);
    await page.getByRole('button', { name: 'Consulter' }).click();
    await expect.poll(() => page.locator('section[aria-label="Moments marquants"] li').count()).toBe(1);
    expect(await page.locator('section[aria-label="Moments marquants"] li').textContent()).toContain('<img src=');
    expect(await page.locator('img').count()).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= 320)).toBe(true);
    expect(await page.evaluate(() => (window as any).calls)).toEqual([
      '/api/v1/streamcockpit-moments', '/api/v1/streamcockpit-moments/sess_1',
    ]);
    expect(await page.locator('.cockpit-moments-summary').textContent()).toContain('durée du live inconnue');
    await page.getByLabel('Filtrer par source').selectOption('twitch');
    expect(await page.locator('section[aria-label="Moments marquants"] li').count()).toBe(0);
    expect(await page.locator('section[aria-label="Moments marquants"] [role="status"]').textContent()).toContain('0 sur 1');
    await page.getByLabel('Filtrer par source').selectOption('obs');
    expect(await page.locator('section[aria-label="Moments marquants"] li').count()).toBe(1);
    expect(await page.evaluate(() => (window as any).calls)).toHaveLength(2); // Filters never refetch.
    await page.evaluate(() => {
      const w = window as any;
      w.exported = [];
      w.StreamDashboardNative = { shareDocument: async (json: string, name: string) => {
        w.exported.push({ name, report: JSON.parse(json) });
      } };
    });
    await page.getByRole('button', { name: 'Exporter le bilan complet (JSON)' }).click();
    await expect.poll(() => page.evaluate(() => (window as any).exported.length)).toBe(1);
    expect(await page.evaluate(() => (window as any).exported[0])).toMatchObject({
      name: 'StreamCockpit-bilan-sess_1.json',
      report: { kind: 'streamcockpit-moments-report', sessionId: 'sess_1',
        markerCount: 1, liveDurationKnown: false, bySource: { obs: 1 },
        markers: [{ source: 'obs', status: 'observed' }] },
    });
    expect(await page.evaluate(() => (window as any).calls)).toHaveLength(2); // Export never refetches.
    await page.evaluate(() => (window as any).presenter.unavailable());
    expect(await page.locator('section[aria-label="Moments marquants"]').count()).toBe(0);
    expect(await page.locator('main').textContent()).not.toContain('Marker réel');
    expect(await page.getByRole('button', { name: 'Consulter' }).isDisabled()).toBe(true);
    expect(await page.getByRole('button', { name: 'Lister les sessions enregistrées sur le fixe' }).isDisabled()).toBe(true);
    expect(external).toEqual([]);
  } finally { await browser.close(); }
}, 30000);
