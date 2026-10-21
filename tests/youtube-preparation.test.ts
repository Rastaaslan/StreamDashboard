import {afterEach,describe,it,expect,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {MemorySecretStore,AtomicJsonStore} from '../apps/server/src/storage.js';
import {YouTubeClient} from '../integrations/youtube/src/client.js';
import {YouTubePreparationService,type BroadcastPreparation} from '../integrations/youtube/src/preparation.js';
import {isRemoteApiAllowed,requiredDevicePermissions} from '../apps/server/src/remote-api-policy.js';
const directories:string[]=[];
afterEach(async()=>{for(const dir of directories.splice(0))await rm(dir,{recursive:true,force:true});});
const input=():BroadcastPreparation=>({id:crypto.randomUUID(),channelId:'channel-test',streamId:'reusable-stream',scheduledStartTime:new Date(Date.now()+3600000).toISOString(),privacyStatus:'unlisted',madeForKids:false,metadata:{title:'Prochain live',description:'Description',twitchGameId:'27471',youtubeCategoryId:'20',tags:['Minecraft']}});
async function fixture(options:{failure?:'create-network'|'create-403'|'bind'|'metadata'|'flags';foreign?:boolean;change?:boolean}={}){
 const dir=await mkdtemp(path.join(tmpdir(),'sd-prepare-'));directories.push(dir);
 const file=path.join(dir,'journal.json'),value=input(),calls:Array<{url:URL;init:RequestInit}>=[];
 const selection={clientId:'test-client',broadcastId:'currentLive',channelId:'channel-test'};
 const original=structuredClone(selection),secrets=new MemorySecretStore();
 await secrets.setYouTubeTokens({clientId:'test-client',refreshToken:'PRIVATE_REFRESH',accessToken:'PRIVATE_ACCESS',expiresAt:String(Date.now()+3600000)});
 const created={id:'newLive1234',snippet:{channelId:value.channelId},status:{lifeCycleStatus:'ready',privacyStatus:value.privacyStatus,selfDeclaredMadeForKids:false},contentDetails:{boundStreamId:value.streamId,enableAutoStart:false,enableAutoStop:false}};
 const request:typeof fetch=async(url,init={})=>{
  const u=new URL(String(url));calls.push({url:u,init});
  if(u.pathname.endsWith('/channels'))return Response.json({items:[{id:options.foreign?'other-channel':value.channelId,snippet:{title:'Chaîne QA'}}]});
  if(u.pathname.endsWith('/liveStreams'))return Response.json({items:[{id:value.streamId,snippet:{title:'OBS',channelId:value.channelId},status:{streamStatus:'active'},contentDetails:{isReusable:true},cdn:{ingestionInfo:{streamName:'PRIVATE_KEY'}}},{id:'non-reusable',snippet:{title:'old',channelId:value.channelId},status:{streamStatus:'inactive'},contentDetails:{isReusable:false}}]});
  if(u.pathname.endsWith('/liveBroadcasts')&&init.method==='POST'){
   if(options.failure==='create-network')throw Error('PRIVATE_PROVIDER_ERROR');
   if(options.failure==='create-403')return Response.json({error:{errors:[{reason:'liveStreamingNotEnabled'}]}},{status:403});
   if(options.change)selection.clientId='replaced-client';
   return Response.json(created);
  }
  if(u.pathname.endsWith('/liveBroadcasts/bind')){if(options.failure==='bind')throw Error('lost response');return Response.json(created);}
  if(u.pathname.endsWith('/videos'))return init.method==='PUT'?Response.json({}):Response.json({items:[{id:created.id,snippet:{channelId:value.channelId,title:options.failure==='metadata'?'wrong':value.metadata.title,description:value.metadata.description,categoryId:value.metadata.youtubeCategoryId,tags:value.metadata.tags}}]});
  if(u.pathname.endsWith('/liveBroadcasts'))return Response.json({items:[{...created,contentDetails:{...created.contentDetails,enableAutoStart:options.failure==='flags'}}]});
  throw Error('Unexpected request '+u);
 };
 const client=new YouTubeClient(secrets,()=>selection,request),service=YouTubePreparationService.open(file,client);
 return {file,value,selection,original,calls,client,service};
}
const mutations=(f:Awaited<ReturnType<typeof fixture>>)=>f.calls.filter(c=>c.init.method==='POST'||c.init.method==='PUT');
describe('YouTube preparation',()=>{
 it('creates, binds and verifies metadata without selecting or starting a live; never exposes stream keys',async()=>{
  const f=await fixture();const result=await f.service.prepare(f.value);
  expect(result).toMatchObject({status:'succeeded',broadcastId:'newLive1234',phase:'verified'});
  expect(f.selection).toEqual(f.original);
  expect(mutations(f).map(c=>c.url.pathname)).toEqual(['/youtube/v3/liveBroadcasts','/youtube/v3/liveBroadcasts/bind','/youtube/v3/videos']);
  expect(JSON.parse(String(mutations(f)[0].init.body))).toMatchObject({status:{privacyStatus:'unlisted',selfDeclaredMadeForKids:false},contentDetails:{enableAutoStart:false,enableAutoStop:false,monitorStream:{enableMonitorStream:false}}});
  expect(JSON.stringify(await f.client.streams())).not.toMatch(/PRIVATE|cdn|ingestionInfo|non-reusable/);
  expect(f.calls.filter(c=>c.url.pathname.endsWith('/liveStreams')).every(c=>!c.url.searchParams.get('part')?.includes('cdn'))).toBe(true);
 });
 it('coalesces concurrent duplicates and survives a restart without repeating inserts',async()=>{
  const f=await fixture();const [a,b]=await Promise.all([f.service.prepare(f.value),f.service.prepare(f.value)]);
  expect(a).toEqual(b);expect(await YouTubePreparationService.open(f.file,f.client).prepare(f.value)).toEqual(a);
  expect(mutations(f)).toHaveLength(3);
  await expect(f.service.prepare({...f.value,metadata:{...f.value.metadata,title:'changed'}})).rejects.toThrow('autres paramètres');
 });
 it.each(['create-network','create-403','bind','metadata','flags'] as const)('journals %s without replaying external changes',async failure=>{
  const f=await fixture({failure});const a=await f.service.prepare(f.value),count=mutations(f).length;
  expect(a.status).toBe(failure==='create-network'?'uncertain':failure==='create-403'?'failed':'partial');
  expect(JSON.stringify(a)).not.toContain('PRIVATE');
  expect(await YouTubePreparationService.open(f.file,f.client).prepare(f.value)).toEqual(a);
  expect(mutations(f)).toHaveLength(count);
 });
 it('rejects wrong accounts, missing streams, invalid data and stale permissions before insert',async()=>{
  const f=await fixture({foreign:true});expect((await f.service.prepare(f.value)).status).toBe('failed');expect(mutations(f)).toHaveLength(0);
  const g=await fixture();expect((await g.service.prepare({...g.value,streamId:'missing'})).status).toBe('failed');
  await expect(g.service.prepare({...g.value,madeForKids:undefined} as unknown as BroadcastPreparation)).rejects.toThrow('public');
  await expect(g.service.prepare({...g.value,id:crypto.randomUUID(),scheduledStartTime:'2000-01-01'})).rejects.toThrow('future');
  await expect(g.service.prepare({...g.value,id:crypto.randomUUID()},async()=>{throw Error('permission revoked');})).rejects.toThrow('revoked');
  expect(mutations(g)).toHaveLength(0);
 });
 it('checks permissions again after provider reads and before creation',async()=>{
  const f=await fixture(),guard=vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(Error('permission revoked'));
  expect((await f.service.prepare(f.value,guard)).status).toBe('failed');expect(mutations(f)).toHaveLength(0);
 });
 it('does not bind after the connection changes during creation',async()=>{
  const f=await fixture({change:true});expect((await f.service.prepare(f.value)).status).toBe('uncertain');expect(mutations(f)).toHaveLength(1);
 });
 it('requires a durable journal before the first external mutation',async()=>{
  const f=await fixture();const store=new AtomicJsonStore<any>(f.file);vi.spyOn(store,'write').mockRejectedValue(Error('disk full'));
  await expect(new YouTubePreparationService(store,f.client).prepare(f.value)).rejects.toThrow('disk full');expect(f.calls).toHaveLength(0);
 });
 it('treats interrupted running entries as uncertain after restart',async()=>{
  const f=await fixture(),store=new AtomicJsonStore<any>(f.file),original=store.write.bind(store);let writes=0;
  vi.spyOn(store,'write').mockImplementation(async value=>{if(++writes>2)throw Error('disk unavailable');await original(value);});
  await expect(new YouTubePreparationService(store,f.client).prepare(f.value)).rejects.toThrow();
  const count=mutations(f).length;expect((await YouTubePreparationService.open(f.file,f.client).prepare(f.value)).status).toBe('uncertain');expect(mutations(f)).toHaveLength(count);
 });
 it('grants preparation only through the existing cloud permission policy',()=>{
  expect(isRemoteApiAllowed('POST','/v2/youtube/prepare')).toBe(true);expect(isRemoteApiAllowed('GET','/v2/youtube/streams')).toBe(true);
  expect(requiredDevicePermissions('POST','/v2/youtube/prepare',{})).toEqual(['cloud']);expect(isRemoteApiAllowed('DELETE','/v2/youtube/prepare')).toBe(false);
 });
});
