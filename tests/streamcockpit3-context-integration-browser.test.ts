import { expect, it } from 'vitest';
import { chromium } from '@playwright/test';
import { renderContextPreview } from '../apps/mobile/control/streamcockpit-context-preview.js';

// Opt in where Chromium is permitted. No HTTP server or production endpoint.
it.skipIf(process.env.CONTEXT_BROWSER_TEST !== '1')('preview at 320px: touch disclosure, XSS, offline/reconnect and zero requests', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: {width: 320, height: 640}, hasTouch: true });
    const requests: string[] = [];
    await page.route('**/*', route => { requests.push(route.request().url()); return route.abort(); });
    for (const online of [true, false, true]) {
      await page.setContent(renderContextPreview({online, server: 'paired', actions: [
        {label: '<img src="https://invalid.example/x" onerror="alert(1)">' + 'X'.repeat(300)},
      ]}));
      await page.locator('summary').tap();
      await expect.poll(() => page.locator('details').getAttribute('open')).not.toBeNull();
      expect(await page.locator('button, [data-action], [data-command], img').count()).toBe(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= 320)).toBe(true);
      expect(await page.locator('[data-context-preview]').textContent()).toContain('UNKNOWN');
    }
    expect(requests).toEqual([]);
  } finally { await browser.close(); }
});
