import {afterAll,beforeAll,expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {chromium,type Browser} from '@playwright/test';
import {validateConfiguration} from '../apps/server/src/control-service.js';
import {defaultControlData,type DeckAction} from '../packages/contracts/src/control.js';

const enabled=process.platform==='win32'&&process.env.SC3_F03_BROWSER_TEST==='1';
const test=enabled?it:it.skip;
let browser:Browser;
const source=enabled?await readFile(new URL('../apps/mobile/control/streamcockpit-macro-progress.js',import.meta.url),'utf8'):'';
beforeAll(async()=>{if(enabled)browser=await chromium.launch({channel:'msedge',headless:true})});
afterAll(async()=>{await browser?.close()});
test.each([320,1366])('real Edge %ipx renders durable macro-step status without HTML injection or overflow',async width=>{
 const page=await browser.newPage({viewport:{width,height:700}});
 try{
  await page.setContent('<main style="width:100%;max-width:100%;box-sizing:border-box;padding:8px"><section id="receipt"></section></main>');
  await page.addScriptTag({content:source.replaceAll('export function ','function ')+'\nwindow.renderMacroProgress=renderMacroProgress;'});
  const actual=await page.evaluate(()=>{
   const renderMacroProgress=(window as unknown as {renderMacroProgress:(receipt:unknown,escape:(text:string)=>string)=>string}).renderMacroProgress;
   const escape=(s:string)=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
   const host=document.getElementById('receipt')!;
   host.innerHTML=renderMacroProgress({macroSteps:[
    {id:'first_step',status:'succeeded'},
    {id:'second_step',status:'uncertain'},
    {id:'bad<img_src=x_onerror=alert(1)>',status:'running'},
    {id:'third_step',status:'pending'}]},escape);
   return {text:host.innerText,count:host.querySelectorAll('li').length,
     scripts:host.querySelectorAll('script,img').length,overflow:document.documentElement.scrollWidth>window.innerWidth};
  });
  expect(actual.count).toBe(3);
  expect(actual.text).toContain('first_step');expect(actual.text).toContain('À vérifier sur FIXE');
  expect(actual.text).toContain('Non lancée');expect(actual.scripts).toBe(0);expect(actual.overflow).toBe(false);
 }finally{await page.close()}
});

test('Edge 320px edits the existing macro value through named ordered buttons and refuses duplicate or public steps',async()=>{
 const page=await browser.newPage({viewport:{width:320,height:740},hasTouch:true});
 try{
  await page.route('**/*',r=>r.abort());
  await page.setContent('<form id="action-form" data-id="seq"><label>Action<select name="type"><option value="scene.set">Scène</option><option value="macro.sequence">Séquence</option></select></label><label>Paramètre<input name="value"></label><label>Raccourci<select name="shortcut"><option value="">Aucun</option><option value="Control+Alt+Shift+F4">F4</option></select></label></form>');
  await page.addScriptTag({content:source.replaceAll('export function ','function ')+'\nwindow.mountMacroSequenceEditor=mountMacroSequenceEditor;'});
  await page.evaluate(()=>{const w=window as any;w.mountMacroSequenceEditor(document.getElementById('action-form'),[
   {id:'scene',type:'scene.set',label:'Pause'}, {id:'timer',type:'timer.add',label:'Ajouter une minute'},
   {id:'public',type:'chat.send',label:'Message public'}, {id:'live',type:'live.start',label:'Démarrage'},
   {id:'other',type:'macro.sequence',label:'Autre séquence'},
  ])});
  await page.locator('[name=type]').selectOption('macro.sequence');
  expect(await page.locator('[name=shortcut]').isDisabled()).toBe(true);
  expect(await page.getByLabel('Étape OBS 1').locator('option').allTextContents()).toEqual(['Choisir un bouton','Pause','Ajouter une minute']);
  await page.getByLabel('Étape OBS 1').selectOption('scene');await page.getByLabel('Étape OBS 2').selectOption('timer');
  expect(await page.locator('[name=value]').inputValue()).toBe('scene,timer');
  expect(await page.locator('form').evaluate((form:any)=>form.checkValidity())).toBe(true);
  const editor=await readFile(new URL('../apps/mobile/control/control.js',import.meta.url),'utf8');
  expect(editor).toContain("if(f.id==='action-form'){const a={id:f.dataset.id,...v,shortcut:v.shortcut||''};");
  // FormData excludes disabled controls: the production submit branch restores
  // the required empty shortcut without enabling a native macro binding.
  const fields=await page.locator('form').evaluate((form:any)=>Object.fromEntries(new FormData(form)));
  expect(fields).not.toHaveProperty('shortcut');
  const configuration=defaultControlData().configuration;
  configuration.actions=[
   {id:'scene',label:'Pause',type:'scene.set',value:'Pause',shortcut:'',color:'amber'},
   {id:'timer',label:'Minute',type:'timer.add',value:'60',shortcut:'',color:'green'},
   {id:'seq',label:'Séquence',color:'purple',...fields,shortcut:fields.shortcut||''} as DeckAction,
  ];
  expect(validateConfiguration(configuration).actions[2]).toMatchObject({type:'macro.sequence',value:'scene,timer',shortcut:''});
  await page.getByLabel('Étape OBS 2').selectOption('scene');expect(await page.locator('form').evaluate((form:any)=>form.checkValidity())).toBe(false);
  await page.locator('[name=type]').selectOption('scene.set');expect(await page.locator('[name=value]').isVisible()).toBe(true);
  expect(await page.locator('[name=shortcut]').isDisabled()).toBe(false);
 }finally{await page.close()}
});
