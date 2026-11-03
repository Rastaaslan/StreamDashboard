import {it,expect,vi} from 'vitest';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {startDashboardServer,type DashboardServerHandle} from '../apps/server/src/index.js';
import {MemorySecretStore} from '../apps/server/src/storage.js';
import {MomentsSqliteStorage} from '../apps/server/src/streamcockpit-moments-sqlite.js';
import {withMixerFixture} from './helpers/streamcockpit-mixer-fixture.js';
it('F09 complete runtime: socket receipt reaches durable timeline, readers agree, restart never duplicates or sends OBS commands',async()=>withMixerFixture(async f=>{
 await f.obs.close();
 const dataDir=join(f.directory,'moments-runtime');await mkdir(dataDir);
 const names=['OBS_URL','DATA_FILE','DISCORD_BOT_TOKEN','STREAMLABS_SOCKET_TOKEN']as const;
 const saved=Object.fromEntries(names.map(name=>[name,process.env[name]]));
 process.env.OBS_URL=f.obsUrl;process.env.DATA_FILE=join(dataDir,'dashboard.json');process.env.DISCORD_BOT_TOKEN='';process.env.STREAMLABS_SOCKET_TOKEN='';
 const secrets=new MemorySecretStore();await secrets.setStreamlabsToken('private-fixture-token');
 let receive:((value:unknown)=>void)|undefined,server:DashboardServerHandle|undefined;
 const start=async()=>{
  server=await startDashboardServer({port:0,dataDir,host:'127.0.0.1',obsEnabled:true,timerAuthority:true,twitchClientId:'',googleClientId:'',googleClientSecret:'',secretStore:secrets,
   streamlabsTransport:{connect:async(_token,_tip,_disconnect,event)=>{receive=event;return async()=>{receive=undefined}}},
   deviceDescriptor:async()=>({id:'fixe-moments-qa',name:'FIXE QA',platform:'windows',enabled:true,roles:['controller','obs-executor','display','services','audio'],capabilities:['obs','clips','audio','cloud','planning','chat','viewer','storage','global-keys']}),
   logger:{info(){},warn(){},error(){}},
  });
  await server.providersReady;await vi.waitFor(()=>expect(receive).toBeTypeOf('function'));
 };
 const get=async(path:string)=>{const response=await fetch(server!.url+path);return{status:response.status,body:await response.json()}};
 const packet={for:'twitch_account',type:'subscription',message:[{_id:'socket-event-1',name:'PRIVATE VIEWER',message:'oauth:PRIVATE MESSAGE'}]};
 try{
  await start();f.setStreaming(true);
  await vi.waitFor(async()=>expect((await get('/api/v1/streamcockpit-moments/manual/context')).body.writable).toBe(true));
  receive!(packet);receive!(packet);receive!({...packet,isTest:true,message:[{_id:'test-event'}]});
  receive!({...packet,for:'youtube_account',message:[{_id:'youtube-event'}]});
  receive!({...packet,type:'rollendcredits'});
  await vi.waitFor(async()=>expect((await get('/api/v1/streamcockpit-moments')).body.sessions).toHaveLength(1));
  const list=await get('/api/v1/streamcockpit-moments');const sessionId=list.body.sessions[0].sessionId;
  expect(list.body.sessions[0].markerCount).toBe(1);
  const before=await get('/api/v1/streamcockpit-moments/'+sessionId);
  expect(before.status).toBe(200);expect(before.body.markers).toHaveLength(1);
  expect(before.body.markers[0]).toMatchObject({source:'streamlabs',title:'Abonnement Twitch reçu',status:'observed'});
  expect(JSON.stringify(before)).not.toMatch(/PRIVATE|private-fixture-token/);
  expect(await get('/api/v1/streamcockpit-moments/'+sessionId)).toEqual(before);
  await server!.stop();server=undefined;await start();
  await vi.waitFor(async()=>expect((await get('/api/v1/streamcockpit-moments/manual/context')).body.writable).toBe(true));
  receive!(packet);
  // The adapter updates lastEventAt only AFTER both the feed and this observer resolve.
  await vi.waitFor(async()=>expect((await get('/api/v1/streamlabs/events')).body.provider.lastEventAt).toBeTruthy());
  expect(await get('/api/v1/streamcockpit-moments/'+sessionId)).toEqual(before);
  expect((await get('/api/v1/streamcockpit-moments')).body.sessions).toHaveLength(1);
  if(process.platform==='win32'){
   const cas=vi.spyOn(MomentsSqliteStorage.prototype,'compareAndSwap').mockRejectedValueOnce(Error('MOMENTS_WRITE_UNCERTAIN'));
   const lost={...packet,message:[{_id:'unacknowledged-event'}]};
   receive!(lost);
   await vi.waitFor(async()=>expect((await get('/api/v1/streamlabs/events')).body.provider.status).toBe('DEGRADED'));
   receive!(lost); // An uncertain old event is never automatically repeated.
   receive!({...packet,message:[{_id:'fresh-after-recovery'}]});
   await vi.waitFor(async()=>expect((await get('/api/v1/streamcockpit-moments/'+sessionId)).body.markers).toHaveLength(2));
   expect(cas).toHaveBeenCalledTimes(2); // One failed attempt and one NEW provider event.
   cas.mockRestore();
  }
  expect(f.state().writes).toBe(0);expect(f.rpc.filter((rpc:any)=>/^StartStream$|^StopStream$|^SaveReplayBuffer$/.test(rpc.type))).toEqual([]);
 }finally{await server?.stop();vi.restoreAllMocks();for(const name of names){if(saved[name]===undefined)delete process.env[name];else process.env[name]=saved[name]}}
}),30_000);
