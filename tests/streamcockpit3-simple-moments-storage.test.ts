import {it,expect} from 'vitest';
import {loadUncertainMoment,rememberUncertainMoment,clearUncertainMoment,diagnoseUncertainMomentStore} from '../apps/mobile/control/streamcockpit-twitch-moment-pending.js';
const uuid='643e0c2b-e8e4-4ccd-a82c-8ad0a05f19c5';
function mockStorage(){
  const data=new Map<string,string>();
  return {view:{localStorage:{
    getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value)},
  }},data};
}
it('F04 stores only a scoped UUID and kind before Twitch POST; lookup cannot grant a new POST',()=>{
  const {view,data}=mockStorage(),now=1800000000000;
  expect(rememberUncertainMoment(view,'https://fixe','dam',{id:uuid,kind:'clip'},now)).toBe(true);
  expect(loadUncertainMoment(view,'https://fixe','dam',now)).toEqual({id:uuid,kind:'clip'});
  expect(loadUncertainMoment(view,'https://autre','dam',now)).toBeNull();
  expect(loadUncertainMoment(view,'https://fixe','autre',now)).toBeNull();
  const raw=[...data.values()][0];
  expect(raw).toContain(uuid);
  expect(raw).not.toContain('credential');
  expect(raw).not.toContain('token');
  expect(raw).not.toContain('editUrl');
  expect(clearUncertainMoment(view,'https://fixe','dam',now)).toBe(true);
  expect(loadUncertainMoment(view,'https://fixe','dam',now)).toBeNull();
});
it('F04 keeps other account/host pending hints independent and refuses to evict older uncertainty',()=>{
  const {view}=mockStorage(),now=1800000000000;
  for(let n=0;n<8;n++){
    expect(rememberUncertainMoment(view,'fixe',String(n),{id:uuid,kind:n%2?'clip':'marker'},now)).toBe(true);
  }
  expect(rememberUncertainMoment(view,'fixe','9',{id:uuid,kind:'clip'},now)).toBe(false);
  expect(loadUncertainMoment(view,'fixe','0',now)?.kind).toBe('marker');
  expect(clearUncertainMoment(view,'fixe','5',now)).toBe(true);
  expect(rememberUncertainMoment(view,'fixe','9',{id:uuid,kind:'clip'},now)).toBe(true);
  expect(loadUncertainMoment(view,'fixe','0',now)?.kind).toBe('marker');
});
it('F04 never overwrites an unresolved receipt from the same host/account with a new POST UUID',()=>{
  const {view,data}=mockStorage(),now=1800000000000;
  const newer='743e0c2b-e8e4-4ccd-a82c-8ad0a05f19c5';
  expect(rememberUncertainMoment(view,'https://fixe','dam',{id:uuid,kind:'clip'},now)).toBe(true);
  const original=[...data.values()][0];
  // A fresh preview must not erase a possibly executed Twitch command.
  expect(rememberUncertainMoment(view,'https://fixe','dam',{id:newer,kind:'marker'},now+1000)).toBe(false);
  expect(rememberUncertainMoment(view,'https://fixe','dam',{id:uuid,kind:'clip'},now+1000)).toBe(false);
  expect([...data.values()][0]).toBe(original);
  expect(loadUncertainMoment(view,'https://fixe','dam',now+1000)).toEqual({id:uuid,kind:'clip'});
  expect(clearUncertainMoment(view,'https://fixe','dam',now+1000)).toBe(true);
  expect(rememberUncertainMoment(view,'https://fixe','dam',{id:newer,kind:'marker'},now+1000)).toBe(true);
  expect(loadUncertainMoment(view,'https://fixe','dam',now+1000)).toEqual({id:newer,kind:'marker'});
});
it('F04 expires bounded local hints; invalid UUID and unavailable storage fail closed before sending',()=>{
  const {view,data}=mockStorage(),now=1800000000000;
  expect(rememberUncertainMoment(view,'fixe','dam',{id:'not-uuid',kind:'clip'},now)).toBe(false);
  expect(rememberUncertainMoment(view,'fixe','dam',{id:uuid,kind:'clip'},now)).toBe(true);
  expect(loadUncertainMoment(view,'fixe','dam',now+7*24*60*60*1000)).toBeNull();
  expect(rememberUncertainMoment(view,'fixe','dam',{id:uuid,kind:'marker'},now+7*24*60*60*1000)).toBe(true);
  expect(loadUncertainMoment(view,'fixe','dam',now+7*24*60*60*1000)?.kind).toBe('marker');
  expect(rememberUncertainMoment(view,'fixe','', {id:uuid,kind:'clip'},now)).toBe(false);
  const blocked={get localStorage():never{throw Error('DISABLED')}};
  expect(rememberUncertainMoment(blocked,'fixe','dam',{id:uuid,kind:'clip'},now)).toBe(false);
  expect(loadUncertainMoment(blocked,'fixe','dam',now)).toBeNull();
  data.set('sd3.f04.twitch-moment-uncertain.v1','bad-json');
  expect(rememberUncertainMoment(view,'fixe','dam',{id:uuid,kind:'clip'},now)).toBe(false);
});

it('F04 fails closed when another stored row is malformed instead of silently evicting it',()=>{
  const {view,data}=mockStorage(),now=1800000000000;
  const key='sd3.f04.twitch-moment-uncertain.v1';
  expect(rememberUncertainMoment(view,'fixe','dam',{id:uuid,kind:'clip'},now)).toBe(true);
  const valid=JSON.parse(data.get(key)!) as {version:number;rows:Record<string,unknown>[]};
  for(const malformed of [
    {source:'fixe',account:'other',id:'bad-uuid',kind:'clip',createdAt:now},
    {source:'fixe',account:'other',id:uuid,kind:'unknown-kind',createdAt:now},
    {source:'fixe',account:'other',id:uuid,kind:'clip',createdAt:now+60000},
    {source:'fixe',account:'other',id:uuid,kind:'clip',createdAt:'not-a-number'},
    {source:'fixe',account:'other',id:uuid,kind:'clip'},
    {source:'fixe',account:'other',id:uuid,kind:'clip',createdAt:now,token:'MUST_NOT_COPY'},
  ]){
    const raw=JSON.stringify({...valid,rows:[...valid.rows,malformed]});
    data.set(key,raw);
    expect(loadUncertainMoment(view,'fixe','dam',now)).toBeNull();
    expect(rememberUncertainMoment(view,'fixe','new-account',{id:uuid,kind:'marker'},now)).toBe(false);
    expect(data.get(key)).toBe(raw); // never discard potentially executed commands
  }
});
it('F04 rejects ambiguous duplicate host/account rows before accepting new Twitch confirmations',()=>{
  const {view,data}=mockStorage(),now=1800000000000,key='sd3.f04.twitch-moment-uncertain.v1';
  expect(rememberUncertainMoment(view,'fixe','dam',{id:uuid,kind:'clip'},now)).toBe(true);
  const valid=JSON.parse(data.get(key)!) as {version:number;rows:Record<string,unknown>[]};
  const raw=JSON.stringify({...valid,rows:[...valid.rows,{...valid.rows[0],id:'743e0c2b-e8e4-4ccd-a82c-8ad0a05f19c5'}]});
  data.set(key,raw);
  expect(loadUncertainMoment(view,'fixe','dam',now)).toBeNull();
  expect(rememberUncertainMoment(view,'fixe','new-account',{id:uuid,kind:'marker'},now)).toBe(false);
  expect(data.get(key)).toBe(raw);
});

it('F04 read-only diagnosis distinguishes corrupt or inaccessible storage without discarding any confirmation UUID',()=>{
  const {view,data}=mockStorage(),now=1800000000000,key='sd3.f04.twitch-moment-uncertain.v1';
  expect(diagnoseUncertainMomentStore(view,'fixe','dam',now)).toEqual({state:'clear'});
  expect(rememberUncertainMoment(view,'fixe','dam',{id:uuid,kind:'clip'},now)).toBe(true);
  const good=data.get(key)!;
  expect(diagnoseUncertainMomentStore(view,'fixe','dam',now)).toEqual({state:'pending',receipt:{id:uuid,kind:'clip'}});
  expect(diagnoseUncertainMomentStore(view,'fixe','other',now)).toEqual({state:'clear'});
  expect(data.get(key)).toBe(good);
  expect(diagnoseUncertainMomentStore(view,'fixe','dam',now+7*24*60*60*1000)).toEqual({state:'clear'});
  expect(data.get(key)).toBe(good); // inspection does not perform expiry cleanup
  for(const invalid of ['{',JSON.stringify({version:1,rows:[{source:'fixe',account:'dam',id:'bad',kind:'clip',createdAt:now}]})]){
    data.set(key,invalid);
    expect(diagnoseUncertainMomentStore(view,'fixe','dam',now)).toEqual({state:'blocked'});
    expect(diagnoseUncertainMomentStore(view,'other','user',now)).toEqual({state:'blocked'});
    expect(data.get(key)).toBe(invalid);
  }
  expect(diagnoseUncertainMomentStore({get localStorage():never{throw Error('denied')}},'fixe','dam',now)).toEqual({state:'blocked'});
  expect(diagnoseUncertainMomentStore({localStorage:{getItem(){throw Error('denied')},setItem(){throw Error('NEVER')}}},'fixe','dam',now)).toEqual({state:'blocked'});
  expect(diagnoseUncertainMomentStore(view,'','dam',now)).toEqual({state:'blocked'});
});
