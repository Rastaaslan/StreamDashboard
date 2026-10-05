import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { startDashboardServer } from '../dist/apps/server/src/index.js';

for (const surface of ['planning', 'sounds', 'legacy']) {
  for (const lifecycle of ['reopen', 'edit-after-submit', ...(surface === 'legacy' ? [] : ['delete-reopen'])]) {
    test(`${surface}: delayed ${lifecycle} completion preserves the newer draft and target`, async () => {
      const folder = await mkdtemp(join(tmpdir(), 'dialog-completion-'));
      let server, browser;
      try {
        server = await startDashboardServer({ port: 0, dataDir: folder, logger: { info() {}, warn() {}, error() {} } });
        for (const id of ['first','second']) {
          const response = await fetch(server.url + '/api/v1/planning', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id,title:id,startAtUtc:new Date(Date.now()+86400000).toISOString(),endAtUtc:new Date(Date.now()+90000000).toISOString(),category:'personal',desiredPublication:{local:true,twitch:false,google:false}})});
          assert.equal(response.ok,true);
        }
        const dashboard=await (await fetch(server.url+'/api/v1/state')).json();
        const ids=Object.fromEntries(dashboard.planning.map(item=>[item.title,item.id]));
        const labels={first:'first',second:'second'};
        browser = await chromium.launch({headless:true,args:['--no-sandbox']});
        const page = await browser.newPage();
        page.setDefaultTimeout(8000);
        const errors=[]; page.on('pageerror',error=>errors.push(error.message));
        page.on('dialog', dialog=>dialog.accept());
        let sounds=['first','second'].map(id=>({id,name:id,category:'FX',volume:1,enabled:true,sourceAvailable:true}));
        await page.route('**/api/v1/soundboard',route=>route.fulfill({json:{sounds}}));
        await page.goto(server.url + (surface==='legacy' ? '/' : '/preview/?runtime=1'));
        const legacy=surface==='legacy', sound=surface==='sounds';
        if (legacy) {
          await page.locator('#onboarding [data-onboarding=later]').click();
          await expect(page.locator('#onboarding')).not.toBeVisible();
          await page.evaluate(()=>window.go('planning'));
        } else {
          await expect(page.locator('#runtime-status')).toHaveText('Runtime PC');
          await page.locator(`[data-view=${sound?'sounds':'planning'}]`).click();
        }
        const dialog=page.locator(sound?'#sound-dialog':'#event-dialog');
        const field=page.locator(sound?'#sound-name':legacy?'#event-form [name=title]':'#event-title');
        const submit=page.locator(sound?'#sound-form [type=submit]':legacy?'#event-form [type=submit]':'#event-submit');
        const open=async id=>{
          if (sound) await page.locator(`[data-edit-sound=${id}]`).click();
          else if (legacy) await page.locator(`[data-action=edit-event][data-value="${ids[id]}"]`).click();
          else {
            // Resolve by content: close can flush a deferred list render and change row indices.
            await page.locator('[data-event-index]').filter({has:page.getByText(labels[id],{exact:true})}).click();
          }
          await expect(dialog).toBeVisible();
        };
        let pending;
        const pattern=sound?'**/api/v1/soundboard/sounds/*':'**/api/v1/planning/*';
        await page.route(pattern,route=>{ if(['PUT','DELETE'].includes(route.request().method()))pending=route;else return route.continue(); });
        const resolve=async route=>{
          if(sound) {
            const id=route.request().url().split('/').pop();
            sounds=route.request().method()==='DELETE'?sounds.filter(s=>s.id!==id):sounds.map(s=>s.id===id?{...s,...route.request().postDataJSON()}:s);
            await route.fulfill({json:{sounds}});
          } else {
            if(route.request().method()==='PUT') {
              const key=Object.keys(ids).find(key=>ids[key]===route.request().url().split('/').pop());
              labels[key]=route.request().postDataJSON().title;
            }
            await route.fulfill({response:await route.fetch()});
          }
        };
        await open('first');
        await field.fill('Submitted');
        if(lifecycle==='delete-reopen') await page.locator(sound?'#sound-delete':'#event-delete').click();
        else await submit.click();
        await expect.poll(()=>Boolean(pending)).toBe(true);
        const original=pending; pending=undefined;
        const target=lifecycle==='edit-after-submit'?'first':'second';
        if(target==='second') { await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible(); await open(target); }
        await field.fill('New draft'); await field.focus();
        await field.evaluate(el=>el.setSelectionRange(4,4));
        const node=await field.elementHandle();
        await resolve(original);
        await expect(page.locator('#toast')).toContainText(lifecycle==='delete-reopen'?'supprimé':sound?'Soundboard enregistrée':legacy?'Planning enregistré':'Événement enregistré');
        await expect(dialog).toBeVisible(); await expect(field).toHaveValue('New draft'); await expect(field).toBeFocused();
        assert.deepEqual(await field.evaluate(el=>[el.selectionStart,el.selectionEnd]),[4,4]);
        assert.equal(await node.evaluate(el=>el.isConnected),true);
        await page.keyboard.insertText('continued ');
        await submit.click();
        await expect.poll(()=>Boolean(pending)).toBe(true);
        assert.equal(pending.request().url().split('/').pop(),sound?target:ids[target]);
        assert.equal(pending.request().postDataJSON()[sound?'name':'title'],'New continued draft');
        await resolve(pending);
        await expect(dialog).not.toBeVisible();
        await open(target); await expect(field).toHaveValue('New continued draft');
        assert.deepEqual(errors,[]);
      } finally { await browser?.close(); await server?.stop(); await rm(folder,{recursive:true,force:true}); }
    });
  }
}
