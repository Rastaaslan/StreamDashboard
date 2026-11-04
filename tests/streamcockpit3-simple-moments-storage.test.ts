import {it,expect} from 'vitest';
import {loadUncertainMoment,rememberUncertainMoment,clearUncertainMoment} from '../apps/mobile/control/streamcockpit-twitch-moment-pending.js';
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
