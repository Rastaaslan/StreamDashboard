import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
// @ts-expect-error Standalone browser modules have no separate TS declarations
import {prepareAssistedLocalDraft,prepareAssistedLocalDuplicate} from '../apps/mobile/control/streamcockpit-planning-draft.js';
// @ts-expect-error Browser planning module intentionally has no TS declarations
import {createPlanning} from '../apps/mobile/control/planning.js';

const now=Date.parse('2026-11-02T10:00:00.000Z');
const slot={from:'2026-11-02T14:00:00.000Z',to:'2026-11-02T15:00:00.000Z'};
const busy=(patch:Record<string,unknown>={})=>({
  id:'busy',title:'Evénement local',category:'personal',source:'GOOGLE',
  startAtUtc:'2026-11-02T12:00:00.000Z',
  endAtUtc:'2026-11-02T13:00:00.000Z',
  ...patch,
});
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(now)});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks()});

describe('F06 assistant local-only preflight',()=>{
  it('creates an unpublished local-only editor draft without touching the schedule',()=>{
    const items=[busy()],original=structuredClone(items);
    const draft=prepareAssistedLocalDraft(items,slot,now);
    expect(draft).toMatchObject({
      startAtUtc:slot.from,endAtUtc:slot.to,category:'live',
      desiredPublication:{local:true,google:false,twitch:false},providers:{},
    });
    expect(draft).not.toHaveProperty('id');
    expect(draft).not.toHaveProperty('recurrence');
    expect(items).toEqual(original);
  });
  it('treats cached/imported Google rows as blockers, never infers real provider free time',()=>{
    expect(()=>prepareAssistedLocalDraft([busy({source:'GOOGLE',startAtUtc:slot.from,endAtUtc:slot.to})],slot,now))
      .toThrow('Chevauchement');
  });
  it('expands recurrence and moved exceptions before allowing any draft',()=>{
    const master=busy({id:'series',category:'live',
      startAtUtc:'2026-11-01T14:00:00.000Z',endAtUtc:'2026-11-01T15:00:00.000Z',
      recurrence:{frequency:'daily',interval:1,timeZone:'Europe/Paris',exceptions:{}},
    });
    expect(()=>prepareAssistedLocalDraft([master],slot,now)).toThrow('Chevauchement');
  });
  it.each([
    {deletionPending:true},
    {conflict:{provider:'google'}},
    {id:''},
    {endAtUtc:'nonsense'},
    {providers:{google:{status:'conflict'}}},
  ])('refuses uncertain or corrupted master %#',patch=>{
    expect(()=>prepareAssistedLocalDraft([busy(patch)],slot,now)).toThrow();
  });
  it.each([
    [null,slot],['not-an-array',slot],
    [[],{from:'invalid',to:slot.to}],
    [[],{from:'2026-11-02T14:00:00',to:slot.to}],
    [[],{from:slot.from,to:slot.from}],
    [[],{from:'2026-11-02T10:03:00Z',to:'2026-11-02T11:03:00Z'}],
    [[],{from:slot.from,to:'2026-11-04T15:00:00Z'}],
  ])('fails closed for invalid source or local-time window %#',(items,window)=>{
    expect(()=>prepareAssistedLocalDraft(items,window,now)).toThrow();
  });
});

function fixture(changeOnRefresh?: (count:number,data:any)=>void){
  let online=true,count=0;
  const state={host:{hostname:'FIXE',planning:[busy()],settings:{},planningRevisions:{}}};
  const api=vi.fn(async(route:string,body:any,method:string)=>{
    if(route==='/api/v2/planning'&&method==='POST'){
      state.host.planning.push({...body,id:'created'});
      return {createdItemId:'created'};
    }
    throw new Error('UNEXPECTED_API');
  });
  const modal=vi.fn(),toast=vi.fn(),close=vi.fn();
  const refresh=vi.fn(async()=>{
    count++;changeOnRefresh?.(count,state);
  });
  const esc=(s:unknown)=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  const planning=createPlanning({
    getData:()=>state,getConnection:()=>online,api,modal,toast,close,refresh,
    render:vi.fn(),prepare:vi.fn(),esc,
    input:(_label:string,name:string)=>'<input name="'+name+'">',
    select:(_label:string,name:string)=>'<select name="'+name+'"></select>',
    check:(_label:string,name:string)=>'<input name="'+name+'" type="checkbox">',
  });
  const slotFromPage=()=>{
    const html=planning.mobilePage('next');
    const match=html.match(/data-planning="assist-new" data-from="([^"]+)" data-to="([^"]+)"/);
    if(!match)throw Error('No rendered F06 suggestion');
    return {from:match[1],to:match[2],html};
  };
  return {planning,slotFromPage,api,modal,toast,close,refresh,state,setOnline:(v:boolean)=>{online=v}};
}
const localInput=(iso:string)=>{
  const d=new Date(iso);return new Date(+d-d.getTimezoneOffset()*60_000).toISOString().slice(0,16);
};
function simulateForm(fields:Record<string,string>){
  vi.stubGlobal('FormData',class {
    *[Symbol.iterator](){yield* Object.entries(fields)}
  });
  return {id:'planning-event-form',dataset:{},
    querySelector:()=>({disabled:false})};
}
const validFields=(slot:{from:string;to:string})=>({
  title:'Nouveau live',description:'Préparation locale',
  start:localInput(slot.from),end:localInput(slot.to),
  category:'live',twitchCategoryName:'Minecraft',twitchCategoryId:'',
  tags:'',language:'fr',frequency:'',interval:'1',timeZone:'Europe/Paris',
});

describe('F06 actual planning mobile integration',()=>{
  it('renders a deliberate suggestion and opens a prefilled UNSAVED editor after FIXE refresh',async()=>{
    const f=fixture(),slot=f.slotFromPage();
    expect(slot.html).toContain('UNKNOWN');
    expect(slot.html).toContain('Vérifier et préparer un brouillon local');
    expect(f.api).not.toHaveBeenCalled();
    await f.planning.click({dataset:{planning:'assist-new',from:slot.from,to:slot.to}});
    expect(f.refresh).toHaveBeenCalledTimes(1);
    expect(f.modal).toHaveBeenCalledTimes(1);
    expect(f.modal.mock.calls[0][0]).toContain('planning-event-form');
    expect(f.modal.mock.calls[0][0]).toContain('Créer un événement');
    expect(f.api).not.toHaveBeenCalled();
    expect(f.toast.mock.calls[0][0]).toContain('non sauvegardé');
  });
  it('disables the entry point while offline and rejects forged clicks',async()=>{
    const f=fixture();f.setOnline(false);
    const slot=f.slotFromPage();
    expect(slot.html).toContain('data-planning="assist-new"');
    expect(slot.html).toContain('disabled>Vérifier et préparer');
    await expect(f.planning.click({dataset:{planning:'assist-new',from:slot.from,to:slot.to}}))
      .rejects.toThrow('indisponible');
    expect(f.refresh).not.toHaveBeenCalled();expect(f.modal).not.toHaveBeenCalled();
  });
  it('rejects a new imported blocker during the refresh before opening a draft',async()=>{
    const f=fixture((n,s)=>{if(n===1)s.host.planning.push(busy({
      id:'late-google',source:'GOOGLE',startAtUtc:slot.from,endAtUtc:slot.to,
    }))});
    const slot=f.slotFromPage();
    await expect(f.planning.click({dataset:{planning:'assist-new',from:slot.from,to:slot.to}}))
      .rejects.toThrow('Chevauchement');
    expect(f.modal).not.toHaveBeenCalled();expect(f.api).not.toHaveBeenCalled();
  });
  it('rejects a different host selected while refreshing, without preparing or publishing',async()=>{
    const f=fixture((n,s)=>{if(n===1)s.host.hostname='Laptop'});
    const slot=f.slotFromPage();
    await expect(f.planning.click({dataset:{planning:'assist-new',from:slot.from,to:slot.to}}))
      .rejects.toThrow('Source de planning changée');
    expect(f.modal).not.toHaveBeenCalled();expect(f.api).not.toHaveBeenCalled();
  });
  it('revalidates at explicit save and REFUSES a new conflict before any provider write',async()=>{
    let selected:{from:string;to:string};
    const f=fixture((n,s)=>{
      if(n===2)s.host.planning.push(busy({id:'another',startAtUtc:selected.from,endAtUtc:selected.to}));
    });
    selected=f.slotFromPage();
    await f.planning.click({dataset:{planning:'assist-new',from:selected.from,to:selected.to}});
    const form=simulateForm(validFields(selected));
    await expect(f.planning.submit(form)).rejects.toThrow('Chevauchement');
    expect(f.refresh).toHaveBeenCalledTimes(2);
    expect(f.api).not.toHaveBeenCalled();
  });
  it('does not allow toggling Twitch/Google publishing in an assistant draft',async()=>{
    const f=fixture(),slot=f.slotFromPage();
    await f.planning.click({dataset:{planning:'assist-new',from:slot.from,to:slot.to}});
    const form=simulateForm({...validFields(slot),google:'on'});
    await expect(f.planning.submit(form)).rejects.toThrow('local uniquement');
    expect(f.api).not.toHaveBeenCalled();
  });
  it('sends ONE local-only planning POST only after an explicit form submit and second refresh',async()=>{
    const f=fixture(),slot=f.slotFromPage();
    await f.planning.click({dataset:{planning:'assist-new',from:slot.from,to:slot.to}});
    expect(f.api).not.toHaveBeenCalled();
    const form=simulateForm(validFields(slot));
    expect(await f.planning.submit(form)).toBe(true);
    expect(f.api).toHaveBeenCalledTimes(1);
    const [path,body,method]=f.api.mock.calls[0];
    expect(path).toBe('/api/v2/planning');
    expect(method).toBe('POST');
    expect(body).toMatchObject({category:'live',assistedLocalSlot:true,desiredPublication:{local:true,google:false,twitch:false}});
    expect(body).not.toHaveProperty('providers');
    expect(f.close).toHaveBeenCalledTimes(1);
    expect(f.refresh).toHaveBeenCalledTimes(3);
  });
});

it('F06 lost local-save receipt is NOT silently resent from the same assisted editor',async()=>{
  const f=fixture(),chosen=f.slotFromPage();
  await f.planning.click({dataset:{planning:'assist-new',from:chosen.from,to:chosen.to}});
  const form=simulateForm(validFields(chosen));
  f.api.mockImplementationOnce(async(_path:string,body:any)=>{
    f.state.host.planning.push({...body,id:'created'});
    throw new Error('ACK_LOST_AFTER_WRITE');
  });
  await expect(f.planning.submit(form)).rejects.toThrow('ACK_LOST_AFTER_WRITE');
  expect(f.api).toHaveBeenCalledTimes(1);
  await expect(f.planning.submit(form)).rejects.toThrow('potentiellement incertain');
  expect(f.api).toHaveBeenCalledTimes(1);
  expect(f.close).not.toHaveBeenCalled();
});

const copiedLive=()=>({
  id:'old-live',title:'Vagrant Saga',description:'Copie du live à préparer',
  category:'live',source:'GOOGLE',
  startAtUtc:'2026-11-01T16:00:00.000Z',endAtUtc:'2026-11-01T18:00:00.000Z',
  twitchCategoryId:'1234',twitchCategoryName:'Minecraft',
  tags:{values:['coop','survie'],source:'manual'},
  tagPreferences:{automatic:false,language:'fr'},
  desiredPublication:{local:true,twitch:true,google:true},
  providers:{twitch:{status:'synced',remoteId:'private-remote-id'}},
});
const duplicateButton=(s:{from:string;to:string})=>({
  dataset:{planning:'assist-duplicate',from:s.from,to:s.to,sourceId:'old-live'},
});

describe('F06 assisted duplication -> reviewed local-only editor',()=>{
  it('copies only selected content, never provider IDs, schedule identity or publication',()=>{
    const source=copiedLive(),original=structuredClone(source);
    const draft=prepareAssistedLocalDuplicate([busy(),source],'old-live',slot,now);
    expect(draft).toMatchObject({
      title:'Vagrant Saga (copie)',description:source.description,
      startAtUtc:slot.from,endAtUtc:slot.to,category:'live',
      tags:{values:['coop','survie']},
      desiredPublication:{local:true,twitch:false,google:false},providers:{},
    });
    for(const key of ['id','localId','seriesId','recurrence','remoteId','occurrenceKey'])
      expect(draft).not.toHaveProperty(key);
    expect(source).toEqual(original);
  });
  it.each([
    {sourceId:'missing',patch:{}},
    {sourceId:'old-live',patch:{category:'personal'}},
    {sourceId:'old-live',patch:{deletionPending:true}},
    {sourceId:'old-live',patch:{recurrence:{frequency:'daily',interval:1,timeZone:'Europe/Paris'}}},
    {sourceId:'old-live',patch:{providers:{twitch:{status:'pending'}}}},
    {sourceId:'old-live',patch:{tags:{values:[12]}}},
  ])('rejects ineligible or uncertain live source %#',({sourceId,patch})=>{
    expect(()=>prepareAssistedLocalDuplicate([busy(),{...copiedLive(),...patch}],sourceId,slot,now))
      .toThrow();
  });
  it('renders the selected live duplication and saves only after two host reads and deliberate submit',async()=>{
    const f=fixture();f.state.host.planning.push(copiedLive());
    const slot=f.slotFromPage();
    expect(slot.html).toContain('data-planning="assist-duplicate"');
    expect(slot.html).toContain('data-planning-assist-source');
    expect(f.api).not.toHaveBeenCalled();
    await f.planning.click(duplicateButton(slot));
    expect(f.refresh).toHaveBeenCalledTimes(1);
    expect(f.modal).toHaveBeenCalledTimes(1);
    expect(f.api).not.toHaveBeenCalled();
    expect(f.modal.mock.calls[0][0]).toContain('planning-event-form');
    const form=simulateForm({...validFields(slot),title:'Vagrant Saga (copie)'});
    expect(await f.planning.submit(form)).toBe(true);
    expect(f.refresh).toHaveBeenCalledTimes(3);
    expect(f.api).toHaveBeenCalledTimes(1);
    const [route,body,method]=f.api.mock.calls[0];
    expect([route,method]).toEqual(['/api/v2/planning','POST']);
    expect(body).toMatchObject({title:'Vagrant Saga (copie)',
      assistedLocalSlot:true,desiredPublication:{local:true,twitch:false,google:false}});
    for(const key of ['id','providers','localId','occurrenceKey'])
      expect(body).not.toHaveProperty(key);
  });
  it('rejects a selected live edited during the first host refresh, before opening an editor',async()=>{
    const f=fixture((n,s)=>{if(n===1)s.host.planning[1].title='Autre titre'});
    f.state.host.planning.push(copiedLive());
    const slot=f.slotFromPage();
    await expect(f.planning.click(duplicateButton(slot))).rejects.toThrow('Session source modifiée');
    expect(f.modal).not.toHaveBeenCalled();expect(f.api).not.toHaveBeenCalled();
  });
  it('rejects changed source at save even with a still-free slot',async()=>{
    const f=fixture((n,s)=>{if(n===2)s.host.planning[1].twitchCategoryName='Autre jeu'});
    f.state.host.planning.push(copiedLive());
    const slot=f.slotFromPage();
    await f.planning.click(duplicateButton(slot));
    const form=simulateForm({...validFields(slot),title:'Vagrant Saga (copie)'});
    await expect(f.planning.submit(form)).rejects.toThrow('Session source modifiée');
    expect(f.api).not.toHaveBeenCalled();
  });
  it('never retries a duplicate after a lost local-save acknowledgement',async()=>{
    const f=fixture();f.state.host.planning.push(copiedLive());
    const slot=f.slotFromPage();
    await f.planning.click(duplicateButton(slot));
    const form=simulateForm({...validFields(slot),title:'Vagrant Saga (copie)'});
    f.api.mockImplementationOnce(async()=>{throw new Error('ACK_LOST_AFTER_WRITE')});
    await expect(f.planning.submit(form)).rejects.toThrow('ACK_LOST_AFTER_WRITE');
    await expect(f.planning.submit(form)).rejects.toThrow('potentiellement incertain');
    expect(f.api).toHaveBeenCalledTimes(1);
  });
});
