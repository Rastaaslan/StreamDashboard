import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os'; import path from 'node:path';

test('Desktop Preview navigue et émet une commande unique par contrôle', async () => {
  const profile=await mkdtemp(path.join(os.tmpdir(),'streamdashboard-preview-'));
  const app=await electron.launch({args:[path.resolve('.'),'--ui-preview=desktop-v2'],env:{...process.env,NODE_ENV:'test',APPDATA:profile,XDG_CONFIG_HOME:profile}});
  try { const page=await app.firstWindow(); await expect(page).toHaveTitle('StreamDashboard Desktop Preview');
    for(const [view,label] of [['home','Accueil'],['live','Live'],['sounds','Sons'],['planning','Planning'],['camp','Le Camp']]){await page.locator(`[data-view="${view}"]`).click();await expect(page.locator('#title')).toHaveText(label)}
    await page.locator('[data-view="live"]').click();
    for(const scene of ['Intro','Gameplay','Chatting','Pause','Fin']){const before=await page.evaluate(()=>(window as any).__preview.commandLog.length);await page.locator(`[data-scene="${scene}"]`).click();expect(await page.evaluate(()=>(window as any).__preview.commandLog.length)).toBe(before+1)}
    const before=await page.evaluate(()=>(window as any).__preview.commandLog.length);await page.locator('[data-view="sounds"]').click();await page.locator('[data-sound="bonk"]').click();
    expect(await page.evaluate(()=>(window as any).__preview.commandLog.slice(-1)[0])).toMatchObject({type:'soundboard.play',payload:{soundId:'bonk'}});expect(await page.evaluate(()=>(window as any).__preview.commandLog.length)).toBe(before+1);
    await page.locator('[data-add-sound]').first().click(); await expect(page.locator('#sound-dialog')).toBeVisible(); await page.locator('[data-close-dialog="sound-dialog"]').click();
    await page.locator('[data-view="sounds"]').click(); await page.locator('[data-obs-setup]').click(); await expect(page.locator('#obs-setup-dialog')).toContainText('StreamDashboard • Soundboard'); await page.locator('[data-close-dialog="obs-setup-dialog"]').click();

    await page.locator('[data-view="camp"]').click(); await page.locator('[data-camp="Connexions"]').click();
    for (const service of ['OBS','Twitch','Google Calendar','Discord','Streamlabs','WizeBot','Android']) await expect(page.locator('#camp-copy')).toContainText(service);
    await expect(page.locator('[data-connection-action="obs-test"]')).toBeDisabled();

    let testedObs = false;
    await page.route('**/api/v1/obs/test', async route => {
      testedObs = true;
      expect(route.request().postDataJSON()).toMatchObject({ obsUrl: 'ws://127.0.0.1:4455' });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, obsVersion: '31.0.0' }) });
    });
    await page.locator('#mode').click(); await expect(page.locator('#runtime-status')).toHaveText('Runtime PC');
    await page.locator('[data-view="camp"]').click(); await page.locator('[data-camp="Connexions"]').click();
    await expect(page.locator('[data-connection-action="obs-test"]')).toBeEnabled();
    await page.locator('[data-connection-action="obs-test"]').click();
    await expect(page.locator('#toast')).toContainText('OBS connecté · v31.0.0');
    expect(testedObs).toBe(true);

    // Runtime sections in Le Camp are no longer placeholders.
    await page.locator('[data-camp="Préparation"]').click();
    await expect(page.locator('#camp-copy')).toContainText('Checklist avant direct');
    await page.locator('#camp-check-add input[name="label"]').fill('Test checklist Desktop');
    await page.locator('#camp-check-add').getByRole('button', { name: 'Ajouter' }).click();
    await expect(page.locator('#camp-copy')).toContainText('Test checklist Desktop');

    await page.locator('[data-camp="Notes"]').click();
    await page.locator('#camp-note-add textarea[name="text"]').fill('Note partagée Desktop');
    await page.locator('#camp-note-add').getByRole('button', { name: 'Ajouter la note' }).click();
    await expect(page.locator('#camp-copy')).toContainText('Note partagée Desktop');

    await page.locator('[data-camp="Templates"]').click();
    await page.locator('#camp-template-form input[name="title"]').fill('Template smoke');
    await page.locator('#camp-template-form').getByRole('button', { name: 'Enregistrer le template' }).click();
    await expect(page.locator('#camp-copy')).toContainText('Template smoke');

    await page.locator('[data-camp="Automatisations"]').click();
    await expect(page.locator('#camp-automation-form')).toBeVisible();
    await page.locator('#camp-automation-form input[name="name"]').fill('Timer smoke');
    await page.locator('#camp-automation-form select[name="trigger"]').selectOption('test.support');
    await page.locator('[data-action-type]').first().selectOption('timer.add');
    await page.locator('[data-action-param="seconds"]').fill('30');
    await page.locator('#camp-automation-form').getByRole('button', { name: 'Enregistrer l’automatisation' }).click();
    await expect(page.locator('#camp-copy')).toContainText('Timer smoke');

    // Planning uses the real CRUD route in Runtime.
    await page.locator('[data-view="planning"]').click();
    await page.locator('[data-add-event]').click();
    await page.locator('#event-title').fill('Planning smoke');
    await page.locator('#event-publish-twitch').uncheck();
    await page.locator('#event-publish-google').uncheck();
    await page.locator('#event-form').getByRole('button', { name: 'Ajouter' }).click();
    await expect(page.locator('#view')).toContainText('Planning smoke');

  } finally {await app.close();await rm(profile,{recursive:true,force:true})}
});
