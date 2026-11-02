import { expect, it, vi } from 'vitest';
import express from 'express';
import type { Request } from 'express';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AdvancedTwitchError } from '../integrations/twitch/src/streamcockpit-advanced.js';
import { ShoutoutTwitch, normalizeShoutoutTarget } from '../integrations/twitch/src/streamcockpit-shoutout.js';
import { StreamcockpitShoutoutService } from '../apps/server/src/streamcockpit-twitch-shoutout-service.js';
import { createTwitchShoutoutRouter } from '../apps/server/src/streamcockpit-twitch-shoutout-router.js';
import { twitchPollActor } from '../apps/server/src/streamcockpit-twitch-poll-router.js';
import { RemoteAuth } from '../apps/server/src/remote-auth.js';
import { isRemoteApiAllowed, requiredDevicePermissions } from '../apps/server/src/remote-api-policy.js';

const login='friendly_stream',target={login};
type Harness={
  call:(action:string,body:unknown,credential?:string)=>Promise<Response>;
  url:string;token:string; auth:RemoteAuth; id:string; reads:ReturnType<typeof vi.fn>;
  writes:ReturnType<typeof vi.fn>; setMode:(mode:string)=>void;
  setEpoch:(epoch:string|undefined)=>void; setChangedOnLookup:(value:boolean)=>void;
  changeToken:()=>void;
};
async function fixture(run:(h:Harness)=>Promise<void>){
  const auth=new RemoteAuth(),pairedInfo=auth.createPairing(undefined,true);
  const paired=auth.pair(pairedInfo.id,pairedInfo.code,'Shoutout fixture');
  const credentials={clientId:'client',accessToken:'TEST_ONLY_TOKEN',broadcasterId:'123'};
  let epoch:string|undefined='3:8',mode='ok',readsCount=0,changeOnLookup=false;
  const writes=vi.fn(), reads=vi.fn();
  const fetchApi=vi.fn(async(uri:string|URL|Request,init?:RequestInit)=>{
    const url=String(uri),method=init?.method??'GET';
    if(method==='POST'){
      writes({url,method,headers:init?.headers});
      if(mode==='lost-ack')throw Error('SHOULD_NEVER_LEAK_TOKEN');
      if(mode==='post-400')return Response.json({message:'SHOULD_NEVER_LEAK_TOKEN'},{status:400});
      if(mode==='revoke-after-post')auth.revoke(paired.deviceId);
      if(mode==='token-rotated-after-post')credentials.accessToken='changed';
      return new Response(null,{status:204});
    }
    reads(url);
    if(url.includes('/validate'))return Response.json({
      client_id:mode==='wrong-client'?'not-client':'client',user_id:mode==='wrong-user'?'456':'123',
      scopes:mode==='missing-scope'?[]:['moderator:manage:shoutouts'],expires_in:3600,
    });
    if(url.includes('/helix/users?login=')){
      readsCount++;
      if(changeOnLookup && readsCount===2)epoch='3:9';
      if(mode==='revoke-on-lookup')auth.revoke(paired.deviceId);
      if(mode==='not-found')return Response.json({data:[]});
      return Response.json({data:[{id:mode==='self-target'?'123':mode==='reassigned'&&readsCount>1?'876':'999',
        login, display_name:'SHOULD_NEVER_LEAK_TOKEN'}]});
    }
    throw Error('NOT_ALLOWED_TEST_URL');
  });
  const service=new StreamcockpitShoutoutService(new ShoutoutTwitch(
    ()=>credentials,fetchApi as typeof fetch
  ));
  const app=express();app.use(express.json({limit:'8kb'}));
  app.use('/api/v1/twitch/advanced/shoutout',createTwitchShoutoutRouter({
    service,
    actor:(req:Request)=>twitchPollActor(req,auth,false,true),
    hostLive:()=>epoch,
  }));
  const server=app.listen(0,'127.0.0.1');
  await new Promise<void>((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject)});
  try{
    const url='http://127.0.0.1:'+(server.address() as AddressInfo).port+'/api/v1/twitch/advanced/shoutout';
    const call=(action:string,body:unknown,credential=paired.credential)=>fetch(url+'/'+action,{
      method:'POST',headers:{'Authorization':'Device '+credential,'Content-Type':'application/json'},
      body:JSON.stringify(body),
    });
    await run({url,call,token:paired.credential,auth,id:paired.deviceId,writes,reads,
      setMode:value=>{mode=value},setEpoch:value=>{epoch=value},
      setChangedOnLookup:v=>{changeOnLookup=v},changeToken:()=>{credentials.accessToken='rotated'},
    });
  }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()))}
}

it('F08 allows only authorized management POST; rejects anonymous loopback and read methods',()=>fixture(async h=>{
  for(const action of ['preview','confirm']){
    const path='/v1/twitch/advanced/shoutout/'+action;
    expect(isRemoteApiAllowed('POST',path)).toBe(true);
    expect(requiredDevicePermissions('POST',path,{})).toEqual(['chat','cloud']);
    for(const verb of ['GET','HEAD','PUT','PATCH','DELETE']){
      expect(isRemoteApiAllowed(verb,path)).toBe(false);
      expect((await fetch(h.url+'/'+action,{method:verb})).status).toBe(405);
    }
  }
  expect((await h.call('preview',{target},'invalid')).status).toBe(401);
  expect(()=>twitchPollActor({headers:{}} as Request,h.auth,true,true)).toThrow();
  const onlyChat=h.auth.createPairing(undefined,false,['chat','cloud']);
  const other=h.auth.pair(onlyChat.id,onlyChat.code,'chat only');
  expect((await h.call('preview',{target},other.credential)).status).toBe(403);
  expect(h.reads).not.toHaveBeenCalled();expect(h.writes).not.toHaveBeenCalled();
}));

it('F08 refuses invalid target, injection, self, nonexistent or OAuth-missing; never posts',()=>fixture(async h=>{
  for(const invalid of [
    {target:{login:'@friendly_stream'}},{target:{login:'../secrets'}},
    {target:{login:'a'}},{target:{login:'friend',id:'999'}},
    {target:{login:'FRIENDLY_stream ',extra:true}},{target:{login:'foo.bar'}},
    {},{target:null},{target:['friendly_stream']}
  ])expect((await h.call('preview',invalid)).status).toBe(400);
  h.setMode('missing-scope');
  expect((await h.call('preview',{target})).status).toBe(403);
  h.setMode('wrong-user');
  expect((await h.call('preview',{target})).status).toBe(403);
  h.setMode('not-found');
  expect((await h.call('preview',{target})).status).toBe(409);
  h.setMode('self-target');
  expect((await h.call('preview',{target})).status).toBe(409);
  expect(h.writes).not.toHaveBeenCalled();
  expect(normalizeShoutoutTarget({login:'FRIENDLY_STREAM'})).toBe(login);
  expect(()=>normalizeShoutoutTarget({login:'invalid!',broadcasterId:'123'}))
    .toThrow(AdvancedTwitchError);
}));

it('F08 two distinct gestures: preview performs GET, one-use confirmation performs one Twitch POST',()=>fixture(async h=>{
  const response=await h.call('preview',{target});
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('no-store');
  const preview=await response.json();
  expect(preview).toMatchObject({schemaVersion:1,kind:'streamcockpit-shoutout-preview',targetLogin:login});
  expect(preview.confirmationId).toMatch(/^[0-9a-f-]{36}$/);
  expect(JSON.stringify(preview)).not.toContain('999');
  expect(h.writes).not.toHaveBeenCalled();
  const confirmed=await h.call('confirm',{confirmationId:preview.confirmationId,confirmed:true});
  expect(confirmed.status).toBe(200);
  expect(await confirmed.json()).toMatchObject({
    schemaVersion:1,kind:'streamcockpit-shoutout-confirmation',status:'accepted',targetLogin:login
  });
  expect(h.writes).toHaveBeenCalledTimes(1);
  const [write]=h.writes.mock.calls[0],u=new URL(write.url);
  expect(u.pathname).toBe('/helix/chat/shoutouts');
  expect(u.searchParams.get('from_broadcaster_id')).toBe('123');
  expect(u.searchParams.get('moderator_id')).toBe('123');
  expect(u.searchParams.get('to_broadcaster_id')).toBe('999');
  expect((await h.call('confirm',{confirmationId:preview.confirmationId,confirmed:true})).status).toBe(409);
  expect(h.writes).toHaveBeenCalledTimes(1);
}));

it('F08 refuses host offline and stop/start epoch after preview, even when the live returns',()=>fixture(async h=>{
  h.setEpoch(undefined);
  expect((await h.call('preview',{target})).status).toBe(409);
  expect(h.reads).not.toHaveBeenCalled();
  h.setEpoch('3:8');
  const preview=await(await h.call('preview',{target})).json();
  h.setEpoch('3:10');
  expect((await h.call('confirm',{confirmationId:preview.confirmationId,confirmed:true})).status).toBe(409);
  expect(h.writes).not.toHaveBeenCalled();
}));

it('F08 rejects stop/start while Twitch GET preflight is pending, before any POST',()=>fixture(async h=>{
  const preview=await(await h.call('preview',{target})).json();
  h.setChangedOnLookup(true);
  const response=await h.call('confirm',{confirmationId:preview.confirmationId,confirmed:true});
  expect(response.status).toBe(409);
  expect(h.writes).not.toHaveBeenCalled();
}));

it('F08 target identity changed between preview and confirm, refuses before POST',()=>fixture(async h=>{
  const preview=await(await h.call('preview',{target})).json();
  h.setMode('reassigned');
  const response=await h.call('confirm',{confirmationId:preview.confirmationId,confirmed:true});
  expect(response.status).toBe(409);
  expect(h.writes).not.toHaveBeenCalled();
}));

it('F08 revocation during Twitch preflight refuses before POST and hides target',()=>fixture(async h=>{
  const preview=await(await h.call('preview',{target})).json();
  h.setMode('revoke-on-lookup');
  const response=await h.call('confirm',{confirmationId:preview.confirmationId,confirmed:true});
  expect(response.status).toBe(401);
  const body=await response.text();expect(body).not.toContain('friendly_stream');
  expect(h.writes).not.toHaveBeenCalled();
}));

it.each(['lost-ack','post-400','revoke-after-post','token-rotated-after-post'])(
  'F08 %s after only provider POST is UNCERTAIN, no leak or duplicate',
  mode=>fixture(async h=>{
    const preview=await(await h.call('preview',{target})).json();
    h.setMode(mode);
    const response=await h.call('confirm',{confirmationId:preview.confirmationId,confirmed:true});
    expect(response.status).toBe(503);
    const body=await response.text();
    expect(body).toContain('SHOUTOUT_OUTCOME_UNCERTAIN');
    expect(body).not.toContain('SHOULD_NEVER_LEAK_TOKEN');
    expect(body).not.toContain(login);
    expect(h.writes).toHaveBeenCalledTimes(1);
    expect((await h.call('confirm',{confirmationId:preview.confirmationId,confirmed:true})).status)
      .toBeGreaterThanOrEqual(400);
    expect(h.writes).toHaveBeenCalledTimes(1);
  })
);

it('F08 never sends on malformed confirmation or missing paired permissions',()=>fixture(async h=>{
  for(const body of [{},{confirmationId:'bad',confirmed:true},
    {confirmationId:'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',confirmed:false},
    {confirmationId:'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',confirmed:true,actor:'host'}])
    expect((await h.call('confirm',body)).status).toBe(400);
  h.auth.setPermissions(h.id,['chat']);
  expect((await h.call('preview',{target})).status).toBe(403);
  expect(h.writes).not.toHaveBeenCalled();
}));

it('F08 real server mounts both shoutout routes but refuses anonymous/disabled FIXE without any Twitch call',async()=>{
  const {startDashboardServer}=await import('../apps/server/src/index.js');
  const dir=await mkdtemp(join(tmpdir(),'sc3-shoutout-mount-'));
  let server:Awaited<ReturnType<typeof startDashboardServer>>|undefined;
  try{
    for(let attempt=0;attempt<8;attempt++){
      const candidate=await startDashboardServer({
        port:0,dataDir:dir,remoteEnabled:false,obsEnabled:false,timerAuthority:false,
        logger:{info(){},warn(){},error(){}},
      });
      try{
        await fetch(candidate.url+'/api/v1/health');
        server=candidate;break;
      }catch(error){
        await candidate.stop();
        if((error as {cause?:{message?:string}})?.cause?.message!=='bad port')throw error;
      }
    }
    if(!server)throw Error('TEST_LOOPBACK_PORT_UNAVAILABLE');
    for(const action of ['preview','confirm']){
      const route=server.url+'/api/v1/twitch/advanced/shoutout/'+action;
      const response=await fetch(route,{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify(action==='preview'?{target}:{confirmationId:'123',confirmed:true}),
      });
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).not.toBe(404);
      expect((await response.text())).not.toContain('SHOULD_NOT_CONTACT_TWITCH');
      const crossOrigin=await fetch(route,{
        method:'POST',headers:{Origin:'https://untrusted.invalid','Content-Type':'application/json'},
        body:'{}',
      });
      expect(crossOrigin.status).toBe(403);
    }
  }finally{await server?.stop();await rm(dir,{recursive:true,force:true})}
},30000);
