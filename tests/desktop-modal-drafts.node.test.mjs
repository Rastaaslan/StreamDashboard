import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { startDashboardServer } from '../dist/apps/server/src/index.js';

test('Desktop dialog drafts survive character typing, refresh, IME and explicit reopen', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'modal-drafts-'));
  let server, browser;
  try {
    server = await startDashboardServer({ port: 0, dataDir: folder, logger: { info() {}, warn() {}, error() {} } });
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const refresh = async () => {
      await page.evaluate(async () => {
        const response = await fetch('/api/v1/settings', { method: 'PUT', headers: {'content-type':'application/json'}, body: JSON.stringify({streamerName: `Server ${Date.now()}`}) });
        if (!response.ok) throw new Error(await response.text());
      });
      await page.waitForTimeout(60);
    };
    const typeThroughRefresh = async (field, text) => {
      await field.fill(''); await field.focus();
      const original = await field.elementHandle();
      for (const char of text) {
        await page.keyboard.insertText(char);
        const caret = await field.evaluate(el => [el.selectionStart, el.selectionEnd]);
        await refresh();
        await expect(field).toBeFocused();
        assert.deepEqual(await field.evaluate(el => [el.selectionStart, el.selectionEnd]), caret);
        assert.equal(await original.evaluate(el => el.isConnected), true);
      }
      await expect(field).toHaveValue(text);
      await page.keyboard.press('Alt+1'); await expect(field).toBeFocused();
    };
    await page.goto(server.url + '/');
    await page.locator('#onboarding [type=submit]').click();
    await typeThroughRefresh(page.locator('#onboarding [name=displayName]'), 'Élodie');
    await page.locator('#onboarding [type=submit]').click();
    await page.locator('#onboarding [data-onboarding=previous]').click();
    await expect(page.locator('#onboarding [name=displayName]')).toHaveValue('Élodie');
    await page.locator('#onboarding [data-onboarding=later]').click();
    await page.evaluate(() => window.go('planning'));
    await page.locator('[data-action=open-event]').click();
    await typeThroughRefresh(page.locator('#event-form [name=title]'), 'Legacy draft');
    await page.keyboard.press('Escape');
    await page.locator('[data-action=open-event]').click();
    await expect(page.locator('#event-form [name=title]')).toHaveValue('');
    await page.keyboard.press('Escape');

    let sounds = [{id:'sound-test',name:'Canonique',category:'FX',volume:1,enabled:true,sourceAvailable:true}];
    await page.route('**/api/v1/soundboard', route => route.fulfill({json:{sounds}}));
    await page.route('**/api/v1/soundboard/sounds/sound-test', route => {
      sounds = [{...sounds[0],...route.request().postDataJSON()}];
      return route.fulfill({json:{sounds}});
    });
    await page.goto(server.url + '/preview/?runtime=1');
    await expect(page.locator('#runtime-status')).toHaveText('Runtime PC');
    await page.locator('[data-view=sounds]').click();
    await page.locator('[data-add-sound]').click();
    await typeThroughRefresh(page.locator('#sound-name'), 'Son été');
    await page.locator('#sound-name').dispatchEvent('compositionstart');
    await refresh();
    await page.keyboard.press('Escape');
    await expect(page.locator('#sound-dialog')).toBeVisible();
    await page.locator('#sound-name').dispatchEvent('compositionend');
    await page.keyboard.press('Escape');
    await page.locator('[data-add-sound]').click();
    await expect(page.locator('#sound-name')).toHaveValue('');
    await page.keyboard.press('Escape');
    await page.locator('[data-edit-sound=sound-test]').click();
    await typeThroughRefresh(page.locator('#sound-name'), 'Son enregistré');
    await page.locator('#sound-monitoring').selectOption('monitor');
    await refresh();
    await expect(page.locator('#sound-monitoring')).toHaveValue('monitor');
    await page.locator('#sound-form [type=submit]').click();
    await expect(page.locator('#sound-dialog')).not.toBeVisible();
    assert.equal(sounds[0].name, 'Son enregistré');
    await page.locator('[data-edit-sound=sound-test]').click();
    await expect(page.locator('#sound-name')).toHaveValue('Son enregistré');
    await page.keyboard.press('Escape');
    await page.locator('[data-view=planning]').click();
    await page.getByRole('button', {name:'Supprimer une période',exact:true}).click();
    const bulk = page.locator('dialog[data-bulk-delete]');
    await bulk.locator('[name=start]').fill('2030-10-01T12:34');
    await bulk.locator('[name=start]').focus();
    for (let n=0;n<3;n++) { await refresh(); await expect(bulk.locator('[name=start]')).toBeFocused(); }
    await expect(bulk.locator('[name=start]')).toHaveValue('2030-10-01T12:34');
    await page.keyboard.press('Alt+1');
    await expect(page.locator('#title')).toHaveText('Planning');
    await page.keyboard.press('Escape');
    await page.getByRole('button', {name:'Supprimer une période',exact:true}).click();
    await expect(bulk.locator('[name=start]')).toHaveValue('');
    await page.keyboard.press('Escape');
    await page.locator('[data-add-event]').click();
    await typeThroughRefresh(page.locator('#event-tags'), 'Français');
    let pending;
    await page.route('**/api/v1/planning/tags/regenerate', route => { pending=route; });
    await page.locator('#event-tags-regenerate').click();
    await expect.poll(() => Boolean(pending)).toBe(true);
    // Editing back to the original value still invalidates the async result.
    await page.locator('#event-tags').fill('Autre');
    await page.locator('#event-tags').fill('Français');
    await pending.fulfill({json:{tags:{values:['Overwrite'],source:'generated'}}});
    await expect(page.locator('#event-tags-regenerate')).toBeEnabled();
    await expect(page.locator('#event-tags')).toHaveValue('Français');
    // Late category results must not replace a newer query's choices.
    const categories = [];
    await page.route('**/api/v1/twitch/categories?*', route => { categories.push(route); });
    await page.locator('#event-twitch-category').fill('Old');
    await expect.poll(() => categories.length).toBe(1);
    await page.locator('#event-twitch-category').fill('New');
    await expect.poll(() => categories.length).toBe(2);
    await categories[1].fulfill({json:[{id:'new',name:'New category'}]});
    await expect(page.locator('#event-twitch-results')).toContainText('New category');
    await categories[0].fulfill({json:[{id:'old',name:'Old category'}]});
    await expect(page.locator('#event-twitch-results')).not.toContainText('Old category');
    await expect(page.locator('#event-twitch-category')).toHaveValue('New');
    await expect(page.locator('#event-twitch-category')).toBeFocused();
    await page.keyboard.press('Escape');
    // Contenteditable descendants are also excluded from global shortcuts.
    await page.evaluate(() => {
      const editor = document.createElement('div'); editor.contentEditable='true';
      editor.id='test-editor'; editor.innerHTML='<span>Text</span>'; document.body.append(editor); editor.focus();
    });
    await page.keyboard.press('Alt+1');
    await expect(page.locator('#title')).toHaveText('Planning');
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close(); await server?.stop(); await rm(folder,{recursive:true,force:true});
  }
});
