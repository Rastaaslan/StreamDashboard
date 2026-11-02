import express, { type Request } from 'express';
import type { AddressInfo } from 'node:net';
import { expect, it, vi } from 'vitest';
import { AdvancedTwitch } from '../integrations/twitch/src/streamcockpit-advanced.js';
import { StreamcockpitTwitchService } from '../apps/server/src/streamcockpit-twitch-service.js';
import { createTwitchPollRouter, twitchPollActor } from '../apps/server/src/streamcockpit-twitch-poll-router.js';
import { RemoteAuth } from '../apps/server/src/remote-auth.js';
import { isRemoteApiAllowed, requiredDevicePermissions } from '../apps/server/src/remote-api-policy.js';

const draft = { title:'Quel jeu ensuite ?', choices:['Minecraft','Autre jeu'], duration: 60 };
async function fixture(run:(f:{
  url:string; token:string; auth:RemoteAuth; id:string; request:(route:string,body:unknown,token?:string)=>Promise<Response>;
  writes:ReturnType<typeof vi.fn>; calls:ReturnType<typeof vi.fn>;
  setLive:(value:boolean)=>void; rotateStream:()=>void; setMode:(value:string)=>void; setDuringPreflight:(f:()=>void)=>void;
})=>Promise<void>) {
  const auth = new RemoteAuth();
  const management = auth.createPairing(undefined,true);
  const paired = auth.pair(management.id,management.code,'Manage fixture');
  let live = true, epoch = 1, mode = 'ok', duringPreflight = () => {};
  const creds = {clientId:'client',accessToken:'TEST_ONLY_TOKEN',broadcasterId:'123'};
  const writes = vi.fn();
  const calls = vi.fn(async (url:string | URL | Request, init?:RequestInit) => {
    const u = String(url), method = init?.method ?? 'GET';
    if(method === 'POST') {
      writes(u);
      if(mode==='network-after-post')throw Error('PRIVATE_SECRET');
      if(mode==='provider-rejected-post')return Response.json({message:'PRIVATE_SECRET'}, {status:400});
      if(mode==='revoke-after-post')auth.revoke(paired.deviceId);
      return Response.json({data:[{id:'poll_1', broadcaster_id:'123', title:draft.title,
        duration:draft.duration, choices:draft.choices.map(title=>({title})),status:'ACTIVE'}]});
    }
    if(u.includes('/validate'))return Response.json({client_id:'client',user_id:'123',expires_in:3600,
      scopes: mode==='missing-scope'?[]:['channel:manage:polls']});
    if(u.includes('/users'))return Response.json({data:[{id:'123',broadcaster_type:'affiliate'}]});
    if(u.includes('/polls?')) {
      duringPreflight();
      return Response.json({data:[]});
    }
    throw Error('UNEXPECTED_TEST_ENDPOINT');
  });
  const service = new StreamcockpitTwitchService(new AdvancedTwitch(()=>creds,calls as typeof fetch));
  const app = express(); app.use(express.json({limit:'8kb'}));
  app.use('/api/v1/twitch/advanced/poll',createTwitchPollRouter({
    service,
    actor:(req:Request)=>twitchPollActor(req,auth,false,true),
    hostLive:()=>live ? '1:'+epoch : undefined,
  }));
  const server=app.listen(0,'127.0.0.1');
  await new Promise<void>((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject)});
  try {
    const url='http://127.0.0.1:'+(server.address() as AddressInfo).port+'/api/v1/twitch/advanced/poll';
    await run({url,token:paired.credential,auth,id:paired.deviceId,writes,calls,
      setLive:value=>{live=value},rotateStream:()=>{epoch++},setMode:value=>{mode=value},
      setDuringPreflight:fn=>{duringPreflight=fn},
      request:(route,body,token=paired.credential)=>fetch(url+route,{
        method:'POST',headers:{Authorization:'Device '+token,'Content-Type':'application/json'},
        body:JSON.stringify(body),
      }),
    });
  }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()))}
}
it('F08 denies anonymous loopback, revoked credentials and non-management pairing',()=>fixture(async f=>{
  expect(() => twitchPollActor({headers:{}} as Request,f.auth,true,true)).toThrow('unauthorized');
  expect((await f.request('/preview',{draft},'BAD')).status).toBe(401);
  const limited=f.auth.createPairing(undefined,false,['chat','cloud']);
  const client=f.auth.pair(limited.id,limited.code,'Limited');
  expect((await f.request('/preview',{draft},client.credential)).status).toBe(403);
  expect(f.calls).not.toHaveBeenCalled();
  f.auth.revoke(f.id);
  expect((await f.request('/preview',{draft})).status).toBe(401);
  expect(f.writes).not.toHaveBeenCalled();
}));
it('F08 poll routes are POST-only, paired-management and chat+cloud, no false live',()=>fixture(async f=>{
  for(const name of ['/preview','/confirm']){
    const path='/v1/twitch/advanced/poll'+name;
    expect(isRemoteApiAllowed('POST',path)).toBe(true);
    expect(requiredDevicePermissions('POST',path,{})).toEqual(['chat','cloud']);
    for(const method of ['GET','HEAD','PUT','DELETE','PATCH']) {
      expect(isRemoteApiAllowed(method,path)).toBe(false);
      const response=await fetch(f.url+name,{method,headers:{Authorization:'Device '+f.token}});
      expect(response.status).toBe(405);
    }
  }
  f.setLive(false);
  expect((await f.request('/preview',{draft})).status).toBe(409);
  expect(f.calls).not.toHaveBeenCalled();
}));
it('F08 preview never mutates Twitch, confirmation is separate, one-time and nonretryable',()=>fixture(async f=>{
  const preview=await f.request('/preview',{draft});
  expect(preview.status).toBe(200);
  expect(preview.headers.get('cache-control')).toContain('no-store');
  const data=await preview.json();
  expect(data).toMatchObject({kind:'streamcockpit-poll-preview',schemaVersion:1,draft});
  expect(data.confirmationId).toMatch(/^[0-9a-f-]{36}$/);
  expect(f.writes).not.toHaveBeenCalled();
  const first=await f.request('/confirm',{confirmationId:data.confirmationId,confirmed:true});
  expect(first.status).toBe(200);
  expect(await first.json()).toMatchObject({kind:'streamcockpit-poll-confirmation',status:'confirmed',pollId:'poll_1'});
  expect(f.writes).toHaveBeenCalledTimes(1);
  expect((await f.request('/confirm',{confirmationId:data.confirmationId,confirmed:true})).status).toBe(409);
  expect(f.writes).toHaveBeenCalledTimes(1);
}));
it('F08 fails closed on extra body claims, provider spoofing and missing scope',()=>fixture(async f=>{
  const invalid=[
    {},{draft,identity:{id:'host'}},{draft,source:'twitch'},{draft:{...draft,title:'X'.repeat(61)}},
    {draft:{...draft,choices:['A']}},{draft:{...draft,duration:1}},null,
  ];
  for(const body of invalid)expect((await f.request('/preview',body)).status).toBe(400);
  for(const body of [{},{confirmed:true,confirmationId:'notuuid'},{confirmed:false,confirmationId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},
    {confirmed:true,confirmationId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',actor:'host'}])
    expect((await f.request('/confirm',body)).status).toBe(400);
  expect(f.calls).not.toHaveBeenCalled();
  f.setMode('missing-scope');
  expect((await f.request('/preview',{draft})).status).toBe(403);
  expect(f.writes).not.toHaveBeenCalled();
}));
it('F08 host OBS/Twitch live lost during confirm preflight stops BEFORE provider POST',()=>fixture(async f=>{
  const preview=await(await f.request('/preview',{draft})).json();
  f.setDuringPreflight(()=>f.setLive(false));
  const response=await f.request('/confirm',{confirmationId:preview.confirmationId,confirmed:true});
  expect(response.status).toBe(409);
  expect(f.writes).not.toHaveBeenCalled();
  f.setLive(true);
  expect((await f.request('/confirm',{confirmationId:preview.confirmationId,confirmed:true})).status).toBe(409);
}));
it('F08 refuses consent from a previous FIXE stream after stop and restart',()=>fixture(async f=>{
  const preview=await(await f.request('/preview',{draft})).json();
  f.rotateStream(); // OBS was live, stopped, then restarted on the same connection.
  const response=await f.request('/confirm',{confirmationId:preview.confirmationId,confirmed:true});
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({error:{code:'POLL_PRECONDITION',retryable:false}});
  expect(f.writes).not.toHaveBeenCalled();
}));
it('F08 detects a stop/restart during provider preflight despite current LIVE=true',()=>fixture(async f=>{
  const preview=await(await f.request('/preview',{draft})).json();
  f.setDuringPreflight(()=>f.rotateStream());
  const response=await f.request('/confirm',{confirmationId:preview.confirmationId,confirmed:true});
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({error:{code:'POLL_PRECONDITION',retryable:false}});
  expect(f.writes).not.toHaveBeenCalled();
  expect((await f.request('/confirm',{confirmationId:preview.confirmationId,confirmed:true})).status).toBe(409);
}));
it('F08 preview becomes invalid if OBS restarts during its Twitch read',()=>fixture(async f=>{
  f.setDuringPreflight(()=>f.rotateStream());
  const response=await f.request('/preview',{draft});
  expect(response.status).toBe(409);
  expect(await response.text()).not.toContain('confirmationId');
  expect(f.writes).not.toHaveBeenCalled();
}));
it('F08 pairing revocation mid-confirm preflight stops BEFORE provider POST',()=>fixture(async f=>{
  const preview=await(await f.request('/preview',{draft})).json();
  f.setDuringPreflight(()=>f.auth.revoke(f.id));
  const response=await f.request('/confirm',{confirmationId:preview.confirmationId,confirmed:true});
  expect(response.status).toBe(401);
  expect(await response.json()).toMatchObject({error:{code:'POLL_UNAUTHORIZED',retryable:false}});
  expect(f.writes).not.toHaveBeenCalled();
}));
it('F08 lost Twitch write receipt is uncertain and never silently repeated',()=>fixture(async f=>{
  const preview=await(await f.request('/preview',{draft})).json();
  f.setMode('network-after-post');
  const response=await f.request('/confirm',{confirmationId:preview.confirmationId,confirmed:true});
  expect(response.status).toBe(503);
  const body=await response.text();
  expect(body).toContain('POLL_OUTCOME_UNCERTAIN');
  expect(body).not.toContain('PRIVATE_SECRET');
  expect(f.writes).toHaveBeenCalledTimes(1);
  expect((await f.request('/confirm',{confirmationId:preview.confirmationId,confirmed:true})).status).toBe(409);
  expect(f.writes).toHaveBeenCalledTimes(1);
}));
it('F08 ambiguous 400 from Twitch after POST stays uncertain and cannot be resent',()=>fixture(async f=>{
  const preview=await(await f.request('/preview',{draft})).json();
  f.setMode('provider-rejected-post');
  const response=await f.request('/confirm',{confirmationId:preview.confirmationId,confirmed:true});
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({error:{code:'POLL_OUTCOME_UNCERTAIN',retryable:false}});
  expect(f.writes).toHaveBeenCalledTimes(1);
  expect((await f.request('/confirm',{confirmationId:preview.confirmationId,confirmed:true})).status).toBe(409);
  expect(f.writes).toHaveBeenCalledTimes(1);
}));
it('F08 revocation after successful provider POST withholds private poll identity',()=>fixture(async f=>{
  const preview=await(await f.request('/preview',{draft})).json();
  f.setMode('revoke-after-post');
  const response=await f.request('/confirm',{confirmationId:preview.confirmationId,confirmed:true});
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain('poll_1');
  expect(f.writes).toHaveBeenCalledTimes(1);
}));
