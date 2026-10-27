import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createDeviceServices} from '../../apps/mobile/control/device-services.js';

// Android device cloud service is Twitch-only; old YouTube preparation tests
// archived in docs/legacy-tests for traceability.
const metadata=()=>({title:'Le Feu de Camp',description:'Direct',twitchGameId:'123',
  youtubeCategoryId:'20',tags:['Gaming']});
const body=(id='twitch_meta_001',action='metadata.apply')=>({
 id,issuedAt:new Date().toISOString(),action,expectedRevision:2,metadata:metadata(),
});
function fixture(){
 const record={workspace:'local:android',drafts:{}};
 const config={revision:2,outputs:{twitch:{kind:'main',name:''}},metadata:metadata()};
 const calls=[];let mode='normal',cloudEnabled=true;
 const store={
  record,
  async reload(){},
  view:()=>({data:{configuration:structuredClone(config)},extras:{discord:{}}}),
  async draft(key,value){record.drafts[key]=structuredClone(value)},
  async updateDraft(key,update){record.drafts[key]=structuredClone(update(record.drafts[key]))},
  async journalRead(name,id){return structuredClone(record.drafts[name]?.[id])},
  async journalClaim(name,id,value){
   const previous=record.drafts[name]?.[id];
   if(previous)return {created:false,value:structuredClone(previous)};
   (record.drafts[name]??={})[id]=structuredClone(value);
   return {created:true,value};
  },
  async journalSave(name,id,value){(record.drafts[name]??={})[id]=structuredClone(value)},
 };
 const bridge={platformService:async raw=>{
   const command=JSON.parse(raw);calls.push(command);
   if(mode==='lost')throw new Error('Native acknowledgement lost');
   if(mode==='quota')return JSON.stringify({ok:false,code:'quotaExceeded',message:'Quota Twitch'});
   if(mode==='denied')return JSON.stringify({ok:false,code:'HTTP_403',message:'Twitch refused credentials'});
   return JSON.stringify({ok:true});
 }};
 const service=()=>createDeviceServices({store,bridge,enabled:()=>cloudEnabled});
 return {record,store,calls,service,setMode:v=>mode=v,setCloud:v=>cloudEnabled=v,config};
}
test('Twitch metadata applies once and a repeated ID returns the saved receipt',async()=>{
 const f=fixture(),input=body();
 const original=await f.service().route('/api/v2/actions',input,'POST');
 assert.equal(original.status,'succeeded');
 assert.equal(original.platforms.twitch.status,'succeeded');
 assert.equal(f.calls.length,1);
 assert.equal(f.calls[0].operation,'twitch.metadata');
 assert.deepEqual(f.record.drafts.metadata,input.metadata);
 const again=await f.service().route('/api/v2/actions',input,'POST');
 assert.deepEqual(again,original);
 assert.equal(f.calls.length,1);
 assert.equal(f.record.drafts.deviceReceipts.length,1);
});
test('reusing an ID with changed metadata is rejected before a native write',async()=>{
 const f=fixture(),input=body();
 await f.service().route('/api/v2/actions',input,'POST');
 await assert.rejects(
   f.service().route('/api/v2/actions',{...input,metadata:{...input.metadata,title:'Other'}},'POST'),
   /réutilisé/);
 assert.equal(f.calls.length,1);
});
test('expired, invalid, or stale revision instructions never call the bridge',async()=>{
 const f=fixture();
 await assert.rejects(f.service().route('/api/v2/actions',{...body(),id:'x'},'POST'),/invalide/);
 await assert.rejects(f.service().route('/api/v2/actions',{...body(),issuedAt:'2025-01-01T00:00:00Z'},'POST'),/expirée/);
 await assert.rejects(f.service().route('/api/v2/actions',{...body(),expectedRevision:1},'POST'),/Configuration modifiée/);
 assert.equal(f.calls.length,0);
});
test('YouTube endpoints and directed metadata remain disabled with no cloud effect',async()=>{
 const f=fixture();
 for(const route of ['/api/v2/youtube/prepare','/api/v2/youtube/channels','/api/v2/youtube/metadata']){
  await assert.rejects(f.service().route(route,{},'POST'),/YouTube est désactivé/);
 }
 await assert.rejects(f.service().route('/api/v2/actions',{...body(),platform:'youtube'},'POST'),/Plateforme invalide/);
 assert.equal(f.calls.length,0);
});
test('cloud role disabled is a definite failure without attempting Twitch',async()=>{
 const f=fixture();f.setCloud(false);
 const result=await f.service().route('/api/v2/actions',body(),'POST');
 assert.equal(result.status,'failed');
 assert.equal(result.platforms.twitch.status,'failed');
 assert.equal(f.calls.length,0);
 assert.deepEqual(f.record.drafts.metadata,metadata());
});
test('Twitch quota keeps draft pending with Twitch-specific message, never retries blindly',async()=>{
 const f=fixture();f.setMode('quota');
 const input=body(),first=await f.service().route('/api/v2/actions',input,'POST');
 assert.equal(first.status,'pending');
 assert.equal(first.platforms.twitch.status,'pending');
 assert.match(first.platforms.twitch.message,/quota Twitch/);
 assert.doesNotMatch(first.platforms.twitch.message,/YouTube/);
 assert.deepEqual(f.record.drafts.metadata,metadata());
 f.setMode('normal');
 const again=await f.service().route('/api/v2/actions',input,'POST');
 assert.deepEqual(again,first);
 assert.equal(f.calls.length,1);
});
test('definite 403 denies rather than fabricating an uncertain dispatched command',async()=>{
 const f=fixture();f.setMode('denied');
 const result=await f.service().route('/api/v2/actions',body(),'POST');
 assert.equal(result.status,'failed');
 assert.equal(result.platforms.twitch.status,'failed');
 assert.equal(f.calls.length,1);
});
test('lost acknowledgement is uncertain and replay never repeats the native side effect',async()=>{
 const f=fixture();f.setMode('lost');const input=body();
 const first=await f.service().route('/api/v2/actions',input,'POST');
 assert.equal(first.status,'uncertain');
 assert.equal(first.platforms.twitch.status,'uncertain');
 f.setMode('normal');
 const replay=await f.service().route('/api/v2/actions',input,'POST');
 assert.deepEqual(replay,first);
 assert.equal(f.calls.length,1);
});
test('manual retry requires Twitch selection and an explicit confirmation',async()=>{
 const f=fixture();f.setMode('quota');
 await f.service().route('/api/v2/actions',body(),'POST');
 f.setMode('normal');
 await assert.rejects(f.service().route('/api/v2/actions',body('retry_meta_01','metadata.retry'),'POST'),/Relisez et confirmez/);
 const input={...body('retry_meta_02','metadata.retry'),platform:'twitch',confirmed:true};
 const retry=await f.service().route('/api/v2/actions',input,'POST');
 assert.equal(retry.status,'succeeded');
 assert.equal(f.calls.length,2);
 assert.equal(f.calls.at(-1).operation,'twitch.metadata');
});
