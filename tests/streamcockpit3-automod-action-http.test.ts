import {expect,it,vi} from 'vitest';
import express from 'express';
import {request as httpRequest} from 'node:http';
import type {AddressInfo} from 'node:net';
import {RemoteAuth} from '../apps/server/src/remote-auth.js';
import {twitchPollActor} from '../apps/server/src/streamcockpit-twitch-poll-router.js';
import {createTwitchModerationRouter} from '../apps/server/src/streamcockpit-twitch-moderation-router.js';
import {HeldAutoModActionTwitch} from '../integrations/twitch/src/streamcockpit-automod-action.js';
import {ObservedAutoModQueue,parseAutomodNotification} from '../integrations/twitch/src/streamcockpit-automod-queue.js';
import {isRemoteApiAllowed,requiredDevicePermissions} from '../apps/server/src/remote-api-policy.js';

const hold=(messageId='hold-1')=>({metadata:{message_type:'notification',subscription_type:'automod.message.hold',subscription_version:'2'},
  payload:{event:{broadcaster_user_id:'42',user_id:'12',message_id:messageId,user_name:'Viewer',
    reason:'automod',held_at:'2026-11-06T10:00:00Z',message:{text:'PRIVATE_HELD_MESSAGE'}}}});
const update=()=>({metadata:{message_type:'notification',subscription_type:'automod.message.update',subscription_version:'2'},
  payload:{event:{broadcaster_user_id:'42',message_id:'hold-1',status:'approved'}}});
const draft={messageId:'hold-1',userId:'12',decision:'ALLOW'};
async function fixture(run:(f:any)=>Promise<void>){
  const auth=new RemoteAuth(),p=auth.createPairing(undefined,true,['chat','cloud']),paired=auth.pair(p.id,p.code,'Android');
  let clock=Date.now(),host='FIXE',mode='ok',writes=0;
  const creds={clientId:'client',accessToken:'SECRET_AUTH_TOKEN',broadcasterId:'42'};
  const queue=new ObservedAutoModQueue(()=>clock);queue.connection('CONNECTED','42');
  queue.receive(parseAutomodNotification(hold())!);
  const fetchApi=vi.fn(async(url:unknown,init?:RequestInit)=>{
    if(String(url).includes('/validate'))return Response.json({client_id:'client',user_id:'42',
      scopes:mode==='no-scope'?[]:['moderator:manage:automod'],expires_in:3600});
    expect(String(url)).toBe('https://api.twitch.tv/helix/moderation/automod/message');
    expect(init?.method).toBe('POST');
    expect(init?.redirect).toBe('error');
    expect(JSON.parse(String(init?.body))).toEqual({user_id:'12',msg_id:'hold-1',action:'ALLOW'});
    writes++;
    if(mode==='lost')throw Error('PRIVATE_PROVIDER_EXCEPTION');
    if(mode==='forbidden')return new Response(null,{status:403});
    return new Response(null,{status:204});
  });
  const app=express();app.use(express.json());
  app.use('/moderation',createTwitchModerationRouter({
    api:{} as never,actionApi:new HeldAutoModActionTwitch(()=>creds,fetchApi as typeof fetch,()=>clock),
    actor:req=>twitchPollActor(req,auth,false,true),host:()=>host,now:()=>clock,
    held:()=>queue.snapshot('42',true),
  }));
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  const call=(path:string,body?:unknown,token=paired.credential,method='POST')=>new Promise<{status:number;body:any;headers:any}>((resolve,reject)=>{
    const req=httpRequest('http://127.0.0.1:'+(server.address()as AddressInfo).port+'/moderation/'+path,{
      method,headers:{Authorization:'Device '+token,'Content-Type':'application/json'}},res=>{
        const chunks:Buffer[]=[];res.on('data',c=>chunks.push(c));res.on('error',reject);
        res.on('end',()=>{try{resolve({status:res.statusCode||0,body:JSON.parse(Buffer.concat(chunks).toString()),headers:res.headers});}catch(error){reject(error)}});
      });
    req.on('error',reject);req.setTimeout(5000,()=>req.destroy(Error('TIMEOUT')));req.end(body===undefined?undefined:JSON.stringify(body));
  });
  try{await run({call,paired,auth,queue,creds,fetchApi,
    setMode:(v:string)=>{mode=v},setHost:(v:string)=>{host=v},advance:(ms:number)=>{clock+=ms},
    state:()=>({writes,clock})});}
  finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
}
it('F02 manual observed hold: preview reads scope, explicit one-use confirm sends exactly one POST and does not claim approval',async()=>fixture(async f=>{
  const route='/v1/twitch/advanced/moderation/held-action/';
  for(const op of ['preview','confirm']){
    expect(isRemoteApiAllowed('POST',route+op)).toBe(true);
    expect(isRemoteApiAllowed('GET',route+op)).toBe(false);
    expect(requiredDevicePermissions('POST',route+op,{})).toEqual(['chat','cloud']);
  }
  expect((await f.call('held-action/preview',draft,'wrong')).status).toBe(401);
  expect((await f.call('held-action/preview',undefined,undefined,'GET')).status).toBe(405);
  expect(f.state().writes).toBe(0);
  const p=await f.call('held-action/preview',draft);
  expect(p.status).toBe(200);expect(p.body).toMatchObject({
    kind:'streamcockpit-automod-action-preview',decision:'ALLOW',messageId:'hold-1',userId:'12'});
  expect(p.headers['cache-control']).toBe('private, no-store');
  expect(f.state().writes).toBe(0);
  const body={confirmationId:p.body.confirmationId,confirmed:true};
  const results=await Promise.all([f.call('held-action/confirm',body),f.call('held-action/confirm',body)]);
  expect(results.map((v:any)=>v.status).sort()).toEqual([200,409]);
  expect(results.find((v:any)=>v.status===200).body).toMatchObject({
    kind:'streamcockpit-automod-action-receipt',status:'submitted-unverified',decision:'ALLOW'});
  expect(f.state().writes).toBe(1);
  expect((await f.call('held-action/preview',draft)).status).toBe(409);
  expect(JSON.stringify(results)).not.toContain('SECRET_AUTH_TOKEN');
  expect(JSON.stringify(results)).not.toContain('PRIVATE_HELD_MESSAGE');
}));
it('F02 rejects unobserved/updated message and expired or wrong host confirmation before provider write',async()=>fixture(async f=>{
  expect((await f.call('held-action/preview',{...draft,messageId:'guess'})).status).toBe(409);
  expect((await f.call('held-action/preview',{...draft,userId:'13'})).status).toBe(409);
  const p=await f.call('held-action/preview',draft);f.setHost('OTHER');
  expect((await f.call('held-action/confirm',{confirmationId:p.body.confirmationId,confirmed:true})).status).toBe(409);
  f.setHost('FIXE');const p2=await f.call('held-action/preview',draft);f.advance(31_000);
  expect((await f.call('held-action/confirm',{confirmationId:p2.body.confirmationId,confirmed:true})).status).toBe(409);
  const p3=await f.call('held-action/preview',draft);
  f.queue.receive(parseAutomodNotification(update())!);
  expect((await f.call('held-action/confirm',{confirmationId:p3.body.confirmationId,confirmed:true})).status).toBe(409);
  expect(f.state().writes).toBe(0);
}));
it('F02 scope, token rotation and revoked pairing deny write on both sides of consent',async()=>fixture(async f=>{
  f.setMode('no-scope');expect((await f.call('held-action/preview',draft)).status).toBe(403);
  f.setMode('ok');const p=await f.call('held-action/preview',draft);
  f.creds.accessToken='changed';
  expect((await f.call('held-action/confirm',{confirmationId:p.body.confirmationId,confirmed:true})).status).toBe(409);
  const p2=await f.call('held-action/preview',draft);f.auth.revoke(f.paired.deviceId);
  expect((await f.call('held-action/confirm',{confirmationId:p2.body.confirmationId,confirmed:true})).status).toBe(401);
  expect(f.state().writes).toBe(0);
}));
it.each(['lost','forbidden'])('F02 lost provider acknowledgement %s is uncertain and never resends',async mode=>fixture(async f=>{
  const p=await f.call('held-action/preview',draft);f.setMode(mode);
  const body={confirmationId:p.body.confirmationId,confirmed:true};
  const result=await f.call('held-action/confirm',body);
  expect(result.status).toBe(503);expect(result.body.error).toEqual({code:'MODERATION_UNCERTAIN',retryable:false});
  expect((await f.call('held-action/confirm',body)).status).toBe(409);
  expect((await f.call('held-action/preview',draft)).status).toBe(409);
  expect(f.state().writes).toBe(1);
}));
it('F02 malformed/unsigned decisions never reach Twitch and pairing requires cloud grant',async()=>fixture(async f=>{
  for(const body of [{...draft,decision:'DELETE'},{...draft,messageId:'bad.id'}, {...draft,extra:true},
    {...draft,userId:'not-a-number'}, {...draft,decision:null}]){
    expect((await f.call('held-action/preview',body)).status).toBeGreaterThanOrEqual(400);
  }
  f.auth.setPermissions(f.paired.deviceId,['chat']);
  expect((await f.call('held-action/preview',draft)).status).toBe(403);
  expect(f.state().writes).toBe(0);
}));
