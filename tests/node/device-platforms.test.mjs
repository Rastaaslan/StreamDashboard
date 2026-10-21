import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeviceServices} from '../../apps/mobile/control/device-services.js';
function fixture(){
 const record={workspace:'local:test',drafts:{}},config={revision:2,youtube:{broadcastId:'broadcast01',channelId:'own_channel'}};
 const calls=[];let fail='',channel='own_channel',enabled=true;
 const store={record,reload:async()=>{},view:()=>({data:{configuration:structuredClone(config)}}),draft:async(k,v)=>{record.drafts[k]=structuredClone(v);},updateDraft:async(k,fn)=>{record.drafts[k]=structuredClone(fn(record.drafts[k]));}};
 const bridge={platformService:async raw=>{const value=JSON.parse(raw);calls.push(value);if(value.operation===fail)throw Error('Réponse perdue');if(value.operation==='youtube.create')assert.equal(record.drafts.youtubePreparations[value.id].receipt.phase,'creating');return JSON.stringify(value.operation==='youtube.channels'?{ok:true,items:[{id:channel}]}:value.operation==='youtube.streams'?{ok:true,items:[{id:'stream_own',channelId:channel}]}:value.operation==='youtube.create'?{ok:true,broadcastId:'broadcast01',channelId:channel}:{ok:true});}};
 return {store,config,calls,open:()=>createDeviceServices({store,bridge,enabled:()=>enabled}),fail:v=>fail=v,channel:v=>channel=v,enabled:v=>enabled=v};
}
const preparation=()=>({id:'prepare_android_001',expectedRevision:2,channelId:'own_channel',streamId:'stream_own',scheduledStartTime:new Date(Date.now()+300000).toISOString(),privacyStatus:'unlisted',madeForKids:false,metadata:{title:'Test privé',description:'',twitchGameId:'',youtubeCategoryId:'20',tags:[]}});
test('Android prepares and verifies YouTube without a Windows endpoint, and never repeats an ID',async()=>{
 const f=fixture(),body=preparation();const r=await f.open().route('/api/v2/youtube/prepare',body,'POST');assert.equal(r.status,'succeeded');assert.equal(r.broadcastId,'broadcast01');
 const before=f.calls.length;assert.deepEqual(await f.open().route('/api/v2/youtube/prepare',body,'POST'),r);assert.equal(f.calls.length,before);
 await assert.rejects(f.open().route('/api/v2/youtube/prepare',{...body,privacyStatus:'public'},'POST'),/paramètres/);
});
test('a lost creation response stays uncertain after reload instead of creating another broadcast',async()=>{
 const f=fixture(),body=preparation();f.fail('youtube.create');const r=await f.open().route('/api/v2/youtube/prepare',body,'POST');assert.equal(r.status,'uncertain');
 f.fail('');await f.open().route('/api/v2/youtube/prepare',body,'POST');assert.equal(f.calls.filter(v=>v.operation==='youtube.create').length,1);
});
test('known created broadcasts keep their identity when binding fails',async()=>{
 const f=fixture();f.fail('youtube.bind');const r=await f.open().route('/api/v2/youtube/prepare',preparation(),'POST');assert.equal(r.status,'partial');assert.equal(r.broadcastId,'broadcast01');assert.ok(!f.calls.some(v=>v.operation==='youtube.metadata'));
});
test('an account or revision change prevents the insertion',async()=>{
 const f=fixture();f.channel('another_channel');assert.equal((await f.open().route('/api/v2/youtube/prepare',preparation(),'POST')).status,'failed');assert.ok(!f.calls.some(v=>v.operation==='youtube.create'));
 await assert.rejects(f.open().route('/api/v2/youtube/prepare',{...preparation(),id:'revision_changed_1',expectedRevision:1},'POST'),/configuration/);
});
test('native metadata commands preserve partial results and durable deduplication',async()=>{
 const f=fixture();f.fail('youtube.metadata');const body={id:'metadata_native_1',action:'metadata.apply',issuedAt:new Date().toISOString(),expectedRevision:2,metadata:preparation().metadata};
 const r=await f.open().route('/api/v2/actions',body,'POST');assert.equal(r.status,'partial');assert.equal(r.platforms.twitch.status,'succeeded');assert.equal(f.store.record.drafts.metadata.title,body.metadata.title);
 const before=f.calls.length;await f.open().route('/api/v2/actions',body,'POST');assert.equal(f.calls.length,before);assert.equal(f.store.record.drafts.deviceReceipts.length,1);
});
test('disabled cloud role does not dispatch native platform requests',async()=>{
 const f=fixture();f.enabled(false);await assert.rejects(f.open().route('/api/v2/youtube/channels',undefined,'GET'),/désactivé/);assert.equal(f.calls.length,0);
});
