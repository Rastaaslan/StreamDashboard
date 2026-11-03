import { expect, it, vi } from 'vitest';
import express, { type Request } from 'express';
import { type AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PredictionTwitch } from '../integrations/twitch/src/streamcockpit-prediction.js';
import { PredictionIntentSqlite } from '../apps/server/src/streamcockpit-prediction-intent-sqlite.js';
import { createTwitchPredictionRouter } from '../apps/server/src/streamcockpit-twitch-prediction-router.js';
import { twitchPollActor } from '../apps/server/src/streamcockpit-twitch-poll-router.js';
import { RemoteAuth } from '../apps/server/src/remote-auth.js';
import { isRemoteApiAllowed, requiredDevicePermissions } from '../apps/server/src/remote-api-policy.js';

async function fixture(run:(ctx:{
  call:(token?:string,method?:string)=>Promise<Response>; token:string;
  fence:PredictionIntentSqlite; reads:ReturnType<typeof vi.fn>;
  setStatus:(v:string)=>void; setEpoch:(v:string|undefined)=>void;
  swapEpochOnRead:()=>void; rotateDuringRead:()=>void; switchOwnerDuringRead:()=>void;
  rotateToken:()=>void; setOwner:(v:string)=>void;
  auth:RemoteAuth;
})=>Promise<void>) {
  const dir=await mkdtemp(join(tmpdir(),'sc3-prediction-reconcile-'));
  const fence=new PredictionIntentSqlite(join(dir,'intent.sqlite'));
  const auth=new RemoteAuth(), pairing=auth.createPairing(undefined,true);
  const token=auth.pair(pairing.id,pairing.code,'Reconcile tester').credential;
  const c={ clientId:'test-client',accessToken:'PRIVATE_TOKEN',broadcasterId:'123' };
  let status='ACTIVE',epoch:string|undefined='9:41',switchEpoch=false;
  let switchToken=false, switchOwner=false;
  const reads=vi.fn();
  const mockedFetch=vi.fn(async(input:string|URL|Request,init?:RequestInit)=>{
    const url=String(input);
    reads(url,init?.method);
    if(init?.method!=='GET')throw Error('NO_PROVIDER_MUTATIONS');
    if(url.endsWith('/validate'))return Response.json({
      client_id:c.clientId,user_id:c.broadcasterId,
      scopes:['channel:manage:predictions'],expires_in:3600,
    });
    if(!url.startsWith('https://api.twitch.tv/helix/predictions?'))throw Error('WRONG_PROVIDER_URL');
    const args=new URL(url);
    if(args.searchParams.get('broadcaster_id')!=='123'||args.searchParams.get('id')!=='pred-777')
      throw Error('MUST_QUERY_EXACT_STORED_ID');
    if(switchEpoch)epoch='9:42';
    if(switchToken)c.accessToken='ROTATED_DURING_GET';
    if(switchOwner)c.broadcasterId='999';
    if(status==='DOWN')return Response.json({error:'private'}, {status:503});
    if(status==='NONE')return Response.json({data:[]});
    if(status==='WRONG_ID')return Response.json({data:[{id:'pred-888',broadcaster_id:'123',status:'RESOLVED'}]});
    if(status==='WRONG_OWNER')return Response.json({data:[{id:'pred-777',broadcaster_id:'999',status:'RESOLVED'}]});
    if(status==='UNKNOWN')return Response.json({data:[{id:'pred-777',broadcaster_id:'123',status:'INVALID'}]});
    return Response.json({data:[{id:'pred-777',broadcaster_id:'123',status}]});
  });
  const app=express();
  app.use('/api/v1/twitch/advanced/prediction',createTwitchPredictionRouter({
    api:new PredictionTwitch(()=>c,mockedFetch as typeof fetch),
    actor:(req:Request)=>twitchPollActor(req,auth,false,true),
    hostLive:()=>epoch, broadcasterId:()=>c.broadcasterId, reservation:fence,
  }));
  const server=app.listen(0,'127.0.0.1');
  await new Promise<void>((ok,fail)=>{server.once('listening',ok);server.once('error',fail);});
  const url='http://127.0.0.1:'+(server.address() as AddressInfo).port+
    '/api/v1/twitch/advanced/prediction/reconcile';
  try {
    const call=(credential=token,method='GET')=>fetch(url,{
      method,headers:{Authorization:'Device '+credential},
    });
    await run({call,token,fence,reads,auth,
      setStatus:v=>{status=v},setEpoch:v=>{epoch=v},
      swapEpochOnRead:()=>{switchEpoch=true},
      rotateDuringRead:()=>{switchToken=true},
      switchOwnerDuringRead:()=>{switchOwner=true},
      rotateToken:()=>{c.accessToken='PRIVATE_ROTATED'},
      setOwner:v=>{c.broadcasterId=v},
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>(r=>server.close(()=>r()));
    await rm(dir,{recursive:true,force:true});
  }
}

it('F08 read-only reconciliation requires management pairing and an observed FIXE live',()=>fixture(async h=>{
  const route='/v1/twitch/advanced/prediction/reconcile';
  expect(isRemoteApiAllowed('GET',route)).toBe(true);
  expect(isRemoteApiAllowed('POST',route)).toBe(false);
  expect(requiredDevicePermissions('GET',route,{})).toEqual(['chat','cloud']);
  expect((await h.call(h.token,'POST')).status).toBe(405);
  expect((await h.call('invalid')).status).toBe(401);
  const offer=h.auth.createPairing(undefined,false,['chat','cloud']);
  const limited=h.auth.pair(offer.id,offer.code,'Limited');
  expect((await h.call(limited.credential)).status).toBe(403);
  h.setEpoch(undefined);
  expect((await h.call()).status).toBe(409);
  expect(h.reads).not.toHaveBeenCalled();
}));

it('F08 no reservation or unattributed POST remains unchecked without guessing by title/latest',()=>fixture(async h=>{
  expect(await (await h.call()).json()).toMatchObject({
    reservation:'absent',providerStatus:'unchecked',unlockAvailable:false,
  });
  expect(h.fence.reserve('123')).toBe(true);
  expect(h.fence.readConfirmedId('123')).toBeNull();
  expect(await (await h.call()).json()).toMatchObject({
    reservation:'unattributed',providerStatus:'unchecked',unlockAvailable:false,
  });
  expect(h.reads).not.toHaveBeenCalled();
  expect(h.fence.isBlocked('123')).toBe(true);
}));

it('F08 terminal provider states are evidence tied to persisted ID, NEVER a release',()=>fixture(async h=>{
  expect(h.fence.reserve('123')).toBe(true);
  h.fence.recordConfirmed('123','pred-777');
  expect(h.fence.readConfirmedId('123')).toBe('pred-777');
  for(const state of ['ACTIVE','LOCKED','RESOLVED','CANCELED','NONE']) {
    h.setStatus(state);
    const reply=await h.call();
    expect(reply.status).toBe(200);
    expect(reply.headers.get('cache-control')).toContain('no-store');
    expect(await reply.json()).toMatchObject({
      reservation:'confirmed',providerStatus:state==='NONE'?'not_found':state.toLowerCase(),
      unlockAvailable:false,
    });
    expect(h.fence.isBlocked('123')).toBe(true);
    expect(h.fence.readConfirmedId('123')).toBe('pred-777');
  }
  expect(h.reads.mock.calls.every(c=>c[1]==='GET')).toBe(true);
  expect(JSON.stringify(h.reads.mock.calls)).not.toContain('/helix/predictions?broadcaster_id=123&first=1');
}));

it('F08 rejects mismatched provider evidence; an account switch cannot access the prior lock',()=>fixture(async h=>{
  h.fence.reserve('123');
  h.fence.recordConfirmed('123','pred-777');
  for(const mode of ['WRONG_ID','WRONG_OWNER','UNKNOWN','DOWN']) {
    h.setStatus(mode);
    expect((await h.call()).status).toBeGreaterThanOrEqual(400);
    expect(h.fence.isBlocked('123')).toBe(true);
  }
  // A deliberate account switch can only see its own empty journal; prior owner stays locked.
  h.setOwner('999');
  const switched=await h.call();
  expect(switched.status).toBe(200);
  expect(await switched.json()).toMatchObject({reservation:'absent',providerStatus:'unchecked',unlockAvailable:false});
  expect(h.fence.isBlocked('123')).toBe(true);
}));

it('F08 stop/start epoch while GET is in-flight cannot surface stale terminal evidence',()=>fixture(async h=>{
  h.fence.reserve('123');
  h.fence.recordConfirmed('123','pred-777');
  h.setStatus('RESOLVED');
  h.swapEpochOnRead();
  expect((await h.call()).status).toBe(409);
  expect(h.fence.isBlocked('123')).toBe(true);
}));

it('F08 token rotation during exact-ID GET invalidates evidence without unlocking',()=>fixture(async h=>{
  h.fence.reserve('123'); h.fence.recordConfirmed('123','pred-777');
  h.setStatus('RESOLVED');h.rotateDuringRead();
  expect((await h.call()).status).toBe(401);
  expect(h.fence.isBlocked('123')).toBe(true);
}));

it('F08 provider account switch during exact-ID GET cannot report terminal evidence',()=>fixture(async h=>{
  h.fence.reserve('123');h.fence.recordConfirmed('123','pred-777');
  h.setStatus('CANCELED');h.switchOwnerDuringRead();
  expect((await h.call()).status).toBe(401);
  expect(h.fence.isBlocked('123')).toBe(true);
}));
