import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { normalizeStreamlabsEvents } from '../integrations/streamlabs/src/events.js';
import { StreamlabsFeed } from '../apps/server/src/streamlabs-feed.js';
import { startDashboardServer, type DashboardServerHandle } from '../apps/server/src/index.js';
import { MemorySecretStore } from '../apps/server/src/storage.js';
import { isRemoteApiAllowed } from '../apps/server/src/remote-api-policy.js';

const packet=(type='follow',id='first')=>({for:'twitch_account',type,message:[{_id:id,name:'Ada',message:'GG'}]});
describe('Streamlabs event feed',()=>{
 it('keeps provider identities, YouTube micro amounts, gifts and test markers without raw credentials',()=>{
  const original=packet();const events=normalizeStreamlabsEvents(original);
  expect(events[0]).toMatchObject({platform:'twitch',type:'follow',displayName:'Ada'});
  expect(normalizeStreamlabsEvents(original,new Date(0))[0].id).toBe(events[0].id);
  expect(normalizeStreamlabsEvents({...original,type:'raid'})[0].id).not.toBe(events[0].id);
  expect(normalizeStreamlabsEvents({for:'youtube_account',type:'superchat',message:[{_id:'yt',amount:'2000000',currency:'USD',comment:'Hello',access_token:'secret'}]})[0]).toMatchObject({amount:2,currency:'USD',message:'Hello'});
  const gift=normalizeStreamlabsEvents({for:'twitch_account',type:'subscription',isTest:true,message:[{_id:'g',name:'Ada',sub_type:'gift',recipient:'Dam',months:3,secret:'hidden'}]})[0];
  expect(gift).toMatchObject({recipient:'Dam',months:3,test:true});expect(JSON.stringify(gift)).not.toContain('hidden');
  expect(normalizeStreamlabsEvents({type:'follow',message:[{}]})[0].id).not.toBe(normalizeStreamlabsEvents({type:'follow',message:[{}]})[0].id);
 });
 it('serializes duplicates, retains bounded history, survives restart and does not acknowledge failed persistence',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'sl-feed-'));
  try{
   const file=path.join(dir,'feed.json');const feed=await StreamlabsFeed.open(file);
   const first=normalizeStreamlabsEvents(packet());await Promise.all([feed.record(first),feed.record(first)]);
   expect(feed.list()).toHaveLength(1);
   const batch=Array.from({length:1003},(_,i)=>normalizeStreamlabsEvents(packet('bits','id-'+i))[0]);
   await feed.record(batch);expect(feed.list()).toHaveLength(1000);
   const restored=await StreamlabsFeed.open(file);expect(restored.list()[0].id).toBe(batch.at(-1)?.id);
   expect(JSON.parse(await readFile(file,'utf8')).items).toHaveLength(1000);
   const write=vi.spyOn((feed as unknown as {store:{write():Promise<void>}}).store,'write').mockRejectedValueOnce(new Error('disk full'));
   const next=normalizeStreamlabsEvents(packet('raid','failed'));await expect(feed.record(next)).rejects.toThrow('disk full');
   expect(feed.list().some(e=>e.id===next[0].id)).toBe(false);write.mockRestore();
   await feed.record(next);expect(feed.list()[0].id).toBe(next[0].id);
  }finally{await rm(dir,{recursive:true,force:true});}
 });
 it('serves the same received activity to readers, restores it, and keeps independent runtimes isolated',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'sl-api-'));const active:DashboardServerHandle[]=[];
  try{
   const secrets=new MemorySecretStore();await secrets.setStreamlabsToken('private-token');
   let receive:((value:unknown)=>void)|undefined;
   const host=await startDashboardServer({port:0,dataDir:path.join(dir,'host'),obsEnabled:false,secretStore:secrets,streamlabsTransport:{connect:async(_token,_tip,_disconnect,event)=>{receive=event;return async()=>{};}},logger:{info(){},warn(){},error(){}}});active.push(host);
   await vi.waitFor(()=>expect(receive).toBeTypeOf('function'));
   receive!(packet('raid'));receive!(packet('raid'));
   const read=()=>fetch(host.url+'/api/v1/streamlabs/events').then(r=>r.json());
   await vi.waitFor(async()=>expect((await read()).items).toHaveLength(1));
   const [streamPC,gamePC]=await Promise.all([read(),read()]);expect(streamPC).toEqual(gamePC);expect(streamPC.provider.status).toBe('CONNECTED');expect(JSON.stringify(streamPC)).not.toContain('private-token');
   expect(isRemoteApiAllowed('GET','/v1/streamlabs/events')).toBe(true);expect(isRemoteApiAllowed('POST','/v1/streamlabs/events')).toBe(false);
   await host.stop();active.pop();
   const restored=await startDashboardServer({port:0,dataDir:path.join(dir,'host'),obsEnabled:false,logger:{info(){},warn(){},error(){}}});active.push(restored);
   expect((await fetch(restored.url+'/api/v1/streamlabs/events').then(r=>r.json())).items).toHaveLength(1);
   const independent=await startDashboardServer({port:0,dataDir:path.join(dir,'game'),obsEnabled:false,logger:{info(){},warn(){},error(){}}});active.push(independent);
   const own=await fetch(independent.url+'/api/v1/streamlabs/events').then(r=>r.json());expect(own.items).toHaveLength(0);expect(own.provider.status).toBe('NOT_CONFIGURED');
  }finally{for(const app of active)await app.stop();await rm(dir,{recursive:true,force:true});}
 });
});
