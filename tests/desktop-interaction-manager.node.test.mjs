import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { startDashboardServer } from '../dist/apps/server/src/index.js';

test('Desktop interaction layer: 20 save/reopen cycles, queued close, modal exclusion and refresh', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'interaction-manager-'));
  let server, browser;
  try {
    server = await startDashboardServer({port:0,dataDir:folder,logger:{info(){},warn(){},error(){}}});
    browser = await chromium.launch({headless:true,args:['--no-sandbox']});
    const page = await browser.newPage();
    const errors=[]; page.on('pageerror', error=>errors.push(error.message));
    await page.goto(server.url+'/preview/?runtime=1');
    await expect(page.locator('#runtime-status')).toHaveText('Runtime PC');
    await page.locator('[data-view=planning]').click();
    const add=page.locator('[data-add-event]').first();
    const dialog=page.locator('#event-dialog'), title=page.locator('#event-title');
    await add.click();
    // A native close queues its event. Reopen within the same task, just as a
    // quick explicit opening / onboarding transition can do.
    await page.evaluate(async()=>{
      const {beginDialogDraft}=await import('/dialog-drafts.js');
      const d=document.querySelector('#event-dialog');d.close();beginDialogDraft(d);d.showModal();
    });
    await page.waitForTimeout(50);
    assert.equal(await page.evaluate(async()=>!!(await import('/dialog-drafts.js')).dialogCreation(document.querySelector('#event-dialog'))),true);
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    let writes=0, fail=true;
    await page.route('**/api/v1/planning',async route=>{
      if(route.request().method()!=='POST')return route.continue();
      writes++;
      if(fail){fail=false;return route.fulfill({status:500,json:{error:{message:'Test retry'}}});}
      return route.continue();
    });
    for(let cycle=0;cycle<20;cycle++){
      await add.click();
      await title.fill(`Interaction ${cycle}`);
      await page.locator('#event-category').selectOption('personal');
      await title.focus();
      await title.evaluate(el=>el.setSelectionRange(3,3));
      const node=await title.elementHandle();
      await page.evaluate(async()=>{
        const response=await fetch('/api/v1/settings',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({streamerName:`Refresh ${Date.now()}`})});
        if(!response.ok)throw new Error('Refresh failed');
      });
      await page.waitForTimeout(60);
      await expect(title).toBeFocused();
      assert.deepEqual(await title.evaluate(el=>[el.selectionStart,el.selectionEnd]),[3,3]);
      await page.keyboard.insertText('X');
      await expect(title).toHaveValue(`IntXeraction ${cycle}`);
      assert.equal(await node.evaluate(el=>el.isConnected),true);
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(()=>document.querySelector('#event-dialog').contains(document.activeElement)),true);
      await page.locator('#event-submit').click();
      if(cycle===0){await expect(page.locator('#toast')).toContainText('Test retry');await expect(dialog).toBeVisible();await page.locator('#event-submit').click();}
      await expect(dialog).not.toBeVisible();
      await add.click();await title.fill('discard');await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();
      const diagnostics=await page.evaluate(async()=>(await import('/dialog-drafts.js')).dialogDiagnostics());
      assert.deepEqual(diagnostics,{openCount:0,modalCount:0,orphanModal:false,lostFocus:false,staleSession:false});
    }
    assert.equal(writes,21);
    await add.click();
    await page.evaluate(async()=>{const {openBulkDelete}=await import('/planning-bulk-delete.js');openBulkDelete();});
    await expect(dialog).not.toBeVisible();
    await expect(page.locator('dialog[open]')).toHaveCount(1);
    await page.locator('[data-bulk-delete] [data-close]').click();
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await add.click();await title.fill('clicks restored');await page.keyboard.press('Escape');
    let sound={id:'stress-sound',name:'Original',category:'FX',volume:1,enabled:true,sourceAvailable:true}, soundWrites=0;
    await page.route('**/api/v1/soundboard',route=>route.fulfill({json:{sounds:[sound]}}));
    await page.route('**/api/v1/soundboard/sounds/stress-sound',async route=>{
      soundWrites++;
      await new Promise(resolve=>setTimeout(resolve,100));
      sound={...sound,...route.request().postDataJSON()};
      await route.fulfill({json:{sounds:[sound]}});
    });
    await page.reload();await expect(page.locator('#runtime-status')).toHaveText('Runtime PC');
    await page.locator('[data-view=sounds]').click();
    for(let cycle=0;cycle<20;cycle++){
      await page.locator('[data-edit-sound=stress-sound]').click();
      await page.locator('#sound-name').fill(`Sound ${cycle}`);
      await page.locator('#sound-monitoring').selectOption('stream');
      await page.locator('#sound-form [type=submit]').dblclick();
      await expect(page.locator('#sound-dialog')).not.toBeVisible();
      assert.equal(soundWrites,cycle+1);
      await page.locator('[data-edit-sound=stress-sound]').click();
      await expect(page.locator('#sound-name')).toHaveValue(`Sound ${cycle}`);
      await page.keyboard.press('Escape');
    }
    // Teardown is delivered once, before reopening; its queued native event
    // cannot clear the new session or steal the new field's focus.
    await page.locator('[data-edit-sound=stress-sound]').click();
    await page.evaluate(async()=>{
      const manager=await import('/dialog-drafts.js'), d=document.querySelector('#sound-dialog');
      window.teardowns=0;d.addEventListener('close',()=>window.teardowns++);
      manager.closeDialog(d);manager.closeDialog(d);manager.openDialog(d);
      document.querySelector('#sound-name').focus();
    });
    await page.waitForTimeout(50);
    assert.equal(await page.evaluate(()=>window.teardowns),1);
    await expect(page.locator('#sound-name')).toBeFocused();
    assert.equal(await page.evaluate(async()=>(await import('/dialog-drafts.js')).dialogDiagnostics().lostFocus),false);
    await page.keyboard.press('Escape');
    await expect(page.locator('#sound-dialog')).not.toBeVisible();
    await expect.poll(()=>page.evaluate(()=>window.teardowns)).toBe(2);
    assert.equal(await page.evaluate(async()=>(await import('/dialog-drafts.js')).dialogDiagnostics().staleSession),false);
    assert.deepEqual(errors,[]);
  }finally{await browser?.close();await server?.stop();await rm(folder,{recursive:true,force:true});}
});
