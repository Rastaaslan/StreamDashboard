import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { startDashboardServer } from '../dist/apps/server/src/index.js';

for (const surface of ['planning', 'legacy', 'sounds']) for (const reopen of [false, true]) {
  test(`${surface}: delayed creation ${reopen ? 'never adopts into a reopened session' : 'adopts identity while preserving later typing'}`, async () => {
    const folder = await mkdtemp(join(tmpdir(), 'creation-draft-'));
    let server, browser;
    try {
      server = await startDashboardServer({port:0,dataDir:folder,logger:{info(){},warn(){},error(){}}});
      await writeFile(join(folder,'soundboard','test.wav'), Buffer.from('test audio fixture'));
      browser = await chromium.launch({headless:true,args:['--no-sandbox']});
      const page = await browser.newPage();
      const errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.addInitScript(()=>{window.streamDashboardDesktop={selectSoundFile:async()=>'/test.wav',importSoundFile:async()=>({libraryId:'test.wav'})};});
      const sound=surface==='sounds',legacy=surface==='legacy';
      await page.goto(server.url+(legacy?'/':'/preview/?runtime=1'));
      if(legacy){await page.locator('#onboarding [data-onboarding=later]').click();await expect(page.locator('#onboarding')).not.toBeVisible();await page.evaluate(()=>window.go('planning'));}
      else {await expect(page.locator('#runtime-status')).toHaveText('Runtime PC');await page.locator(`[data-view=${sound?'sounds':'planning'}]`).click();}
      const dialog=page.locator(sound?'#sound-dialog':'#event-dialog');
      const title=page.locator(sound?'#sound-name':legacy?'#event-form [name=title]':'#event-title');
      const submit=page.locator(sound?'#sound-form [type=submit]':legacy?'#event-form [type=submit]':'#event-submit');
      const date=new Date(Date.now()+86400000).toISOString().slice(0,10);
      const open=async()=>{
        await page.locator(sound?'[data-add-sound]':legacy?'[data-action=open-event]':'[data-add-event]').click();
        if(sound){await page.locator('#sound-file-button').click();await expect(page.locator('#sound-file-copy')).toHaveText('test.wav');await page.locator('#sound-category').fill('FX');}
        else if(legacy){await page.locator('#event-form [name=start]').fill(`${date}T20:00`);await page.locator('#event-form [name=end]').fill(`${date}T21:00`);}
        else {await page.locator('#event-date').fill(date);await page.locator('#event-start').fill('20:00');await page.locator('#event-end').fill('21:00');}
      };
      const path=sound?'/api/v1/soundboard/sounds':'/api/v1/planning';
      const pending=[];
      await page.route('**/api/v1/**',route=>{
        const request=route.request(),url=new URL(request.url());
        if((url.pathname===path||url.pathname.startsWith(path+'/'))&&['POST','PUT'].includes(request.method()))pending.push(route);
        else return route.continue();
      });
      const resolve=async route=>{const response=await route.fetch();assert.equal(response.ok(),true,await response.text());const data=await response.json();await route.fulfill({response});return data;};
      await open();await title.fill('Submitted');await submit.click();
      await expect.poll(()=>pending.length).toBe(1);
      if(reopen){await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();await open();}
      else {await submit.click();assert.equal(pending.length,1);}
      await title.fill('New draft');await title.focus();await title.evaluate(el=>el.setSelectionRange(4,4));
      const original=await title.elementHandle();
      const created=await resolve(pending[0]);
      const createdId=created.createdItemId;assert.equal(typeof createdId,'string');
      await expect(page.locator('#toast')).toContainText(sound?'Soundboard enregistrée':legacy?'Planning enregistré':'Événement enregistré');
      await expect(dialog).toBeVisible();await expect(title).toHaveValue('New draft');await expect(title).toBeFocused();
      assert.deepEqual(await title.evaluate(el=>[el.selectionStart,el.selectionEnd]),[4,4]);assert.equal(await original.evaluate(el=>el.isConnected),true);
      await page.keyboard.insertText('continued ');await submit.click();
      await expect.poll(()=>pending.length).toBe(2);
      assert.equal(pending[1].request().method(),reopen?'POST':'PUT');
      assert.equal(new URL(pending[1].request().url()).pathname,reopen?path:`${path}/${createdId}`);
      const saved=await resolve(pending[1]);
      await expect(dialog).not.toBeVisible();
      const items=sound?saved.sounds:saved.planning;
      assert.equal(items.length,reopen?2:1);
      const targetId=reopen?saved.createdItemId:createdId;
      assert.equal(items.find(item=>item.id===targetId)[sound?'name':'title'],'New continued draft');
      if(sound)await page.locator(`[data-edit-sound="${targetId}"]`).click();
      else if(legacy)await page.locator(`[data-action=edit-event][data-value="${targetId}"]`).click();
      else await page.locator('[data-event-index]').filter({has:page.getByText('New continued draft',{exact:true})}).click();
      await expect(title).toHaveValue('New continued draft');
      assert.deepEqual(errors,[]);
    } finally {await browser?.close();await server?.stop();await rm(folder,{recursive:true,force:true});}
  });
}
