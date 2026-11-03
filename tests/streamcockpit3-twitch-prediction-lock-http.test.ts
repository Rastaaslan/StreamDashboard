import {expect,it,vi} from 'vitest';
import express, {type Request} from 'express';
import {request as httpRequest} from 'node:http';
import {type AddressInfo} from 'node:net';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PredictionIntentSqlite} from '../apps/server/src/streamcockpit-prediction-intent-sqlite.js';
import {PredictionLockTwitch} from '../integrations/twitch/src/streamcockpit-prediction-lock.js';
import {createTwitchPredictionLockRouter} from '../apps/server/src/streamcockpit-twitch-prediction-lock-router.js';
import {twitchPollActor} from '../apps/server/src/streamcockpit-twitch-poll-router.js';
import {RemoteAuth} from '../apps/server/src/remote-auth.js';
import {isRemoteApiAllowed,requiredDevicePermissions} from '../apps/server/src/remote-api-policy.js';

async function fixture(run:(h:{
  call:(suffix:string,body?:unknown,credential?:string,method?:string)=>Promise<Response>;
  auth:RemoteAuth;token:string;fence:PredictionIntentSqlite;patches:ReturnType<typeof vi.fn>;
  setStatus:(s:string)=>void;setMode:(s:string)=>void;setEpoch:(s:string|undefined)=>void;
  setScope:(s:string)=>void;setOwner:(s:string)=>void;setToken:(s:string)=>void;
})=>Promise<void>) {
  const dir=await mkdtemp(join(tmpdir(),'sc3-pred-lock-'));
  const fence=new PredictionIntentSqlite(join(dir,'fence.sqlite'));
  const auth=new RemoteAuth(), pair=auth.createPairing(undefined,true);
  const token=auth.pair(pair.id,pair.code,'F08 lock tester').credential;
  const c={clientId:'client',accessToken:'PRIVATE_TOKEN',broadcasterId:'123'};
  let epoch:string|undefined='9:33',status='ACTIVE',mode='ok',scope='channel:manage:predictions';
  const patches=vi.fn();
  const mockedFetch=vi.fn(async (input:string|URL|Request,init?:RequestInit)=>{
    const url=String(input), method=init?.method;
    if(method==='GET') {
      if(url.endsWith('/validate')) return Response.json({
        client_id:c.clientId,user_id:c.broadcasterId,scopes:[scope],expires_in:3600,
      });
      const request=new URL(url);
      if(request.pathname!=='/helix/predictions' || request.searchParams.get('id')!=='pred-777' ||
          request.searchParams.get('broadcaster_id')!=='123')throw Error('NOT_EXACT_SAVED_ID');
      if(mode==='epoch-changed')epoch='9:34';
      if(mode==='token-changed')c.accessToken='NEW_TOKEN';
      if(mode==='provider-down')return Response.json({message:'secret'},{status:503});
      return Response.json({data:[{id:mode==='wrong-id'?'pred-888':'pred-777',
        broadcaster_id:mode==='wrong-owner'?'999':'123',status}]});
    }
    if(method==='PATCH') {
      patches(url,JSON.parse(String(init?.body)));
      if(mode==='lost-patch')throw Error('POST_DISPATCH_LOST');
      if(mode==='bad-receipt')return Response.json({data:[{id:'pred-777',broadcaster_id:'123',status:'ACTIVE'}]});
      if(mode==='rejected')return Response.json({message:'provider error'},{status:500});
      return Response.json({data:[{id:'pred-777',broadcaster_id:'123',status:'LOCKED'}]});
    }
    throw Error('UNEXPECTED_PROVIDER_METHOD');
  });
  const app=express();app.use(express.json());
  app.use('/api/v1/twitch/advanced/prediction/lock',createTwitchPredictionLockRouter({
    api:new PredictionLockTwitch(()=>c,mockedFetch as typeof fetch),
    actor:(req:Request)=>twitchPollActor(req,auth,false,true),
    hostLive:()=>epoch,broadcasterId:()=>c.broadcasterId,fence,
  }));
  const server=app.listen(0,'127.0.0.1');
  await new Promise<void>((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject)});
  const root='http://127.0.0.1:'+(server.address() as AddressInfo).port+
    '/api/v1/twitch/advanced/prediction/lock';
  const call=(suffix:string,body?:unknown,credential=token,method='POST'):Promise<Response>=>
    new Promise((resolve,reject)=>{
      const payload=body===undefined?undefined:JSON.stringify(body);
      const req=httpRequest(root+'/'+suffix,{method,headers:{
        Authorization:'Device '+credential,...(payload===undefined?{}:{
          'Content-Type':'application/json','Content-Length':String(Buffer.byteLength(payload)),
        })}},res=>{
        const chunks:Buffer[]=[];
        res.on('data',(part:Buffer)=>chunks.push(part));
        res.on('error',reject);
        res.on('end',()=>{
          if(!res.complete){reject(Error('TEST_HTTP_INCOMPLETE'));return;}
          resolve(new Response(Buffer.concat(chunks),{
            status:res.statusCode??500,headers:res.headers as Record<string,string>,
          }));
        });
      });
      req.setTimeout(5000,()=>req.destroy(Error('TEST_HTTP_TIMEOUT')));
      req.on('error',reject);req.end(payload);
    });
  try {
    fence.reserve('123');fence.recordConfirmed('123','pred-777');
    await run({call,auth,token,fence,patches,setStatus:s=>{status=s},setMode:s=>{mode=s},
      setEpoch:s=>{epoch=s},setScope:s=>{scope=s},setOwner:s=>{c.broadcasterId=s},
      setToken:s=>{c.accessToken=s}});
  }finally{
    server.closeAllConnections();
    await new Promise<void>(resolve=>server.close(()=>resolve()));
    await rm(dir,{recursive:true,force:true});
  }
}

it('F08 lock routes require POST, chat+cloud management and never expose public localhost bypass',()=>fixture(async h=>{
  for(const suffix of ['preview','confirm']){
    const route='/v1/twitch/advanced/prediction/lock/'+suffix;
    expect(isRemoteApiAllowed('POST',route)).toBe(true);
    expect(isRemoteApiAllowed('GET',route)).toBe(false);
    expect(requiredDevicePermissions('POST',route,{})).toEqual(['chat','cloud']);
    expect((await h.call(suffix,undefined,h.token,'GET')).status).toBe(405);
  }
  expect((await h.call('preview',{},'invalid')).status).toBe(401);
  const limitedPair=h.auth.createPairing(undefined,false,['chat','cloud']);
  const limited=h.auth.pair(limitedPair.id,limitedPair.code,'read only');
  expect((await h.call('preview',{},limited.credential)).status).toBe(403);
  expect(h.patches).not.toHaveBeenCalled();
}));

it('F08 lock preview is read-only and one explicit confirm emits exactly one saved-ID Twitch PATCH',()=>fixture(async h=>{
  const preview=await h.call('preview',{});
  expect(preview.status).toBe(200);
  expect(preview.headers.get('cache-control')).toContain('no-store');
  const consent=await preview.json() as {confirmationId:string,providerStatus:string};
  expect(consent.providerStatus).toBe('active');
  expect(h.patches).not.toHaveBeenCalled();
  const final=await h.call('confirm',{confirmed:true,confirmationId:consent.confirmationId});
  expect(final.status).toBe(200);
  expect(await final.json()).toMatchObject({status:'locked',predictionId:'pred-777'});
  expect(h.patches).toHaveBeenCalledExactlyOnceWith('https://api.twitch.tv/helix/predictions',
    {broadcaster_id:'123',id:'pred-777',status:'LOCKED'});
  expect(h.fence.readLockAttempted('123','pred-777')).toBe(true);
  expect((await h.call('confirm',{confirmed:true,confirmationId:consent.confirmationId})).status).toBe(409);
  expect((await h.call('preview',{})).status).toBe(409);
  expect(h.patches).toHaveBeenCalledTimes(1);
}));

it('F08 lock intent blocks a second preview across a fresh SQLite instance',()=>fixture(async h=>{
  const consent=await (await h.call('preview',{})).json() as {confirmationId:string};
  expect((await h.call('confirm',{confirmed:true,confirmationId:consent.confirmationId})).status).toBe(200);
  const reopened=new PredictionIntentSqlite((h.fence as any).file as string);
  expect(reopened.readLockAttempted('123','pred-777')).toBe(true);
}));

it('F08 lock declines inactive/locked/terminal or mismatched prediction without PATCH',()=>fixture(async h=>{
  for(const state of ['LOCKED','RESOLVED','CANCELED','UNKNOWN']){
    h.setStatus(state);
    expect((await h.call('preview',{})).status).toBeGreaterThanOrEqual(400);
  }
  h.setStatus('ACTIVE');
  for(const mode of ['wrong-id','wrong-owner','provider-down']){
    h.setMode(mode);
    expect((await h.call('preview',{})).status).toBeGreaterThanOrEqual(400);
  }
  expect(h.patches).not.toHaveBeenCalled();
  expect(h.fence.readLockAttempted('123','pred-777')).toBe(false);
}));

it('F08 missing manage scope, host live or changed epoch denies before PATCH',()=>fixture(async h=>{
  h.setScope('channel:read:predictions');
  expect((await h.call('preview',{})).status).toBe(403);
  h.setScope('channel:manage:predictions');h.setEpoch(undefined);
  expect((await h.call('preview',{})).status).toBe(409);
  h.setEpoch('9:33');
  const p=await (await h.call('preview',{})).json() as {confirmationId:string};
  h.setEpoch('9:34');
  expect((await h.call('confirm',{confirmed:true,confirmationId:p.confirmationId})).status).toBe(409);
  expect(h.patches).not.toHaveBeenCalled();
  expect(h.fence.readLockAttempted('123','pred-777')).toBe(false);
}));

it('F08 different consent IDs cannot race two PATCHes for the same prediction',()=>fixture(async h=>{
  const a=await (await h.call('preview',{})).json() as {confirmationId:string};
  const b=await (await h.call('preview',{})).json() as {confirmationId:string};
  const results=await Promise.all([
    h.call('confirm',{confirmed:true,confirmationId:a.confirmationId}),
    h.call('confirm',{confirmed:true,confirmationId:b.confirmationId}),
  ]);
  expect(results.map(x=>x.status).sort()).toEqual([200,409]);
  expect(h.patches).toHaveBeenCalledTimes(1);
}));

it.each(['lost-patch','bad-receipt','rejected'])('F08 %s is UNKNOWN, retained in SQLite, NEVER retried',mode=>fixture(async h=>{
  const p=await (await h.call('preview',{})).json() as {confirmationId:string};
  h.setMode(mode);
  const reply=await h.call('confirm',{confirmed:true,confirmationId:p.confirmationId});
  expect(reply.status).toBe(503);
  expect(await reply.json()).toMatchObject({error:{code:'PREDICTION_LOCK_OUTCOME_UNCERTAIN',retryable:false}});
  expect(h.patches).toHaveBeenCalledTimes(1);
  expect(h.fence.readLockAttempted('123','pred-777')).toBe(true);
  h.setMode('ok');
  expect((await h.call('preview',{})).status).toBe(409);
  expect(h.patches).toHaveBeenCalledTimes(1);
}));

it('F08 changes during preflight/permission recheck never mutate provider',()=>fixture(async h=>{
  const p=await (await h.call('preview',{})).json() as {confirmationId:string};
  h.setMode('epoch-changed');
  expect((await h.call('confirm',{confirmed:true,confirmationId:p.confirmationId})).status).toBe(409);
  expect(h.patches).not.toHaveBeenCalled();
  expect(h.fence.readLockAttempted('123','pred-777')).toBe(false);
}));

it('F08 lock routes are mounted on the actual FIXE server and reject unauthenticated loopback',async()=>{
  const {startDashboardServer}=await import('../apps/server/src/index.js');
  const dir=await mkdtemp(join(tmpdir(),'sc3-lock-real-mount-'));
  let server:Awaited<ReturnType<typeof startDashboardServer>>|undefined;
  try {
    server=await startDashboardServer({
      port:0,dataDir:dir,remoteEnabled:false,obsEnabled:false,timerAuthority:false,
      logger:{info(){},warn(){},error(){}},
    });
    const root=server.url+'/api/v1/twitch/advanced/prediction/lock/';
    for(const suffix of ['preview','confirm']){
      const body=suffix==='preview'?{}:{confirmationId:'11111111-1111-4111-8111-111111111111',confirmed:true};
      const result=await new Promise<{status:number;text:string}>((resolve,reject)=>{
        const data=JSON.stringify(body);
        const req=httpRequest(root+suffix,{method:'POST',
          headers:{'Content-Type':'application/json','Content-Length':String(Buffer.byteLength(data))}},res=>{
          const chunks:Buffer[]=[];
          res.on('data',(piece:Buffer)=>chunks.push(piece));
          res.on('error',reject);
          res.on('end',()=>resolve({status:res.statusCode??500,
            text:Buffer.concat(chunks).toString('utf8')}));
        });
        req.on('error',reject);req.setTimeout(5000,()=>req.destroy(Error('TEST_TIMEOUT')));req.end(data);
      });
      expect(result.status).toBeGreaterThanOrEqual(400);
      expect(result.status).not.toBe(404);
      expect(result.text).not.toContain('PRIVATE_TOKEN');
    }
  }finally{await server?.stop();await rm(dir,{recursive:true,force:true});}
});
