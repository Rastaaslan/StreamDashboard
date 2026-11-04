import {it,expect} from 'vitest';
import {loadUncertainMoment,rememberUncertainMoment,clearUncertainMoment,diagnoseUncertainMomentStore,recoverUncertainMomentForReview,readUncertainMomentBackup,describeUncertainMomentIssue} from '../apps/mobile/control/streamcockpit-twitch-moment-pending.js';
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
  expect(clearUncertainMoment(view,'https://fixe','dam',{id:uuid,kind:'clip'},now)).toBe(true);
  expect(loadUncertainMoment(view,'https://fixe','dam',now)).toBeNull();
});
it('F04 keeps other account/host pending hints independent and refuses to evict older uncertainty',()=>{
  const {view}=mockStorage(),now=1800000000000;
  for(let n=0;n<8;n++){
    expect(rememberUncertainMoment(view,'fixe',String(n),{id:uuid,kind:n%2?'clip':'marker'},now)).toBe(true);
  }
  expect(rememberUncertainMoment(view,'fixe','9',{id:uuid,kind:'clip'},now)).toBe(false);
  expect(loadUncertainMoment(view,'fixe','0',now)?.kind).toBe('marker');
  expect(clearUncertainMoment(view,'fixe','5',{id:uuid,kind:'clip'},now)).toBe(true);
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
  expect(clearUncertainMoment(view,'https://fixe','dam',{id:uuid,kind:'clip'},now+1000)).toBe(true);
  expect(rememberUncertainMoment(view,'https://fixe','dam',{id:newer,kind:'marker'},now+1000)).toBe(true);
  expect(loadUncertainMoment(view,'https://fixe','dam',now+1000)).toEqual({id:newer,kind:'marker'});
});
it('F04 expires bounded local hints; invalid UUID and unavailable storage fail closed before sending',()=>{
  const {view,data}=mockStorage(),now=1800000000000;
  expect(rememberUncertainMoment(view,'fixe','dam',{id:'not-uuid',kind:'clip'},now)).toBe(false);
  expect(rememberUncertainMoment(view,'fixe','dam',{id:uuid,kind:'clip'},now)).toBe(true);
  expect(loadUncertainMoment(view,'fixe','dam',now+7*24*60*60*1000)).toBeNull();
  // Expiry ends trusted lookup, but cannot silently purge an executed provider UUID.
  expect(diagnoseUncertainMomentStore(view,'fixe','dam',now+7*24*60*60*1000)).toEqual({state:'blocked'});
  expect(rememberUncertainMoment(view,'fixe','dam',{id:uuid,kind:'marker'},now+7*24*60*60*1000)).toBe(false);
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
it('F04 refuses unknown top-level journal fields and preserves every byte for manual reconciliation',()=>{
  const {view,data}=mockStorage(),now=1800000000000,key='sd3.f04.twitch-moment-uncertain.v1';
  expect(rememberUncertainMoment(view,'FIXE','owner',{id:uuid,kind:'clip'},now)).toBe(true);
  const existing=JSON.parse(data.get(key)!) as {version:number;rows:Record<string,unknown>[]};
  const raw=JSON.stringify({...existing,unrecognized:{originalReceipt:'KEEP_UNEXPECTED_UUID',token:'NEVER_PUBLISH'}});
  data.set(key,raw);
  expect(diagnoseUncertainMomentStore(view,'FIXE','owner',now)).toEqual({state:'blocked'});
  expect(loadUncertainMoment(view,'FIXE','owner',now)).toBeNull();
  expect(recoverUncertainMomentForReview(view,'FIXE','owner',now)).toBeNull();
  expect(rememberUncertainMoment(view,'FIXE','other',{id:uuid,kind:'marker'},now)).toBe(false);
  expect(clearUncertainMoment(view,'FIXE','owner',{id:uuid,kind:'clip'},now)).toBe(false);
  expect(data.get(key)).toBe(raw);
  expect(readUncertainMomentBackup(view)).toBe(raw);
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
  expect(diagnoseUncertainMomentStore(view,'fixe','dam',now+7*24*60*60*1000)).toEqual({state:'blocked'});
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

it('F04 stale tab cannot erase a newer uncertain receipt for the same host/account',()=>{
  const {view,data}=mockStorage(),now=1800000000000;
  const newer='743e0c2b-e8e4-4ccd-a82c-8ad0a05f19c5';
  const old={id:uuid,kind:'clip' as const},fresh={id:newer,kind:'marker' as const};
  expect(rememberUncertainMoment(view,'fixe','dam',old,now)).toBe(true);
  expect(clearUncertainMoment(view,'fixe','dam',old,now)).toBe(true);
  expect(rememberUncertainMoment(view,'fixe','dam',fresh,now+1)).toBe(true);
  const journal=[...data.values()][0];
  // Tab A receives an old successful HTTP response after tab B has confirmed and started a new request.
  expect(clearUncertainMoment(view,'fixe','dam',old,now+2)).toBe(false);
  expect(data.get('sd3.f04.twitch-moment-uncertain.v1')).toBe(journal);
  expect(loadUncertainMoment(view,'fixe','dam',now+2)).toEqual(fresh);
  expect(clearUncertainMoment(view,'fixe','dam',{id:newer,kind:'clip'},now+2)).toBe(false);
  expect(clearUncertainMoment(view,'fixe','dam',undefined as never,now+2)).toBe(false);
  expect(loadUncertainMoment(view,'fixe','dam',now+2)).toEqual(fresh);
  expect(clearUncertainMoment(view,'fixe','dam',fresh,now+2)).toBe(true);
});


it('F04 corrupt journal permits only scoped read-only review of a unique valid receipt, never mutation or recovery authorization',()=>{
  const {view,data}=mockStorage(),now=1800000000000,key='sd3.f04.twitch-moment-uncertain.v1';
  expect(rememberUncertainMoment(view,'FIXE','owner',{id:uuid,kind:'clip'},now)).toBe(true);
  const good=JSON.parse(data.get(key)!) as {version:number;rows:Record<string,unknown>[]};
  const raw=JSON.stringify({version:1,rows:[...good.rows,{source:'FIXE',account:'someone-else',id:'invalid',kind:'marker',createdAt:now}]});
  data.set(key,raw);
  expect(diagnoseUncertainMomentStore(view,'FIXE','owner',now)).toEqual({state:'blocked'});
  expect(recoverUncertainMomentForReview(view,'FIXE','owner',now)).toEqual({id:uuid,kind:'clip'});
  expect(recoverUncertainMomentForReview(view,'FIXE','another',now)).toBeNull();
  expect(rememberUncertainMoment(view,'FIXE','owner',{id:uuid,kind:'clip'},now)).toBe(false);
  expect(clearUncertainMoment(view,'FIXE','owner',{id:uuid,kind:'clip'},now)).toBe(false);
  expect(data.get(key)).toBe(raw);
  for(const rows of [[...good.rows,{...good.rows[0]}],[{...good.rows[0],id:'bad'},...good.rows]]){
    data.set(key,JSON.stringify({version:1,rows}));
    expect(recoverUncertainMomentForReview(view,'FIXE','owner',now)).toBeNull();
  }
  for(const invalid of ['{broken',JSON.stringify({version:2,rows:good.rows})]){
    data.set(key,invalid);
    expect(recoverUncertainMomentForReview(view,'FIXE','owner',now)).toBeNull();
  }
  data.set(key,raw);
  expect(recoverUncertainMomentForReview(view,'FIXE','owner',now+7*24*60*60*1000)).toBeNull();
  expect(data.get(key)).toBe(raw);
});

it('F04 forensic backup reads exact corrupt bytes only on request, without modifying or parsing the journal',()=>{
  const {view,data}=mockStorage(),key='sd3.f04.twitch-moment-uncertain.v1';
  expect(readUncertainMomentBackup(view)).toBeNull();
  for(const raw of ['{truncated-json',JSON.stringify({version:1,rows:[{id:uuid,token:'SENSITIVE_DO_NOT_LOG'}]})]){
    data.set(key,raw);
    expect(readUncertainMomentBackup(view)).toBe(raw);
    expect(data.get(key)).toBe(raw);
  }
  data.set(key,'x'.repeat(1024*1024+1));
  expect(readUncertainMomentBackup(view)).toBeNull();
  expect(data.get(key)).toHaveLength(1024*1024+1);
  expect(readUncertainMomentBackup({get localStorage():never{throw Error('DENIED')}})).toBeNull();
  expect(readUncertainMomentBackup({localStorage:{getItem(){throw Error('DENIED')},setItem(){throw Error('WRITE_NOT_ALLOWED')}}})).toBeNull();
});

it('F04 diagnostic is strictly redacted and never reads another account into UI or rewrites a corrupt journal',()=>{
  const {view,data}=mockStorage(),now=1800000000000,key='sd3.f04.twitch-moment-uncertain.v1';
  const describe=()=>describeUncertainMomentIssue(view,'FIXE','owner',now);
  expect(describe()).toEqual({code:'clear'});
  expect(rememberUncertainMoment(view,'FIXE','owner',{id:uuid,kind:'clip'},now)).toBe(true);
  expect(describe()).toEqual({code:'pending'});
  const cases=[
    ['{PRIVATE_TOKEN_SHOULD_NOT_LEAK','corrupt-json'],
    [JSON.stringify({version:1,rows:[],otherAccount:'PRIVATE_TOKEN_SHOULD_NOT_LEAK'}),'unknown-schema'],
    [JSON.stringify({version:1,rows:[{source:'OTHER_PRIVATE',account:'SECRET_ACCOUNT',id:'invalid',kind:'marker',createdAt:now}]}),'invalid-rows'],
    ['x'.repeat(8193),'too-large'],
  ] as const;
  for(const [raw,code] of cases){
    data.set(key,raw);
    const diagnostic=describe();
    expect(diagnostic).toEqual({code});
    expect(JSON.stringify(diagnostic)).not.toMatch(/PRIVATE|SECRET|OTHER|643e0c2b|token/i);
    expect(data.get(key)).toBe(raw);
    expect(rememberUncertainMoment(view,'FIXE','owner',{id:uuid,kind:'marker'},now)).toBe(false);
  }
  expect(describeUncertainMomentIssue({localStorage:{getItem(){throw Error('TOP_SECRET')},setItem(){throw Error('NO')}}},'FIXE','owner',now)).toEqual({code:'unavailable'});
  expect(describeUncertainMomentIssue(view,'','owner',now)).toEqual({code:'unavailable'});
});

it('F04 rejects noncanonical duplicate JSON keys that hide older provider UUIDs without modifying evidence',()=>{
  const {view,data}=mockStorage(),now=1800000000000,key='sd3.f04.twitch-moment-uncertain.v1';
  const row={source:'FIXE',account:'owner',id:uuid,kind:'clip',createdAt:now};
  const different='743e0c2b-e8e4-4ccd-a82c-8ad0a05f19c5';
  const duplicatedRoot=`{"version":1,"rows":[${JSON.stringify(row)}],"rows":[]}`;
  const duplicatedRow=`{"version":1,"rows":[{"source":"FIXE","account":"owner","id":"${uuid}","id":"${different}","kind":"clip","createdAt":${now}}]}`;
  for(const raw of [duplicatedRoot,duplicatedRow]){
    data.set(key,raw);
    expect(describeUncertainMomentIssue(view,'FIXE','owner',now)).toEqual({code:'unknown-schema'});
    expect(diagnoseUncertainMomentStore(view,'FIXE','owner',now)).toEqual({state:'blocked'});
    expect(recoverUncertainMomentForReview(view,'FIXE','owner',now)).toBeNull();
    expect(rememberUncertainMoment(view,'FIXE','owner',{id:different,kind:'marker'},now)).toBe(false);
    expect(clearUncertainMoment(view,'FIXE','owner',{id:uuid,kind:'clip'},now)).toBe(false);
    expect(data.get(key)).toBe(raw);
    expect(readUncertainMomentBackup(view)).toBe(raw);
  }
});

it('F04 expired unresolved receipts cannot be silently pruned by a later Twitch admission or clear',()=>{
  const {view,data}=mockStorage(),now=1800000000000,key='sd3.f04.twitch-moment-uncertain.v1';
  expect(rememberUncertainMoment(view,'FIXE','other',{id:uuid,kind:'clip'},now)).toBe(true);
  const oldJournal=data.get(key)!;
  const later=now+7*24*60*60*1000;
  expect(diagnoseUncertainMomentStore(view,'FIXE','dam',later)).toEqual({state:'blocked'});
  expect(describeUncertainMomentIssue(view,'FIXE','dam',later)).toEqual({code:'expired-unreviewed'});
  expect(loadUncertainMoment(view,'FIXE','other',later)).toBeNull();
  expect(rememberUncertainMoment(view,'FIXE','dam',{id:'743e0c2b-e8e4-4ccd-a82c-8ad0a05f19c5',kind:'marker'},later)).toBe(false);
  expect(clearUncertainMoment(view,'FIXE','other',{id:uuid,kind:'clip'},later)).toBe(false);
  expect(data.get(key)).toBe(oldJournal);
  expect(readUncertainMomentBackup(view)).toBe(oldJournal);
});
