import { expect, it, vi } from 'vitest';
import express,{type Request} from 'express';
import {request as httpRequest} from 'node:http';
import {type AddressInfo} from 'node:net';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {PredictionIntentSqlite} from '../apps/server/src/streamcockpit-prediction-intent-sqlite.js';
import {PredictionEndTwitch} from '../integrations/twitch/src/streamcockpit-prediction-end.js';
import {createTwitchPredictionEndRouter} from '../apps/server/src/streamcockpit-twitch-prediction-end-router.js';
import {twitchPollActor} from '../apps/server/src/streamcockpit-twitch-poll-router.js';
import {RemoteAuth} from '../apps/server/src/remote-auth.js';
import {isRemoteApiAllowed,requiredDevicePermissions} from '../apps/server/src/remote-api-policy.js';

const winner='vote-222';
const cancel={action:'CANCELED'};
const resolve={action:'RESOLVED',winnerId:winner};
async function fixture(run:(h:{
  call:(path:string,body?:unknown,credential?:string,method?:string)=>Promise<Response>;
  token:string;auth:RemoteAuth;fence:PredictionIntentSqlite;
  patches:ReturnType<typeof vi.fn>;reads:ReturnType<typeof vi.fn>;
  setStatus:(x:string)=>void;setMode:(x:string)=>void;setEpoch:(x:string|undefined)=>void;
  setOwner:(x:string)=>void;setScope:(x:string)=>void;
  setToken:(x:string)=>void;file:string;
})=>Promise<void>){
  const dir=await mkdtemp(join(tmpdir(),'sc3-pred-end-'));
  const file=join(dir,'fence.sqlite');
  const fence=new PredictionIntentSqlite(file), auth=new RemoteAuth();
  const pair=auth.createPairing(undefined,true);
  const token=auth.pair(pair.id,pair.code,'F08 end').credential;
  const creds={clientId:'client',accessToken:'PRIVATE_TOKEN',broadcasterId:'123'};
  let epoch:string|undefined='12:34',status='LOCKED',mode='normal',scope='channel:manage:predictions';
  const patches=vi.fn(),reads=vi.fn();
  const fetchMock=vi.fn(async(input:string|URL|Request,init?:RequestInit)=>{
    const url=String(input),method=init?.method;
    if(method==='GET'){
      reads(url);
      if(url.endsWith('/validate'))return Response.json({
        client_id:creds.clientId,user_id:mode==='wrong-claim'?'444':'123',
        scopes:[scope],expires_in:3600,
      });
      const request=new URL(url);
      if(request.pathname!=='/helix/predictions'||
          request.searchParams.get('id')!=='pred-777'||
          request.searchParams.get('broadcaster_id')!=='123')
        throw Error('NOT_EXACT_ID');
      if(mode==='epoch-changed')epoch='12:35';
      if(mode==='token-changed')creds.accessToken='ROTATED_PRIVATE_TOKEN';
      if(mode==='provider-down')return Response.json({message:'private'}, {status:503});
      if(mode==='missing')return Response.json({data:[]});
      return Response.json({data:[{
        id:mode==='wrong-id'?'pred-888':'pred-777',
        broadcaster_id:mode==='wrong-owner'?'999':'123',status,
        outcomes:mode==='invalid-outcome'?[
          {id:'duplicate',title:'A'},{id:'duplicate',title:'B'}]:[
          {id:'vote-111',title:'Option A'},{id:winner,title:'Option B'}],
      }]});
    }
    if(method==='PATCH'){
      const body=JSON.parse(String(init?.body));
      patches(url,body);
      if(mode==='lost')throw Error('PRIVATE_LOST_PATCH_RECEIPT');
      if(mode==='rejected')return Response.json({message:'fail'},{status:503});
      if(mode==='bad-receipt')return Response.json({data:[{
        id:'pred-777',broadcaster_id:'123',status:'ACTIVE'}]});
      return Response.json({data:[{
        id:'pred-777',broadcaster_id:'123',status:body.status,
        winning_outcome_id:body.winning_outcome_id,
      }]});
    }
    throw Error('UNEXPECTED_PROVIDER_METHOD');
  });
  const app=express();app.use(express.json({limit:'10kb'}));
  app.use('/api/v1/twitch/advanced/prediction/end',createTwitchPredictionEndRouter({
    api:new PredictionEndTwitch(()=>creds,fetchMock as typeof fetch),
    actor:(req:Request)=>twitchPollActor(req,auth,false,true),
    hostLive:()=>epoch,broadcasterId:()=>creds.broadcasterId,fence,
  }));
  const server=app.listen(0,'127.0.0.1');
  await new Promise<void>((ok,fail)=>{server.once('listening',ok);server.once('error',fail)});
  const root='http://127.0.0.1:'+(server.address() as AddressInfo).port+
    '/api/v1/twitch/advanced/prediction/end/';
  const call=(path:string,body?:unknown,credential=token,method='POST')=>
    new Promise<Response>((resolve,reject)=>{
      const payload=body===undefined?undefined:JSON.stringify(body);
      const req=httpRequest(root+path,{method,headers:{
        Authorization:'Device '+credential,
        ...(payload===undefined?{}:{'Content-Type':'application/json',
          'Content-Length':String(Buffer.byteLength(payload))}),
      }},res=>{
        const parts:Buffer[]=[];
        res.on('data',(part:Buffer)=>parts.push(part));
        res.on('error',reject);
        res.on('end',()=>{
          if(!res.complete){reject(Error('TEST_INCOMPLETE'));return;}
          resolve(new Response(Buffer.concat(parts),{
            status:res.statusCode??500,headers:res.headers as Record<string,string>,
          }));
        });
      });
      req.on('error',reject);
      req.setTimeout(5000,()=>req.destroy(Error('TEST_TIMEOUT')));
      req.end(payload);
    });
  try{
    fence.reserve('123');fence.recordConfirmed('123','pred-777');
    await run({call,token,auth,fence,file,patches,reads,
      setStatus:x=>{status=x},setMode:x=>{mode=x},setEpoch:x=>{epoch=x},
      setOwner:x=>{creds.broadcasterId=x},setScope:x=>{scope=x},
      setToken:x=>{creds.accessToken=x}});
  }finally{
    server.closeAllConnections();
    await new Promise<void>(ok=>server.close(()=>ok()));
    await rm(dir,{recursive:true,force:true});
  }
}
async function pre(h:{call:(p:string,b?:unknown,c?:string,m?:string)=>Promise<Response>},draft:unknown){
  const response=await h.call('preview',draft);
  expect(response.status,await response.clone().text()).toBe(200);
  return response.json() as Promise<{confirmationId:string,expiresAt:number,action:string}>;
}
it('F08 end routes are management-paired and never let a GET mutate Twitch',()=>fixture(async h=>{
  for(const path of ['preview','confirm']){
    const route='/v1/twitch/advanced/prediction/end/'+path;
    expect(isRemoteApiAllowed('POST',route)).toBe(true);
    expect(isRemoteApiAllowed('GET',route)).toBe(false);
    expect(requiredDevicePermissions('POST',route,{})).toEqual(['chat','cloud']);
    expect((await h.call(path,undefined,h.token,'GET')).status).toBe(405);
  }
  const inspectRoute='/v1/twitch/advanced/prediction/end/inspect';
  expect(isRemoteApiAllowed('GET',inspectRoute)).toBe(true);
  expect(isRemoteApiAllowed('POST',inspectRoute)).toBe(false);
  expect(requiredDevicePermissions('GET',inspectRoute,{})).toEqual(['chat','cloud']);
  expect((await h.call('inspect',undefined,h.token,'POST')).status).toBe(405);
  expect((await h.call('inspect',undefined,'INVALID','GET')).status).toBe(401);
  const pair=h.auth.createPairing(undefined,false,['chat','cloud']);
  const restricted=h.auth.pair(pair.id,pair.code,'limited');
  expect((await h.call('inspect',undefined,restricted.credential,'GET')).status).toBe(403);
  expect(h.patches).not.toHaveBeenCalled();
}));
it('F08 inspect is read-only and lists exact provider outcome IDs, never secrets',()=>fixture(async h=>{
  const response=await h.call('inspect',undefined,h.token,'GET');
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('no-store');
  const state=await response.json();
  expect(state).toMatchObject({kind:'streamcockpit-prediction-end-inspection',
    providerStatus:'locked',canResolve:true,canCancel:true,mutationPerformed:false,
    outcomes:[{id:'vote-111',title:'Option A'},{id:winner,title:'Option B'}]});
  expect(JSON.stringify(state)).not.toContain('PRIVATE_TOKEN');
  expect(h.patches).not.toHaveBeenCalled();
}));
it('F08 RESOLVED preflight -> one-use explicit consent -> single exact PATCH after SQLite v4 COMMIT',()=>fixture(async h=>{
  const preview=await pre(h,resolve);
  expect(preview.action).toBe('resolved');
  expect(h.patches).not.toHaveBeenCalled();
  const ack=await h.call('confirm',{confirmationId:preview.confirmationId,confirmed:true});
  expect(ack.status).toBe(200);
  expect(await ack.json()).toMatchObject({status:'resolved',predictionId:'pred-777'});
  expect(h.patches).toHaveBeenCalledExactlyOnceWith('https://api.twitch.tv/helix/predictions',
    {broadcaster_id:'123',id:'pred-777',status:'RESOLVED',winning_outcome_id:winner});
  expect(h.fence.readEndAttempted('123','pred-777')).toBe(true);
  const db=new DatabaseSync(h.file,{readOnly:true});
  try{
    expect((db.prepare('PRAGMA user_version').get() as {user_version:number}).user_version).toBe(4);
    expect((db.prepare('SELECT end_attempted FROM prediction_intents WHERE broadcaster_id=?')
      .get('123') as {end_attempted:string}).end_attempted).toBe('RESOLVED:'+winner);
  }finally{db.close()}
  expect((await h.call('confirm',{confirmationId:preview.confirmationId,confirmed:true})).status).toBe(409);
  expect((await h.call('preview',resolve)).status).toBe(409);
  expect(h.patches).toHaveBeenCalledTimes(1);
}));
it('F08 CANCELED works with active prediction but RESOLVED requires locked valid winner',()=>fixture(async h=>{
  h.setStatus('ACTIVE');
  expect((await h.call('preview',resolve)).status).toBe(409);
  expect((await h.call('preview',{action:'RESOLVED',winnerId:'not-in-options'})).status).toBe(409);
  const preview=await pre(h,cancel);
  expect((await h.call('confirm',{confirmationId:preview.confirmationId,confirmed:true})).status).toBe(200);
  expect(h.patches).toHaveBeenCalledExactlyOnceWith('https://api.twitch.tv/helix/predictions',
    {broadcaster_id:'123',id:'pred-777',status:'CANCELED'});
  expect(new PredictionIntentSqlite(h.file).readEndAttempted('123','pred-777')).toBe(true);
}));
it('F08 invalid end inputs and provider identifiers NEVER send PATCH or record intent',()=>fixture(async h=>{
  for(const draft of [{action:'RESOLVED'}, {action:'CANCELED',winnerId:winner},
      {action:'RESOLVED',winnerId:'../evil'}, {action:'UNKNOWN'}, {action:'CANCELED', extra:true}]){
    expect((await h.call('preview',draft)).status).toBe(400);
  }
  for(const mode of ['wrong-id','wrong-owner','missing','invalid-outcome','provider-down']){
    h.setMode(mode);
    expect((await h.call('inspect',undefined,h.token,'GET')).status).toBeGreaterThanOrEqual(400);
  }
  expect(h.patches).not.toHaveBeenCalled();
  expect(h.fence.readEndAttempted('123','pred-777')).toBe(false);
}));
it('F08 active state after terminal preview invalidates consent before PATCH',()=>fixture(async h=>{
  const preview=await pre(h,resolve);
  h.setStatus('ACTIVE');
  expect((await h.call('confirm',{confirmationId:preview.confirmationId,confirmed:true})).status).toBe(409);
  expect(h.patches).not.toHaveBeenCalled();
  expect(h.fence.readEndAttempted('123','pred-777')).toBe(false);
}));
it('F08 epoch/source/scope revoke consent and leave SQLite intent untouched',()=>fixture(async h=>{
  const preview=await pre(h,resolve);
  h.setEpoch('12:35');
  expect((await h.call('confirm',{confirmationId:preview.confirmationId,confirmed:true})).status).toBe(409);
  h.setEpoch('12:34');
  h.setScope('channel:read:predictions');
  expect((await h.call('preview',resolve)).status).toBe(403);
  h.setScope('channel:manage:predictions');
  const preview2=await pre(h,resolve);
  h.setOwner('999');
  expect((await h.call('confirm',{confirmationId:preview2.confirmationId,confirmed:true})).status).toBeGreaterThanOrEqual(400);
  expect(h.patches).not.toHaveBeenCalled();
  expect(h.fence.readEndAttempted('123','pred-777')).toBe(false);
}));
it('F08 provider token changes before PATCH cannot send public mutation',()=>fixture(async h=>{
  const preview=await pre(h,resolve);
  h.setMode('token-changed');
  expect((await h.call('confirm',{confirmationId:preview.confirmationId,confirmed:true})).status).toBeGreaterThanOrEqual(400);
  expect(h.patches).not.toHaveBeenCalled();
  expect(h.fence.readEndAttempted('123','pred-777')).toBe(false);
}));
it('F08 end refuses a switched FIXE epoch after durable intent, without sending PATCH or retrying',()=>fixture(async h=>{
  const preview=await pre(h,resolve);
  const write=h.fence.markEndAttempted.bind(h.fence);
  vi.spyOn(h.fence,'markEndAttempted').mockImplementation((owner,id,action,winnerId)=>{
    write(owner,id,action,winnerId);
    h.setEpoch('12:35'); // OBS authority changed immediately after SQLite COMMIT.
  });
  const reply=await h.call('confirm',{confirmationId:preview.confirmationId,confirmed:true});
  expect(reply.status).toBe(503);
  expect(await reply.json()).toMatchObject({error:{
    code:'PREDICTION_END_OUTCOME_UNCERTAIN',retryable:false}});
  expect(h.fence.readEndAttempted('123','pred-777')).toBe(true);
  expect(h.patches).not.toHaveBeenCalled();
  h.setEpoch('12:34');
  expect((await h.call('preview',resolve)).status).toBe(409);
}));

it('F08 two distinct confirmation IDs cannot send two terminal PATCHes',()=>fixture(async h=>{
  const a=await pre(h,resolve),b=await pre(h,resolve);
  const results=await Promise.all([
    h.call('confirm',{confirmationId:a.confirmationId,confirmed:true}),
    h.call('confirm',{confirmationId:b.confirmationId,confirmed:true}),
  ]);
  expect(results.map(x=>x.status).sort()).toEqual([200,409]);
  expect(h.patches).toHaveBeenCalledTimes(1);
  expect(h.fence.readEndAttempted('123','pred-777')).toBe(true);
}));
it.each(['lost','rejected','bad-receipt'])('F08 %s terminal PATCH is UNCERTAIN, not replayed even after a new SQLite instance',mode=>fixture(async h=>{
  const preview=await pre(h,resolve);
  h.setMode(mode);
  const result=await h.call('confirm',{confirmationId:preview.confirmationId,confirmed:true});
  expect(result.status).toBe(503);
  expect(await result.json()).toMatchObject({error:{
    code:'PREDICTION_END_OUTCOME_UNCERTAIN',retryable:false,
  }});
  expect(h.patches).toHaveBeenCalledTimes(1);
  const reopened=new PredictionIntentSqlite(h.file);
  expect(reopened.readEndAttempted('123','pred-777')).toBe(true);
  h.setMode('normal');
  expect((await h.call('preview',resolve)).status).toBe(409);
  expect(h.patches).toHaveBeenCalledTimes(1);
}));
it('F08 v3 -> v4 migration is atomic on end write and never erases lock or confirmed ID',()=>fixture(async h=>{
  h.fence.markLockAttempted('123','pred-777');
  expect(h.fence.readLockAttempted('123','pred-777')).toBe(true);
  const preview=await pre(h,resolve);
  expect((await h.call('confirm',{confirmationId:preview.confirmationId,confirmed:true})).status).toBe(200);
  const other=new PredictionIntentSqlite(h.file);
  expect(other.readLockAttempted('123','pred-777')).toBe(true);
  expect(other.readConfirmedId('123')).toBe('pred-777');
  expect(other.isBlocked('123')).toBe(true);
}));

it('F08 end routes mount on the real FIXE server and refuse unauthenticated loopback',async()=>{
  const {startDashboardServer}=await import('../apps/server/src/index.js');
  const dir=await mkdtemp(join(tmpdir(),'sc3-end-real-mount-'));
  let server:Awaited<ReturnType<typeof startDashboardServer>>|undefined;
  try{
    server=await startDashboardServer({
      port:0,dataDir:dir,remoteEnabled:false,obsEnabled:false,timerAuthority:false,
      logger:{info(){},warn(){},error(){}},
    });
    const root=server.url+'/api/v1/twitch/advanced/prediction/end/';
    for(const [path,method,body] of [
      ['inspect','GET',undefined],['preview','POST',cancel],
      ['confirm','POST',{confirmed:true,confirmationId:'11111111-1111-4111-8111-111111111111'}],
    ] as const){
      const response=await new Promise<{status:number,text:string}>((resolve,reject)=>{
        const payload=body===undefined?undefined:JSON.stringify(body);
        const req=httpRequest(root+path,{method,headers:payload===undefined?{}:{
          'Content-Type':'application/json','Content-Length':String(Buffer.byteLength(payload)),
        }},res=>{
          const chunks:Buffer[]=[];
          res.on('data',(part:Buffer)=>chunks.push(part));
          res.on('error',reject);
          res.on('end',()=>resolve({status:res.statusCode??500,
            text:Buffer.concat(chunks).toString('utf8')}));
        });
        req.on('error',reject);
        req.setTimeout(5000,()=>req.destroy(Error('TEST_TIMEOUT')));
        req.end(payload);
      });
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).not.toBe(404);
      expect(response.text).not.toContain('PRIVATE_TOKEN');
    }
  }finally{await server?.stop();await rm(dir,{recursive:true,force:true})}
},30000);

it('F08 pending uncertain LOCK forbids racing cancellation while provider still ACTIVE',()=>fixture(async h=>{
  h.fence.markLockAttempted('123','pred-777');
  h.setStatus('ACTIVE');
  expect((await h.call('inspect',undefined,h.token,'GET')).status).toBe(409);
  expect((await h.call('preview',cancel)).status).toBe(409);
  expect(h.patches).not.toHaveBeenCalled();
  // Once Twitch definitely reports LOCKED, an intentional cancellation is possible.
  h.setStatus('LOCKED');
  const preview=await pre(h,cancel);
  expect((await h.call('confirm',{confirmationId:preview.confirmationId,confirmed:true})).status).toBe(200);
  expect(h.patches).toHaveBeenCalledTimes(1);
}));
