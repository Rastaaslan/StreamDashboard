import { expect, it, vi } from 'vitest';
import express, { type Request } from 'express';
import { type AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RaidTwitch, normalizeRaidTarget } from '../integrations/twitch/src/streamcockpit-raid.js';
import { StreamcockpitRaidService } from '../apps/server/src/streamcockpit-twitch-raid-service.js';
import { createTwitchRaidRouter } from '../apps/server/src/streamcockpit-twitch-raid-router.js';
import { twitchPollActor } from '../apps/server/src/streamcockpit-twitch-poll-router.js';
import { RemoteAuth } from '../apps/server/src/remote-auth.js';
import { isRemoteApiAllowed, requiredDevicePermissions } from '../apps/server/src/remote-api-policy.js';

const login = 'friendly_stream';
type Harness = {
  call:(action:string,body:unknown,token?:string)=>Promise<Response>;
  url:string; token:string; id:string; auth:RemoteAuth;
  reads:ReturnType<typeof vi.fn>; writes:ReturnType<typeof vi.fn>;
  setMode:(value:string)=>void; setEpoch:(value:string|undefined)=>void;
  changeOnLookup:()=>void; rotateToken:()=>void;
};
async function fixture(run:(h:Harness)=>Promise<void>, now?:()=>number) {
  const auth = new RemoteAuth(), offer=auth.createPairing(undefined,true);
  const paired=auth.pair(offer.id,offer.code,'Raid test');
  const credentials={clientId:'client',accessToken:'TEST_ONLY_TOKEN',broadcasterId:'123'};
  let epoch:string|undefined='3:8', mode='ok', lookupCount=0, epochOnLookup=false;
  const reads=vi.fn(),writes=vi.fn();
  const fetchApi=vi.fn(async(uri:string|URL|Request, init?:RequestInit) => {
    const url=String(uri),method=init?.method??'GET';
    if (method==='POST') {
      writes({url,method,headers:init?.headers});
      if(mode==='lost-ack')throw Error('PRIVATE_TEST_TOKEN');
      if(mode==='post-400')return Response.json({message:'PRIVATE_TEST_TOKEN'},{status:400});
      if(mode==='revoke-after-post')auth.revoke(paired.deviceId);
      if(mode==='rotate-after-post')credentials.accessToken='rotated';
      if(mode==='bad-receipt')return Response.json({data:[]});
      return Response.json({data:[{created_at:'2026-11-02T09:00:00Z',is_mature:false}]});
    }
    reads(url);
    if(url.includes('/validate'))return Response.json({
      client_id:mode==='wrong-client'?'wrong':'client',
      user_id:mode==='wrong-user'?'234':'123',
      scopes:mode==='missing-scope'?[]:['channel:manage:raids'],expires_in:3600,
    });
    if(url.includes('/helix/users?login=')) {
      ++lookupCount;
      if(epochOnLookup&&lookupCount===2)epoch='3:9';
      if(mode==='revoke-on-lookup')auth.revoke(paired.deviceId);
      if(mode==='not-found')return Response.json({data:[]});
      return Response.json({data:[{
        login,id:mode==='self-target'?'123':mode==='reassigned'&&lookupCount>1?'876':'999',
        display_name:'PRIVATE_TEST_TOKEN',
      }]});
    }
    throw Error('UNEXPECTED_TEST_REQUEST');
  });
  const service=new StreamcockpitRaidService(new RaidTwitch(
    ()=>credentials,fetchApi as typeof fetch
  ),now);
  const app=express();app.use(express.json({limit:'8kb'}));
  app.use('/api/v1/twitch/advanced/raid',createTwitchRaidRouter({
    service,actor:(req:Request)=>twitchPollActor(req,auth,false,true),hostLive:()=>epoch,
  }));
  const server=app.listen(0,'127.0.0.1');
  await new Promise<void>((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject)});
  try {
    const url='http://127.0.0.1:'+(server.address() as AddressInfo).port+
      '/api/v1/twitch/advanced/raid';
    const call=(action:string,body:unknown,token=paired.credential)=>fetch(url+'/'+action,{
      method:'POST',headers:{Authorization:'Device '+token,'Content-Type':'application/json'},
      body:JSON.stringify(body),
    });
    await run({url,call,token:paired.credential,id:paired.deviceId,auth,reads,writes,
      setMode:value=>{mode=value},setEpoch:value=>{epoch=value},
      changeOnLookup:()=>{epochOnLookup=true},
      rotateToken:()=>{credentials.accessToken='changed'},
    });
  }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()))}
}
async function preview(h:Harness) {
  const response=await h.call('preview',{target:{login}});
  expect(response.status).toBe(200);
  return response.json();
}

it('F08 raid endpoints require POST + management pairing and chat/cloud, not loopback',()=>fixture(async h=>{
  for(const name of ['preview','confirm']){
    const path='/v1/twitch/advanced/raid/'+name;
    expect(isRemoteApiAllowed('POST',path)).toBe(true);
    expect(requiredDevicePermissions('POST',path,{})).toEqual(['chat','cloud']);
    for(const method of ['GET','HEAD','PUT','PATCH','DELETE']){
      expect(isRemoteApiAllowed(method,path)).toBe(false);
      expect((await fetch(h.url+'/'+name,{method})).status).toBe(405);
    }
  }
  expect((await h.call('preview',{target:{login}},'wrong')).status).toBe(401);
  const insufficient=h.auth.createPairing(undefined,false,['chat','cloud']);
  const paired=h.auth.pair(insufficient.id,insufficient.code,'limited');
  expect((await h.call('preview',{target:{login}},paired.credential)).status).toBe(403);
  expect(h.reads).not.toHaveBeenCalled();
  expect(h.writes).not.toHaveBeenCalled();
}));

it('F08 raid rejects invalid target, self, missing destination, and missing broadcaster scope',()=>fixture(async h=>{
  for(const body of [
    {},{target:null},{target:['friendly_stream']},{target:{login:'@friendly_stream'}},
    {target:{login:'../../secret'}},{target:{login:'a'}},
    {target:{login:'friend',id:'999'}},{target:{login:' FRIEND '}},
  ])expect((await h.call('preview',body)).status).toBe(400);
  expect(normalizeRaidTarget({login:'FRIENDLY_STREAM'})).toBe(login);
  h.setMode('missing-scope');expect((await h.call('preview',{target:{login}})).status).toBe(403);
  h.setMode('wrong-user');expect((await h.call('preview',{target:{login}})).status).toBe(403);
  h.setMode('self-target');expect((await h.call('preview',{target:{login}})).status).toBe(409);
  h.setMode('not-found');expect((await h.call('preview',{target:{login}})).status).toBe(409);
  expect(h.writes).not.toHaveBeenCalled();
}));

it('F08 raid preview is GET-only; a second one-use consent queues one POST, never claims transfer',()=>fixture(async h=>{
  const first=await h.call('preview',{target:{login}});
  expect(first.headers.get('cache-control')).toContain('no-store');
  const p=await first.json();
  expect(p).toMatchObject({schemaVersion:1,kind:'streamcockpit-raid-preview',targetLogin:login});
  expect(p.warning).toContain('90 secondes');
  // No target identifier field or provider display-name is public. Digits in
  // an independent UUID/expiry are not a leaked broadcaster identifier.
  expect(Object.keys(p).sort()).toEqual(['confirmationId','expiresAt','kind','schemaVersion','targetLogin','warning']);
  expect(p.confirmationId).toMatch(/^[a-f0-9-]{36}$/);
  expect(p.expiresAt).toBe(1794000999000); // Legitimate opaque metadata contains 999.
  expect(p.targetLogin).toBe(login);
  expect(p.warning).not.toContain('PRIVATE_TEST_TOKEN');
  expect(h.writes).not.toHaveBeenCalled();
  const result=await h.call('confirm',{confirmationId:p.confirmationId,confirmed:true});
  expect(result.status).toBe(200);
  expect(await result.json()).toEqual({
    schemaVersion:1,kind:'streamcockpit-raid-confirmation',status:'queued',
    targetLogin:login,transferVerified:false,
  });
  expect(h.writes).toHaveBeenCalledTimes(1);
  const query=new URL(h.writes.mock.calls[0][0].url);
  expect(query.pathname).toBe('/helix/raids');
  expect(query.searchParams.get('from_broadcaster_id')).toBe('123');
  expect(query.searchParams.get('to_broadcaster_id')).toBe('999');
  expect((await h.call('confirm',{confirmationId:p.confirmationId,confirmed:true})).status).toBe(409);
  expect(h.writes).toHaveBeenCalledTimes(1);
},()=>1794000954000));

it('F08 raid invalid consent cannot send, stopped or replaced OBS live revokes preview',()=>fixture(async h=>{
  for(const bad of [{},{confirmationId:'bad',confirmed:true},
    {confirmationId:'00000000-0000-4000-8000-000000000000',confirmed:false},
    {confirmationId:'00000000-0000-4000-8000-000000000000',confirmed:true,actor:'FIXE'}])
    expect((await h.call('confirm',bad)).status).toBe(400);
  h.setEpoch(undefined);expect((await h.call('preview',{target:{login}})).status).toBe(409);
  h.setEpoch('3:8');const p=await preview(h);
  h.setEpoch('3:10');
  expect((await h.call('confirm',{confirmationId:p.confirmationId,confirmed:true})).status).toBe(409);
  expect(h.writes).not.toHaveBeenCalled();
}));

it('F08 raid denies stop/start during provider recheck, account rotation and target reassignment',()=>fixture(async h=>{
  let p=await preview(h);h.changeOnLookup();
  expect((await h.call('confirm',{confirmationId:p.confirmationId,confirmed:true})).status).toBe(409);
  h.setEpoch('3:8');p=await preview(h);
  h.setMode('reassigned');
  expect((await h.call('confirm',{confirmationId:p.confirmationId,confirmed:true})).status).toBe(409);
  h.setMode('ok');p=await preview(h);h.rotateToken();
  expect((await h.call('confirm',{confirmationId:p.confirmationId,confirmed:true})).status).toBe(401);
  expect(h.writes).not.toHaveBeenCalled();
}));

it('F08 raid revocation during provider GET refuses before the write without leaking identity',()=>fixture(async h=>{
  const p=await preview(h);h.setMode('revoke-on-lookup');
  const response=await h.call('confirm',{confirmationId:p.confirmationId,confirmed:true});
  expect(response.status).toBe(401);
  expect(await response.text()).not.toContain(login);
  expect(h.writes).not.toHaveBeenCalled();
}));

it.each(['lost-ack','post-400','bad-receipt','revoke-after-post','rotate-after-post'])(
  'F08 raid %s after dispatch is UNCERTAIN and never replayed',
  mode=>fixture(async h=>{
    const p=await preview(h);h.setMode(mode);
    const response=await h.call('confirm',{confirmationId:p.confirmationId,confirmed:true});
    expect(response.status).toBe(503);
    const text=await response.text();
    expect(text).toContain('RAID_OUTCOME_UNCERTAIN');
    expect(text).not.toContain('PRIVATE_TEST_TOKEN');
    expect(text).not.toContain(login);
    expect(h.writes).toHaveBeenCalledTimes(1);
    expect((await h.call('confirm',{confirmationId:p.confirmationId,confirmed:true})).status)
      .toBeGreaterThanOrEqual(400);
    expect(h.writes).toHaveBeenCalledTimes(1);
  })
);

it('F08 production server mounts raid routes but refuses unpaired host without Twitch call',async()=>{
  const {startDashboardServer}=await import('../apps/server/src/index.js');
  const dir=await mkdtemp(join(tmpdir(),'sc3-raid-mount-'));
  let server:Awaited<ReturnType<typeof startDashboardServer>>|undefined;
  try{
    for(let attempt=0;attempt<7;attempt++){
      const candidate=await startDashboardServer({
        port:0,dataDir:dir,remoteEnabled:false,obsEnabled:false,timerAuthority:false,
        logger:{info(){},warn(){},error(){}},
      });
      try{await fetch(candidate.url+'/api/v1/health');server=candidate;break;}
      catch(e){
        await candidate.stop();
        if((e as {cause?:{message?:string}})?.cause?.message!=='bad port')throw e;
      }
    }
    if(!server)throw Error('LOOPBACK_TEST_PORT_UNAVAILABLE');
    for(const route of ['preview','confirm']){
      const url=server.url+'/api/v1/twitch/advanced/raid/'+route;
      const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify(route==='preview'?{target:{login}}:{confirmed:true,confirmationId:'bad'})});
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(r.status).not.toBe(404);
      const cross=await fetch(url,{method:'POST',
        headers:{Origin:'https://untrusted.invalid','Content-Type':'application/json'},
        body:'{}'});
      expect(cross.status).toBe(403);
    }
  }finally{await server?.stop();await rm(dir,{recursive:true,force:true})}
},30000);
