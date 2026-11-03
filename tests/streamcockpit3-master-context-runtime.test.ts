import {it,expect} from 'vitest';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {startDashboardServer,type DashboardServerHandle} from '../apps/server/src/index.js';
import {withMixerFixture} from './helpers/streamcockpit-mixer-fixture.js';
it('F03/F07 complete DashboardServer: real OBS notifications reach context and its native action/receipt circuit',async()=>withMixerFixture(async f=>{
 await f.obs.close(); // Exactly one application OBS client remains: the complete server below.
 const dataDir=join(f.directory,'full-runtime');await mkdir(dataDir);
 const names=['OBS_URL','DATA_FILE','DISCORD_BOT_TOKEN','STREAMLABS_SOCKET_TOKEN']as const;
 const saved=Object.fromEntries(names.map(name=>[name,process.env[name]]));
 process.env.OBS_URL=f.obsUrl;process.env.DATA_FILE=join(dataDir,'dashboard.json');process.env.DISCORD_BOT_TOKEN='';process.env.STREAMLABS_SOCKET_TOKEN='';
 let server:DashboardServerHandle|undefined;
 try{
  server=await startDashboardServer({port:0,dataDir,host:'127.0.0.1',obsEnabled:true,timerAuthority:true,twitchClientId:'',googleClientId:'',googleClientSecret:'',
   deviceDescriptor:async()=>({id:'fixe-context-qa',name:'FIXE QA',platform:'windows',enabled:true,roles:['controller','obs-executor','display','services','audio'],capabilities:['obs','clips','audio','cloud','planning','chat','viewer','storage','global-keys']}),
   logger:{info(){},warn(){},error(){}},
  });
  await server.providersReady;
  const call=async(path:string,body?:any,method=body===undefined?'GET':'POST')=>{const r=await fetch(server!.url+path,{method,headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,body:await r.json()}};
  const state=(await call('/api/v2/state')).body,c=state.configuration;
  c.actions=[{id:'pause-qa',label:'Pause QA',type:'scene.set',value:'Pause',color:'amber',shortcut:''}];
  expect((await call('/api/v2/configuration',{configuration:c,expectedRevision:c.revision},'PUT')).status).toBe(200);
  const context=await call('/api/v1/streamcockpit-context');expect(context.status).toBe(200);
  expect(context.body).toMatchObject({status:'known',role:'stream-pc',scene:'Live',streamState:'offline'});expect(f.state().writes).toBe(0);
  const result=await call('/api/v2/actions',{id:randomUUID(),issuedAt:new Date().toISOString(),action:'pause-qa',expectedAction:c.actions[0],expectedContextToken:context.body.proof});
  expect(result.body.status).toBe('succeeded');expect(f.state().scene).toBe('Pause');expect(f.state().writes).toBe(1);
  expect((await call('/api/v1/streamcockpit-context')).body.scene).toBe('Pause');
 }finally{
  await server?.stop();for(const name of names){if(saved[name]===undefined)delete process.env[name];else process.env[name]=saved[name]}
 }
}),20_000);
