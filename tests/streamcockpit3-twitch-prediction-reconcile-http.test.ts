import { expect, it, vi } from 'vitest';
import express, { type Request } from 'express';
import { type AddressInfo } from 'node:net';
import { request as httpRequest } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PredictionTwitch } from '../integrations/twitch/src/streamcockpit-prediction.js';
import { StreamcockpitPredictionCreateService } from '../apps/server/src/streamcockpit-twitch-prediction-create-service.js';
import type { PredictionCreateTwitch } from '../integrations/twitch/src/streamcockpit-prediction-create.js';
import { PredictionIntentSqlite } from '../apps/server/src/streamcockpit-prediction-intent-sqlite.js';
import { createTwitchPredictionRouter } from '../apps/server/src/streamcockpit-twitch-prediction-router.js';
import { twitchPollActor } from '../apps/server/src/streamcockpit-twitch-poll-router.js';
import { RemoteAuth } from '../apps/server/src/remote-auth.js';
import { isRemoteApiAllowed, requiredDevicePermissions } from '../apps/server/src/remote-api-policy.js';

async function fixture(run:(ctx:{
  call:(token?:string,method?:string,body?:unknown,suffix?:string)=>Promise<Response>; token:string;
  fence:PredictionIntentSqlite; reopen:()=>PredictionIntentSqlite; reads:ReturnType<typeof vi.fn>;
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
  app.use(express.json());
  const releaseService=new StreamcockpitPredictionCreateService({} as PredictionCreateTwitch, Date.now, fence);
  app.use('/api/v1/twitch/advanced/prediction',createTwitchPredictionRouter({
    api:new PredictionTwitch(()=>c,mockedFetch as typeof fetch),
    actor:(req:Request)=>twitchPollActor(req,auth,false,true),
    hostLive:()=>epoch, broadcasterId:()=>c.broadcasterId, reservation:fence,
    reconcileRelease:releaseService,
  }));
  const server=app.listen(0,'127.0.0.1');
  await new Promise<void>((ok,fail)=>{server.once('listening',ok);server.once('error',fail);});
  const url='http://127.0.0.1:'+(server.address() as AddressInfo).port+
    '/api/v1/twitch/advanced/prediction/reconcile';
  try {
    // Ephemeral localhost ports can be rejected by Fetch as a "bad port".
    // Exercise the same real Express socket without Fetch's browser port blacklist.
    const call=(credential=token,method='GET',body?:unknown,suffix=''):Promise<Response>=>
      new Promise((resolve,reject)=>{
        const payload=body===undefined?undefined:JSON.stringify(body);
        const req=httpRequest(url+suffix,{method,timeout:5000,headers:{
          Authorization:'Device '+credential,
          ...(payload===undefined?{}:{'Content-Type':'application/json',
            'Content-Length':Buffer.byteLength(payload)}),
        }},res=>{
          const chunks:Buffer[]=[];
          res.on('data',(part:Buffer)=>chunks.push(part));
          res.on('error',reject);
          res.on('end',()=>{
            if(!res.complete){reject(Error('TEST_HTTP_INCOMPLETE'));return;}
            const headers=new Headers();
            for(let i=0;i<res.rawHeaders.length;i+=2)
              headers.append(res.rawHeaders[i],res.rawHeaders[i+1]);
            resolve(new Response(Buffer.concat(chunks),{
              status:res.statusCode??500,headers,
            }));
          });
        });
        req.on('timeout',()=>req.destroy(Error('TEST_HTTP_TIMEOUT')));
        req.on('error',reject);
        req.end(payload);
      });
    await run({call,token,fence,reopen:()=>new PredictionIntentSqlite(join(dir,'intent.sqlite')),reads,auth,
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
      manualReleasePreviewPossible:state==='RESOLVED'||state==='CANCELED',
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

it('F08 terminal release requires management pairing and two distinct manual POSTs; CAS survives restart',()=>fixture(async h=>{
  const route='/v1/twitch/advanced/prediction/reconcile';
  for (const suffix of ['/preview','/confirm']) {
    expect(isRemoteApiAllowed('POST',route+suffix)).toBe(true);
    expect(requiredDevicePermissions('POST',route+suffix,{})).toEqual(['chat','cloud']);
    expect(isRemoteApiAllowed('GET',route+suffix)).toBe(false);
    expect((await h.call(h.token,'GET',undefined,suffix)).status).toBe(405);
  }
  h.fence.reserve('123'); h.fence.recordConfirmed('123','pred-777');
  h.setStatus('RESOLVED');
  const limitedOffer=h.auth.createPairing(undefined,false,['chat','cloud']);
  const limited=h.auth.pair(limitedOffer.id,limitedOffer.code,'Limited');
  expect((await h.call(limited.credential,'POST',{},'/preview')).status).toBe(403);
  const draft=await h.call(h.token,'POST',{},'/preview');
  expect(draft.status).toBe(200);
  expect(draft.headers.get('cache-control')).toContain('no-store');
  const approval=await draft.json() as { confirmationId:string; providerStatus:string };
  expect(approval.providerStatus).toBe('resolved');
  expect(h.fence.isBlocked('123')).toBe(true); // PREVIEW must never unlock.
  const confirm=await h.call(h.token,'POST',{confirmationId:approval.confirmationId,confirmed:true},'/confirm');
  expect(confirm.status).toBe(200);
  expect(await confirm.json()).toMatchObject({released:true,providerStatus:'resolved'});
  expect(h.reopen().isBlocked('123')).toBe(false);
  expect((await h.call(h.token,'POST',{confirmationId:approval.confirmationId,confirmed:true},'/confirm')).status).toBe(409);
  expect(h.reads.mock.calls.every(c=>c[1]==='GET')).toBe(true);
}));

it('F08 release never treats active, missing, unattributed, mismatched or lost provider data as terminal',()=>fixture(async h=>{
  for(const state of ['ACTIVE','LOCKED','NONE','DOWN','WRONG_ID','WRONG_OWNER','UNKNOWN']) {
    h.fence.reserve('123'); h.fence.recordConfirmed('123','pred-777');
    h.setStatus(state);
    expect((await h.call(h.token,'POST',{},'/preview')).status).toBeGreaterThanOrEqual(400);
    expect(h.fence.isBlocked('123')).toBe(true);
  }
  h.setStatus('RESOLVED');
  const draft=await (await h.call(h.token,'POST',{},'/preview')).json() as {confirmationId:string};
  h.setStatus('ACTIVE');
  expect((await h.call(h.token,'POST',{confirmationId:draft.confirmationId,confirmed:true},'/confirm')).status).toBe(409);
  expect(h.fence.isBlocked('123')).toBe(true);
  h.setStatus('RESOLVED');
  expect((await h.call(h.token,'POST',{confirmationId:draft.confirmationId,confirmed:true},'/confirm')).status).toBe(409);
  expect(h.fence.isBlocked('123')).toBe(true);
}));

it('F08 release rejects stale OBS epoch or provider-owner switch; confirmation is consumed',()=>fixture(async h=>{
  h.fence.reserve('123'); h.fence.recordConfirmed('123','pred-777');
  h.setStatus('CANCELED');
  const draft=await (await h.call(h.token,'POST',{},'/preview')).json() as {confirmationId:string};
  h.setEpoch('9:42');
  expect((await h.call(h.token,'POST',{confirmationId:draft.confirmationId,confirmed:true},'/confirm')).status).toBe(409);
  expect(h.fence.isBlocked('123')).toBe(true);
  const newDraft=await (await h.call(h.token,'POST',{},'/preview')).json() as {confirmationId:string};
  h.setOwner('999');
  expect((await h.call(h.token,'POST',{confirmationId:newDraft.confirmationId,confirmed:true},'/confirm')).status).toBeGreaterThanOrEqual(400);
  expect(h.fence.isBlocked('123')).toBe(true);
}));

it('F08 two concurrent terminal confirmations never release twice or issue a provider mutation',()=>fixture(async h=>{
  h.fence.reserve('123'); h.fence.recordConfirmed('123','pred-777'); h.setStatus('RESOLVED');
  const a=await (await h.call(h.token,'POST',{},'/preview')).json() as {confirmationId:string};
  const b=await (await h.call(h.token,'POST',{},'/preview')).json() as {confirmationId:string};
  const [first,second]=await Promise.all([
    h.call(h.token,'POST',{confirmed:true,confirmationId:a.confirmationId},'/confirm'),
    h.call(h.token,'POST',{confirmed:true,confirmationId:b.confirmationId},'/confirm'),
  ]);
  expect([first.status,second.status].sort()).toEqual([200,409]);
  expect(h.fence.isBlocked('123')).toBe(false);
  expect(h.reads.mock.calls.every(c=>c[1]==='GET')).toBe(true);
}));
