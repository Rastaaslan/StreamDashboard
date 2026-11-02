import {expect,it} from 'vitest';
import {chromium} from '@playwright/test';
import {build} from 'esbuild';

it.skipIf(process.env.PLANNING_ASSIST_BROWSER_TEST!=='1')(
  'F06: real Microsoft Edge at 320px prepares then explicitly saves one local-only event',async()=>{
  const bundle=await build({stdin:{contents:
    "import {createPlanning} from './apps/mobile/control/planning.js'; globalThis.createPlanning=createPlanning;",
    resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser'});
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:320,height:740},hasTouch:true});
    const external:string[]=[];
    await page.route('**/*',route=>{external.push(route.request().url());return route.abort()});
    await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1">'+
      '<style>*{box-sizing:border-box}body,main{margin:0;max-width:100%}button{max-width:100%;white-space:normal}</style>'+
      '<main id="screen"></main><section id="editor"></section>');
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.evaluate(()=>{
      const w=window as any;
      w.calls=[];w.errors=[];w.messages=[];w.online=true;
      const esc=(v:any)=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
        .replaceAll('>','&gt;').replaceAll('"','&quot;');
      w.data={host:{hostname:'FIXE',planning:[],settings:{},planningRevisions:{}}};
      w.changedOnRefresh=false;
      w.planner=w.createPlanning({
        getData:()=>w.data,getConnection:()=>w.online,esc,
        input:(label:string,name:string,value:any='',type:string='text')=>
          '<label>'+esc(label)+'<input name="'+name+'" type="'+type+
          '" value="'+esc(value)+'"></label>',
        select:(label:string,name:string,options:string[][],selected:string)=>'<label>'+
          esc(label)+'<select name="'+name+'">'+options.map(([v,t])=>
          '<option value="'+esc(v)+'"'+(v===selected?' selected':'')+'>'+esc(t)+'</option>'
          ).join('')+'</select></label>',
        check:(label:string,name:string,checked:boolean)=>
          '<label>'+esc(label)+'<input name="'+name+'" type="checkbox"'+
          (checked?' checked':'')+'></label>',
        modal:(html:string)=>{document.getElementById('editor')!.innerHTML=html},
        close:()=>{document.getElementById('editor')!.textContent=''},
        toast:(message:string)=>w.messages.push(message),
        refresh:async()=>{if(w.changedOnRefresh)w.data.host.hostname='Laptop'},
        render:()=>{},prepare:()=>{},
        api:async(path:string,body:any,method:string)=>{
          w.calls.push({path,body,method});
          if(path!=='/api/v2/planning'||method!=='POST')throw Error('UNEXPECTED_API');
          w.data.host.planning.push({...body,id:'created'});
          return {createdItemId:'created'};
        },
      });
      document.getElementById('screen')!.innerHTML=w.planner.mobilePage('next');
      document.getElementById('screen')!.addEventListener('click',(e:any)=>{
        const button=e.target.closest('button[data-planning]');
        if(button)w.planner.click(button).catch((error:any)=>w.errors.push(error.message));
      });
      document.getElementById('editor')!.addEventListener('submit',(e:any)=>{
        e.preventDefault();
        w.planner.submit(e.target).catch((error:any)=>w.errors.push(error.message));
      });
    });
    const suggested=page.getByRole('button',{name:'Vérifier et préparer un brouillon local'});
    expect(await suggested.count()).toBeGreaterThan(0);
    expect(await page.evaluate(()=>(window as any).calls.length)).toBe(0);
    await suggested.first().click();
    await expect.poll(()=>page.locator('#editor #planning-event-form').count()).toBe(1);
    expect(await page.evaluate(()=>(window as any).calls.length)).toBe(0);
    const form=page.locator('#editor #planning-event-form');
    expect(await form.locator('[name="twitch"]').isChecked()).toBe(false);
    expect(await form.locator('[name="google"]').isChecked()).toBe(false);
    await form.locator('[name="title"]').fill('Créneau proposé — local seulement');
    await form.locator('button:not([type])').last().click();
    await expect.poll(()=>page.evaluate(()=>(window as any).calls.length)).toBe(1);
    const result=await page.evaluate(()=>(window as any).calls[0]);
    expect(result).toMatchObject({
      path:'/api/v2/planning',method:'POST',
      body:{desiredPublication:{local:true,google:false,twitch:false},category:'live'},
    });
    expect(await page.evaluate(()=>(window as any).errors)).toEqual([]);
    expect(external).toEqual([]);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=320)).toBe(true);
  }finally{await browser.close();}
},30000);

it.skipIf(process.env.PLANNING_ASSIST_BROWSER_TEST!=='1')(
  'F06: real Edge rejects source changes during local suggestion refresh',async()=>{
  const bundle=await build({stdin:{contents:
    "import {createPlanning} from './apps/mobile/control/planning.js'; globalThis.createPlanning=createPlanning;",
    resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser'});
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:320,height:700}});
    await page.setContent('<main id="screen"></main>');
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.evaluate(()=>{
      const w=window as any;
      w.errors=[];w.calls=[];
      w.data={host:{hostname:'FIXE',planning:[],settings:{},planningRevisions:{}}};
      const esc=(s:any)=>String(s);
      w.planner=w.createPlanning({getData:()=>w.data,getConnection:()=>true,
        esc,api:()=>{w.calls.push('api')},modal:()=>{w.calls.push('modal')},
        refresh:async()=>{w.data.host.hostname='Laptop'},toast:()=>{},
        input:()=>'',select:()=>'',check:()=>'',render:()=>{},prepare:()=>{}});
      document.querySelector('main')!.innerHTML=w.planner.mobilePage('next');
      document.querySelector('main')!.addEventListener('click',(event:any)=>{
        const button=event.target.closest('button[data-planning]');
        if(button)w.planner.click(button).catch((error:any)=>w.errors.push(error.message));
      });
    });
    await page.getByRole('button',{name:'Vérifier et préparer un brouillon local'}).first().click();
    await expect.poll(()=>page.evaluate(()=>(window as any).errors.length)).toBe(1);
    expect(await page.evaluate(()=>(window as any).errors[0])).toContain('Source de planning changée');
    expect(await page.evaluate(()=>(window as any).calls)).toEqual([]);
  }finally{await browser.close()}
},30000);
