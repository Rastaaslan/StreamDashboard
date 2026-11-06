import {describe,it,expect,vi,afterEach} from 'vitest';
// @ts-expect-error Browser module has no TypeScript declaration
import {assistedDuplicateSelection,prepareAssistedLocalDuplicate} from '../apps/mobile/control/streamcockpit-planning-draft.js';
// @ts-expect-error Browser planning module has no TypeScript declaration
import {renderPlanningAssistant} from '../apps/mobile/control/streamcockpit-planning.js';
// @ts-expect-error Browser planning module has no TypeScript declaration
import {createPlanning} from '../apps/mobile/control/planning.js';
// @ts-expect-error Browser recurrence adapter has no separate declarations
import {projectRecurrence} from '../apps/mobile/shared/recurrence.js';

const now=Date.parse('2026-11-06T10:00:00Z');
const target={from:'2026-11-06T14:00:00.000Z',to:'2026-11-06T15:00:00.000Z'};
const master=():any=>({id:'series',title:'Série Minecraft',description:'Plannings coop',category:'live',
  source:'DAMPLANNER',startAtUtc:'2026-11-04T18:00:00.000Z',endAtUtc:'2026-11-04T19:00:00.000Z',
  recurrence:{version:2,frequency:'daily',interval:1,timeZone:'Europe/Paris',exceptions:{}},
  twitchCategoryId:'123',twitchCategoryName:'Minecraft',tags:{values:['survie']},
  tagPreferences:{automatic:false,language:'fr'},desiredPublication:{local:true,twitch:true,google:true},
  providers:{google:{status:'synced',remoteId:'PRIVATE_SERIES_ID'}}});
const occurrences=(m=master())=>projectRecurrence(m,{windowStart:'2026-11-06T00:00:00Z',windowEnd:'2026-11-10T00:00:00Z'});
const localInput=(iso:string)=>{const d=new Date(iso);return new Date(+d-d.getTimezoneOffset()*60_000).toISOString().slice(0,16)};
const escape=(v:unknown)=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals()});

describe('F06 recurring occurrence -> local-only reviewed duplicate',()=>{
  it('exposes a uniquely keyed non-cancelled occurrence and copies its effective override without remote authority',()=>{
    const m=master(),occ=occurrences(m)[0];
    m.recurrence.exceptions[occ.occurrenceKey]={patch:{title:'Épisode spécial',description:'Jungle',tags:{values:['event']}}};
    const [effective]=occurrences(m);
    const html=renderPlanningAssistant([m],{esc:escape,online:true,now});
    expect(html).toContain('data-occurrence-key="'+effective.occurrenceKey+'"');
    expect(html).toContain('Épisode spécial');
    const selection=assistedDuplicateSelection([m],'series',effective.occurrenceKey,now);
    expect(selection.source.title).toBe('Épisode spécial');
    const draft=prepareAssistedLocalDuplicate([m],'series',target,now,effective.occurrenceKey);
    expect(draft).toMatchObject({title:'Épisode spécial (copie)',description:'Jungle',tags:{values:['event']},
      desiredPublication:{local:true,twitch:false,google:false},providers:{}});
    for(const key of ['id','localId','seriesId','occurrenceKey','recurrence','remoteId'])
      expect(draft).not.toHaveProperty(key);
  });
  it('rejects a cancelled, malformed, foreign, absent or custom-engine occurrence',()=>{
    const m=master(),key=occurrences(m)[0].occurrenceKey;
    m.recurrence.exceptions[key]={cancelled:true};
    expect(()=>assistedDuplicateSelection([m],'series',key,now)).toThrow();
    expect(()=>assistedDuplicateSelection([m],'series','other:2026-11-06T19:00:00',now)).toThrow();
    expect(()=>assistedDuplicateSelection([m],'series','series:2026-12-12T19:00:00',now)).toThrow();
    expect(()=>assistedDuplicateSelection([m],'series',undefined,now)).toThrow();
    const custom=master();custom.recurrence.custom={engine:'unknown',version:1,parameters:{}};
    expect(()=>assistedDuplicateSelection([custom],'series',key,now)).toThrow();
  });
  it('tracks a changed master or moved exception across the two host rereads',()=>{
    const m=master(),key=occurrences(m)[0].occurrenceKey;
    const fingerprint=assistedDuplicateSelection([m],'series',key,now).fingerprint;
    const changed=structuredClone(m);
    changed.recurrence.exceptions[key]={patch:{title:'Déplacé',startAtUtc:'2026-11-07T20:00:00Z',endAtUtc:'2026-11-07T21:00:00Z'}};
    expect(assistedDuplicateSelection([changed],'series',key,now).fingerprint).not.toBe(fingerprint);
  });
  it('refuses unsafe source publication / missing tags on edited recurrence',()=>{
    const m=master(),key=occurrences(m)[0].occurrenceKey;
    m.recurrence.exceptions[key]={patch:{providers:{twitch:{status:'pending'}}}};
    expect(()=>assistedDuplicateSelection([m],'series',key,now)).toThrow();
  });
  it('full UI click -> FIXE read -> editor -> FIXE reread -> exactly one local create; lost ACK never retries',async()=>{
    vi.useFakeTimers();vi.setSystemTime(now);
    const m=master(),key=occurrences(m)[0].occurrenceKey;
    const state:any={host:{hostname:'FIXE',planning:[m],settings:{},planningRevisions:{}}};
    let reads=0;
    const api=vi.fn(async(path:string,body:any,method:string)=>{
      expect([path,method]).toEqual(['/api/v2/planning','POST']);
      expect(body).toMatchObject({assistedLocalSlot:true,category:'live',
        desiredPublication:{local:true,google:false,twitch:false}});
      state.host.planning.push({...body,id:'created'});
      return {createdItemId:'created'};
    });
    const refresh=vi.fn(async()=>{reads++});
    const modal=vi.fn(),toast=vi.fn(),close=vi.fn();
    const planning=createPlanning({getData:()=>state,getConnection:()=>true,api,modal,toast,close,refresh,
      render:vi.fn(),prepare:vi.fn(),esc:escape,
      input:(_label:string,name:string,value:any='')=>'<input name="'+name+'" value="'+escape(value)+'">',
      select:(_label:string,name:string)=>'<select name="'+name+'"></select>',
      check:(_label:string,name:string)=>'<input name="'+name+'" type="checkbox">'});
    const slots=planning.mobilePage('next');
    expect(slots).toContain('data-occurrence-key="'+key+'"');
    const found=slots.match(/data-planning="assist-duplicate" data-from="([^"]+)" data-to="([^"]+)"/);
    expect(found).not.toBeNull();
    const [_,from,to]=found!;
    await planning.click({dataset:{planning:'assist-duplicate',sourceId:'series',occurrenceKey:key,from,to}});
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(api).not.toHaveBeenCalled();
    expect(modal.mock.calls[0][0]).toContain('Série Minecraft (copie)');
    vi.stubGlobal('FormData',class { *[Symbol.iterator](){
      yield* Object.entries({title:'Série Minecraft (copie)',description:'Preflight local',
        start:localInput(from),end:localInput(to),category:'live',allDay:'',
        twitchCategoryId:'123',twitchCategoryName:'Minecraft',tags:'survie',language:'fr',
        frequency:'',interval:'1',timeZone:'Europe/Paris'});
    }});
    const form:any={id:'planning-event-form',dataset:{},querySelector:()=>({disabled:false})};
    expect(await planning.submit(form)).toBe(true);
    expect(api).toHaveBeenCalledTimes(1);
    expect(reads).toBe(3);
    expect(api.mock.calls[0][1].recurrence).toBeNull(); // standalone event, never copied series
  });
});

it.each(['first refresh','save refresh'])('F06 recurring source changed on %s -> no local write',async stage=>{
  vi.useFakeTimers();vi.setSystemTime(now);
  const m=master(),key=occurrences(m)[0].occurrenceKey;
  const state:any={host:{hostname:'FIXE',planning:[m],settings:{},planningRevisions:{}}};
  let count=0;
  const refresh=vi.fn(async()=>{
    count++;
    if((stage==='first refresh'&&count===1)||(stage==='save refresh'&&count===2))
      m.recurrence.exceptions[key]={patch:{title:'Concurrent edition',description:'Autre intention'}};
  });
  const api=vi.fn(async()=>({createdItemId:'no'}));
  const planner=createPlanning({getData:()=>state,getConnection:()=>true,api,
    modal:vi.fn(),toast:vi.fn(),close:vi.fn(),refresh,render:vi.fn(),prepare:vi.fn(),esc:escape,
    input:(_label:string,name:string)=>'<input name="'+name+'">',
    select:(_label:string,name:string)=>'<select name="'+name+'"></select>',
    check:(_label:string,name:string)=>'<input name="'+name+'">'});
  const html=planner.mobilePage('next');
  const found=html.match(/data-planning="assist-duplicate" data-from="([^"]+)" data-to="([^"]+)"/)!;
  const [_,from,to]=found;
  const click=planner.click({dataset:{planning:'assist-duplicate',sourceId:'series',occurrenceKey:key,from,to}});
  if(stage==='first refresh')await expect(click).rejects.toThrow('Session source modifiée');
  else{
    await click;
    vi.stubGlobal('FormData',class{*[Symbol.iterator](){
      yield* Object.entries({title:'Série Minecraft (copie)',description:'Nouvelle description',
        start:localInput(from),end:localInput(to),category:'live',tags:'survie',
        twitchCategoryId:'123',twitchCategoryName:'Minecraft',language:'fr',frequency:''});
    }});
    await expect(planner.submit({id:'planning-event-form',dataset:{},querySelector:()=>({disabled:false})}))
      .rejects.toThrow('Session source modifiée');
  }
  expect(api).not.toHaveBeenCalled();
});

it('F06 recurring copy loses save ACK: one attempted POST, never a silent duplicate',async()=>{
  vi.useFakeTimers();vi.setSystemTime(now);
  const m=master(),key=occurrences(m)[0].occurrenceKey;
  const state:any={host:{hostname:'FIXE',planning:[m],settings:{},planningRevisions:{}}};
  const api=vi.fn(async(_path:string,body:any)=>{state.host.planning.push({...body,id:'created'});throw Error('ACK_LOST')});
  const planner=createPlanning({getData:()=>state,getConnection:()=>true,api,
    modal:vi.fn(),toast:vi.fn(),close:vi.fn(),refresh:vi.fn(async()=>{}),
    render:vi.fn(),prepare:vi.fn(),esc:escape,
    input:(_label:string,name:string)=>'<input name="'+name+'">',
    select:(_label:string,name:string)=>'<select name="'+name+'"></select>',
    check:(_label:string,name:string)=>'<input name="'+name+'">'});
  const match=planner.mobilePage('next').match(/data-planning="assist-duplicate" data-from="([^"]+)" data-to="([^"]+)"/)!;
  await planner.click({dataset:{planning:'assist-duplicate',sourceId:'series',occurrenceKey:key,
    from:match[1],to:match[2]}});
  vi.stubGlobal('FormData',class{*[Symbol.iterator](){
    yield* Object.entries({title:'Série Minecraft (copie)',description:'Copie locale',
      start:localInput(match[1]),end:localInput(match[2]),category:'live',
      twitchCategoryId:'123',twitchCategoryName:'Minecraft',tags:'survie',language:'fr',frequency:''});
  }});
  const form:any={id:'planning-event-form',dataset:{},querySelector:()=>({disabled:false})};
  await expect(planner.submit(form)).rejects.toThrow('ACK_LOST');
  await expect(planner.submit(form)).rejects.toThrow('potentiellement incertain');
  expect(api).toHaveBeenCalledTimes(1);
  expect(state.host.planning).toHaveLength(2);
});

it('F06 real Edge 320px: choose one recurring occurrence and open local editor without POST',async()=>{
  const {chromium}=await import('@playwright/test');
  const {build}=await import('esbuild');
  const bundle=await build({stdin:{contents:
    "import {createPlanning} from './apps/mobile/control/planning.js'; globalThis.createPlanning=createPlanning;",
    resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser'});
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:320,height:740},hasTouch:true});
    const external:string[]=[];
    await page.route('**/*',route=>{external.push(route.request().url());return route.abort()});
    await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1">'+
      '<main id="screen"></main><div id="editor"></div>');
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.evaluate(()=>{
      const w=window as any;
      w.calls=[];w.errors=[];w.refreshes=0;
      const now=Date.now(),start=new Date(now+2*86_400_000).toISOString();
      const finish=new Date(now+2*86_400_000+3_600_000).toISOString();
      const esc=(v:any)=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
        .replaceAll('>','&gt;').replaceAll('"','&quot;');
      w.state={host:{hostname:'FIXE',planning:[{id:'series',title:'Série planifiée',
        description:'Détails coop',category:'live',startAtUtc:start,endAtUtc:finish,
        source:'DAMPLANNER',recurrence:{version:2,frequency:'daily',interval:1,
          timeZone:'Europe/Paris',exceptions:{}},providers:{}}],settings:{},planningRevisions:{}}};
      w.planner=w.createPlanning({getData:()=>w.state,getConnection:()=>true,
        api:async(...args:any[])=>{w.calls.push(args);throw Error('NETWORK_FORBIDDEN')},
        modal:(html:string)=>{document.getElementById('editor')!.innerHTML=html},
        close:()=>{},toast:()=>{},refresh:async()=>{w.refreshes++},render:()=>{},prepare:()=>{},
        esc,input:(label:string,name:string,value:any='',type:string='text')=>
          '<label>'+esc(label)+'<input name="'+name+'" type="'+type+
            '" value="'+esc(value)+'"></label>',
        select:(label:string,name:string,values:string[][],selected:string)=>
          '<label>'+esc(label)+'<select name="'+name+'">'+values.map(([v,t])=>
          '<option value="'+esc(v)+'"'+(v===selected?' selected':'')+'>'+esc(t)+'</option>'
          ).join('')+'</select></label>',
        check:(label:string,name:string,checked:boolean)=>'<label>'+esc(label)+
          '<input type="checkbox" name="'+name+'"'+(checked?' checked':'')+'></label>'});
      document.getElementById('screen')!.innerHTML=w.planner.mobilePage('next');
      document.addEventListener('click',event=>{
        const button=(event.target as HTMLElement).closest('[data-planning="assist-duplicate"]');
        if(button)void w.planner.click(button).catch((error:Error)=>w.errors.push(error.message));
      });
    });
    const selected=page.locator('[data-planning-assist-source]');
    expect(await selected.locator('option[data-occurrence-key]').count()).toBeGreaterThan(0);
    await selected.selectOption({index:1});
    const key=await selected.evaluate((el:any)=>el.selectedOptions[0].dataset.occurrenceKey);
    expect(key).toMatch(/^series:/);
    await page.locator('details.planning-assist-suggestions summary').click();
    await page.locator('[data-planning="assist-duplicate"]').first().click();
    await page.locator('#editor input[name="title"]').waitFor({state:'visible',timeout:5000});
    expect(await page.locator('#editor input[name="title"]').inputValue()).toBe('Série planifiée (copie)');
    expect(await page.evaluate(()=>(window as any).refreshes)).toBe(1);
    expect(await page.evaluate(()=>(window as any).calls.length)).toBe(0);
    expect(await page.evaluate(()=>(window as any).errors)).toEqual([]);
    expect(external).toEqual([]);
  }finally{await browser.close();}
},30000);
