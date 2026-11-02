import { expect, it, vi } from 'vitest';
import express, { type Request } from 'express';
import { type AddressInfo } from 'node:net';
import {
  PredictionCreateTwitch, normalizePredictionCreate,
} from '../integrations/twitch/src/streamcockpit-prediction-create.js';
import { StreamcockpitPredictionCreateService } from '../apps/server/src/streamcockpit-twitch-prediction-create-service.js';
import { createTwitchPredictionCreateRouter } from '../apps/server/src/streamcockpit-twitch-prediction-create-router.js';
import { twitchPollActor } from '../apps/server/src/streamcockpit-twitch-poll-router.js';
import { RemoteAuth } from '../apps/server/src/remote-auth.js';
import { isRemoteApiAllowed, requiredDevicePermissions } from '../apps/server/src/remote-api-policy.js';

const draft = { title: 'Quel boss ?', outcomes: ['A', 'B'], predictionWindow: 60 };
async function fixture(run: (h: {
  request: (path:string, body?:unknown, token?:string, method?:string)=>Promise<Response>;
  token: string; auth: RemoteAuth; writes: ReturnType<typeof vi.fn>;
  reads: ReturnType<typeof vi.fn>;
  setMode:(x:string)=>void; setEpoch:(x:string|undefined)=>void;
  rotateToken:()=>void;
})=>Promise<void>) {
  const auth = new RemoteAuth(), offer = auth.createPairing(undefined, true);
  const paired = auth.pair(offer.id, offer.code, 'F08 prediction create');
  const credential = { clientId:'client', accessToken:'TEST_SECRET_PRIVATE', broadcasterId:'123' };
  let epoch: string|undefined = '8:23', mode='normal';
  const reads = vi.fn(), writes = vi.fn();
  const mockFetch = vi.fn(async(input:string|URL|Request, init?:RequestInit) => {
    const path = String(input), method = init?.method;
    if (method === 'POST') {
      writes(path, init?.body);
      if (mode === 'lost-post') throw new Error('LOST_RECEIPT_PRIVATE');
      if (mode === 'post-error') return Response.json({ message:'failed' },{status:403});
      return Response.json({data:[{
        id:'pred-777',broadcaster_id:'123',title:draft.title,status:'ACTIVE',
      }]});
    }
    if (method !== 'GET') throw new Error('UNEXPECTED_METHOD');
    reads(path);
    if (mode === 'epoch-after-get' && path.includes('/helix/predictions')) epoch = '8:24';
    if (path.endsWith('/validate')) return Response.json({
      client_id:'client', user_id:mode==='wrong-owner'?'777':'123',
      scopes:mode==='scope'?['channel:read:predictions']:['channel:manage:predictions'],
      expires_in:3600,
    });
    if (path.includes('/helix/users')) return Response.json({data:[{
      id:'123',broadcaster_type:mode==='not-affiliate'?'':'affiliate',
    }]});
    if (path.includes('/helix/predictions')) return Response.json({
      data:mode==='active'?[{broadcaster_id:'123',status:'ACTIVE'}]:
        mode==='unknown'?[{broadcaster_id:'123',status:'AWAITING'}]:[],
    });
    throw Error('UNEXPECTED_PATH');
  });
  const app=express();
  app.use(express.json({limit:'10kb'}));
  app.get('/health',(_req,res)=>res.json({ready:true}));
  app.use('/api/v1/twitch/advanced/prediction',
    createTwitchPredictionCreateRouter({
      service:new StreamcockpitPredictionCreateService(
        new PredictionCreateTwitch(()=>credential,mockFetch as typeof fetch)),
      actor:(req:Request)=>twitchPollActor(req,auth,false,true),
      hostLive:()=>epoch,
    }));
  let server:ReturnType<typeof app.listen>|undefined,root='';
  for (let attempt=0;attempt<8;attempt++) {
    const candidate=app.listen(0,'127.0.0.1');
    await new Promise<void>((ok,fail)=>{
      candidate.once('listening',ok);candidate.once('error',fail);
    });
    const url='http://127.0.0.1:'+(candidate.address() as AddressInfo).port;
    try {await fetch(url+'/health');server=candidate;root=url;break;}
    catch(error) {
      candidate.closeAllConnections();
      await new Promise<void>(done=>candidate.close(()=>done()));
      if ((error as {cause?:{message?:string}}).cause?.message!=='bad port')throw error;
    }
  }
  if (!server) throw new Error('UNAVAILABLE_TEST_LOOPBACK_PORT');
  const request=(path:string,body?:unknown,token=paired.credential,method='POST') =>
    fetch(root+'/api/v1/twitch/advanced/prediction/'+path,{
      method,headers:{Authorization:'Device '+token,'Content-Type':'application/json'},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),
    });
  try {
    await run({request,token:paired.credential,auth,reads,writes,
      setMode:x=>{mode=x},setEpoch:x=>{epoch=x},
      rotateToken:()=>{credential.accessToken='ROTATED_PRIVATE_TOKEN'},
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>(done=>server.close(()=>done()));
  }
}

it('F08 prediction creation allowlist is exactly POST preview/confirm with manage chat+cloud pairing',()=>fixture(async h=>{
  for(const path of ['preview','confirm']){
    const route='/v1/twitch/advanced/prediction/'+path;
    expect(isRemoteApiAllowed('POST',route)).toBe(true);
    expect(isRemoteApiAllowed('GET',route)).toBe(false);
    expect(requiredDevicePermissions('POST',route,{})).toEqual(['chat','cloud']);
    expect((await h.request(path,undefined,h.token,'GET')).status).toBe(405);
  }
  expect((await h.request('preview',{draft},'no-token')).status).toBe(401);
  const offer=h.auth.createPairing(undefined,false,['chat','cloud']);
  const limited=h.auth.pair(offer.id,offer.code,'Reader only');
  expect((await h.request('preview',{draft},limited.credential)).status).toBe(403);
  expect(h.reads).not.toHaveBeenCalled();
  expect(h.writes).not.toHaveBeenCalled();
}));

it('F08 prediction preview is GET-only, explicit confirm emits EXACTLY one Twitch POST, replay rejected',()=>fixture(async h=>{
  const preview=await h.request('preview',{draft});
  expect(preview.status).toBe(200);
  expect(preview.headers.get('cache-control')).toContain('no-store');
  const data=await preview.json();
  expect(data).toMatchObject({kind:'streamcockpit-prediction-preview',draft});
  expect(typeof data.confirmationId).toBe('string');
  expect(h.reads).toHaveBeenCalledTimes(3);
  expect(h.writes).not.toHaveBeenCalled();
  const result=await h.request('confirm',{confirmed:true,confirmationId:data.confirmationId});
  expect(result.status).toBe(200);
  expect(await result.json()).toMatchObject({kind:'streamcockpit-prediction-confirmation',
    status:'confirmed',predictionId:'pred-777'});
  expect(h.writes).toHaveBeenCalledTimes(1);
  expect(JSON.parse(h.writes.mock.calls[0][1])).toEqual({
    broadcaster_id:'123',title:'Quel boss ?',outcomes:[{title:'A'},{title:'B'}],
    prediction_window:60,
  });
  expect((await h.request('confirm',{confirmed:true,confirmationId:data.confirmationId})).status).toBe(409);
  expect(h.writes).toHaveBeenCalledTimes(1);
}));

it('F08 malformed prediction draft/confirmation fails before provider IO',()=>fixture(async h=>{
  for(const invalid of [
    {title:'',outcomes:['A','B'],predictionWindow:60},
    {title:'OK',outcomes:['A','A'],predictionWindow:60},
    {title:'OK',outcomes:['A','B'],predictionWindow:10},
    {title:'OK',outcomes:['A','B'],predictionWindow:60,unexpected:true},
  ]){
    const res=await h.request('preview',{draft:invalid});
    expect(res.status).toBe(400);
  }
  expect((await h.request('confirm',{confirmed:false,confirmationId:'abc'})).status).toBe(400);
  expect(h.reads).not.toHaveBeenCalled();
  expect(h.writes).not.toHaveBeenCalled();
}));

it('F08 revoked or changed OBS stream epoch denies preview/confirm without POST',()=>fixture(async h=>{
  h.setEpoch(undefined);
  expect((await h.request('preview',{draft})).status).toBe(409);
  h.setEpoch('8:23');
  const preview=await (await h.request('preview',{draft})).json();
  h.setEpoch('8:24');
  expect((await h.request('confirm',{confirmed:true,confirmationId:preview.confirmationId})).status).toBe(409);
  expect(h.writes).not.toHaveBeenCalled();
}));

it('F08 OBS epoch change DURING preflight denies prior consent with no POST',()=>fixture(async h=>{
  const preview=await (await h.request('preview',{draft})).json();
  h.setMode('epoch-after-get');
  expect((await h.request('confirm',{confirmed:true,confirmationId:preview.confirmationId})).status).toBe(409);
  expect(h.writes).not.toHaveBeenCalled();
}));

it('F08 token rotation after preview revokes consent before Twitch POST',()=>fixture(async h=>{
  const preview=await (await h.request('preview',{draft})).json();
  h.rotateToken();
  expect((await h.request('confirm',{confirmed:true,confirmationId:preview.confirmationId})).status).toBe(409);
  expect(h.writes).not.toHaveBeenCalled();
}));

it('F08 wrong owner, missing manage scope, ineligible channel and current prediction fail closed',()=>fixture(async h=>{
  for(const mode of ['wrong-owner','scope','not-affiliate','active','unknown']){
    h.setMode(mode);
    expect((await h.request('preview',{draft})).status).toBeGreaterThanOrEqual(400);
    expect(h.writes).not.toHaveBeenCalled();
  }
}));

it('F08 concurrent confirmation consumes single in-memory consent before any await',()=>fixture(async h=>{
  const preview=await (await h.request('preview',{draft})).json();
  const [a,b]=await Promise.all([
    h.request('confirm',{confirmed:true,confirmationId:preview.confirmationId}),
    h.request('confirm',{confirmed:true,confirmationId:preview.confirmationId}),
  ]);
  expect([a.status,b.status].sort()).toEqual([200,409]);
  expect(h.writes).toHaveBeenCalledTimes(1);
}));

it('F08 two DIFFERENT consent IDs for the same channel cannot create twice',()=>fixture(async h=>{
  const first=await (await h.request('preview',{draft})).json();
  const second=await (await h.request('preview',{draft})).json();
  expect(first.confirmationId).not.toBe(second.confirmationId);
  const [a,b]=await Promise.all([
    h.request('confirm',{confirmed:true,confirmationId:first.confirmationId}),
    h.request('confirm',{confirmed:true,confirmationId:second.confirmationId}),
  ]);
  expect([a.status,b.status].sort()).toEqual([200,409]);
  expect(h.writes).toHaveBeenCalledTimes(1);
  expect((await h.request('preview',{draft})).status).toBe(409);
}));

it('F08 confirmed NO-POST preflight failure releases channel fence safely',()=>fixture(async h=>{
  const first=await (await h.request('preview',{draft})).json();
  h.setMode('wrong-owner');
  expect((await h.request('confirm',{confirmed:true,confirmationId:first.confirmationId})).status).toBe(403);
  expect(h.writes).not.toHaveBeenCalled();
  h.setMode('normal');
  const second=await (await h.request('preview',{draft})).json();
  expect((await h.request('confirm',{confirmed:true,confirmationId:second.confirmationId})).status).toBe(200);
  expect(h.writes).toHaveBeenCalledTimes(1);
}));

it.each(['lost-post','post-error'])('F08 %s POST receipt is UNCERTAIN, blocks new consents',mode=>fixture(async h=>{
  const preview=await (await h.request('preview',{draft})).json();
  h.setMode(mode);
  const confirmation=await h.request('confirm',{confirmed:true,confirmationId:preview.confirmationId});
  expect(confirmation.status).toBe(503);
  expect(await confirmation.json()).toMatchObject({error:{
    code:'PREDICTION_OUTCOME_UNCERTAIN',retryable:false,
  }});
  expect((await h.request('confirm',{confirmed:true,confirmationId:preview.confirmationId})).status).toBe(409);
  h.setMode('normal');
  expect((await h.request('preview',{draft})).status).toBe(409);
  expect(h.writes).toHaveBeenCalledTimes(1);
}));

it('F08 normalizer strips whitespace but refuses unknown fields and duplicate choices',()=>{
  expect(normalizePredictionCreate({title:' A ',outcomes:[' Oui ','Non'],predictionWindow:120}))
    .toEqual({title:'A',outcomes:['Oui','Non'],predictionWindow:120});
});

it('F08 prediction create endpoints are mounted on FIXE server and deny unauthenticated loopback',async()=>{
  const {startDashboardServer}=await import('../apps/server/src/index.js');
  const {mkdtemp,rm}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os');
  const {join}=await import('node:path');
  const dir=await mkdtemp(join(tmpdir(),'sc3-prediction-create-mount-'));
  let server:Awaited<ReturnType<typeof startDashboardServer>>|undefined;
  try {
    for(let attempt=0;attempt<8;attempt++){
      const candidate=await startDashboardServer({
        port:0,dataDir:dir,remoteEnabled:false,obsEnabled:false,timerAuthority:false,
        logger:{info(){},warn(){},error(){}},
      });
      try {await fetch(candidate.url+'/api/v1/health');server=candidate;break;}
      catch(error){
        await candidate.stop();
        if((error as {cause?:{message?:string}})?.cause?.message!=='bad port')throw error;
      }
    }
    if(!server)throw Error('TEST_PORT_UNAVAILABLE');
    for(const route of ['preview','confirm']){
      const result=await fetch(server.url+'/api/v1/twitch/advanced/prediction/'+route,{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify(route==='preview'?{draft}:{confirmed:true,confirmationId:'11111111-1111-4111-8111-111111111111'}),
      });
      expect(result.status).toBeGreaterThanOrEqual(400);
      expect(result.status).not.toBe(404);
      const text=await result.text();
      expect(text).not.toContain('accessToken');
    }
  }finally{await server?.stop();await rm(dir,{recursive:true,force:true});}
},30000);
