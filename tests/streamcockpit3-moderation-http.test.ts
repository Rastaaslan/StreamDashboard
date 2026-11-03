import {expect,it,vi} from 'vitest';
import express from 'express';
import {request as httpRequest} from 'node:http';
import type {AddressInfo} from 'node:net';
import {ModerationTwitch} from '../integrations/twitch/src/streamcockpit-moderation.js';
import {createTwitchModerationRouter} from '../apps/server/src/streamcockpit-twitch-moderation-router.js';
import {RemoteAuth} from '../apps/server/src/remote-auth.js';
import {twitchPollActor} from '../apps/server/src/streamcockpit-twitch-poll-router.js';
import {isRemoteApiAllowed,requiredDevicePermissions} from '../apps/server/src/remote-api-policy.js';
const autoFields=['aggression','bullying','disability','misogyny','race_ethnicity_or_religion','sex_based_terms','sexuality_sex_or_gender','swearing'];
async function fixture(run:(f:any)=>Promise<void>){
  const auth=new RemoteAuth(),p=auth.createPairing(undefined,true,['chat','cloud']),paired=auth.pair(p.id,p.code,'Android');
  let shield=false,level=1,mode='ok',clock=Date.now(),host='FIXE',entered=false,putCount=0;
  const credentials={clientId:'client',accessToken:'PRIVATE',broadcasterId:'42'};
  const transport=vi.fn(async(input:any,init?:RequestInit)=>{
    const url=String(input),method=init?.method??'GET';
    if(url.includes('/validate'))return Response.json({client_id:'client',user_id:'42',scopes:mode==='scope'?[]:['moderator:manage:shield_mode','moderator:manage:automod_settings'],expires_in:3600});
    const automod=url.includes('/automod/');
    if(method==='PUT'){
      putCount++;entered=true;
      if(mode==='lost')throw Error('PRIVATE token');
      const value=JSON.parse(String(init?.body));if(automod)level=value.overall_level;else shield=value.is_active;
      if(mode==='revoke-after')auth.revoke(paired.deviceId);
    }
    if(mode==='revoke-before'&&method==='GET')auth.revoke(paired.deviceId);
    if(mode==='token-before'&&method==='GET')credentials.accessToken='changed';
    return Response.json({data:[automod?{broadcaster_id:'42',moderator_id:'42',overall_level:level,...Object.fromEntries(autoFields.map(k=>[k,level]))}:{is_active:shield}]});
  });
  const api=new ModerationTwitch(()=>credentials,transport as typeof fetch,()=>clock);
  const app=express();app.use(express.json());app.use('/moderation',createTwitchModerationRouter({api,actor:req=>twitchPollActor(req,auth,false,true),host:()=>host,now:()=>clock}));
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  const call=(path:string,body?:any,token=paired.credential,method='POST')=>new Promise<any>((resolve,reject)=>{
    const req=httpRequest('http://127.0.0.1:'+(server.address()as AddressInfo).port+'/moderation/'+path,{method,headers:{'Content-Type':'application/json',authorization:'Device '+token}},res=>{
      const chunks:Buffer[]=[];res.on('data',c=>chunks.push(c));res.on('error',reject);res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(chunks).toString())})}catch(e){reject(e)}});
    });req.on('error',reject);req.setTimeout(5000,()=>req.destroy(Error('TIMEOUT')));req.end(JSON.stringify(body));
  });
  try{await run({call,transport,auth,paired,setMode:(v:string)=>{mode=v},setHost:(v:string)=>{host=v},advance:()=>{clock+=46_000},state:()=>({shield,level,putCount,entered})})}
  finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
}
it.each([{kind:'shield',value:true},{kind:'automod',value:3}])('F02 real paired HTTP %j: no write on preview; single confirmed PUT and readback',async change=>fixture(async f=>{
  const p=await f.call('preview',{change});expect(p.status).toBe(200);expect(f.state().putCount).toBe(0);
  const body={confirmationId:p.body.confirmationId,confirmed:true};
  const results=await Promise.all([f.call('confirm',body),f.call('confirm',body)]);
  expect(results.map(x=>x.status).sort()).toEqual([200,409]);expect(f.state().putCount).toBe(1);
  expect(results.find(x=>x.status===200).body.status).toBe('confirmed');
  expect(JSON.stringify(results)).not.toContain('PRIVATE');
}));
it.each(['scope','revoke-before','token-before'])('F02 %s cannot reach provider PUT',async mode=>fixture(async f=>{
  f.setMode(mode);expect((await f.call('preview',{change:{kind:'shield',value:true}})).status).toBeGreaterThanOrEqual(400);
  expect(f.state().putCount).toBe(0);
}));
it.each(['lost','revoke-after'])('F02 %s remains uncertain and consumed, never repeats PUT',async mode=>fixture(async f=>{
  const p=await f.call('preview',{change:{kind:'shield',value:true}});f.setMode(mode);
  const body={confirmationId:p.body.confirmationId,confirmed:true},res=await f.call('confirm',body);
  expect(res.status).toBe(503);expect(res.body.error).toMatchObject({code:'MODERATION_UNCERTAIN',retryable:false});
  expect(JSON.stringify(res)).not.toContain('PRIVATE');
  await f.call('confirm',body);expect(f.state().putCount).toBe(1);
}));
it('F02 denies unpaired, chat-only, stale, changed host and malformed requests before mutation',async()=>fixture(async f=>{
  expect((await f.call('preview',{change:{kind:'shield',value:true}},'wrong')).status).toBe(401);
  expect((await f.call('preview',{change:{kind:'automod',value:5}})).status).toBe(400);
  let p=await f.call('preview',{change:{kind:'shield',value:true}});f.advance();
  expect((await f.call('confirm',{confirmationId:p.body.confirmationId,confirmed:true})).status).toBe(409);
  p=await f.call('preview',{change:{kind:'shield',value:true}});f.setHost('OTHER');
  expect((await f.call('confirm',{confirmationId:p.body.confirmationId,confirmed:true})).status).toBe(409);
  f.auth.setPermissions(f.paired.deviceId,['chat']);
  expect((await f.call('preview',{change:{kind:'shield',value:true}})).status).toBe(403);
  expect(f.state().putCount).toBe(0);
}));
it('F02 settings already matching are observed without a PUT; permissions stay explicit',async()=>fixture(async f=>{
  const p=await f.call('preview',{change:{kind:'shield',value:false}});
  const r=await f.call('confirm',{confirmationId:p.body.confirmationId,confirmed:true});
  expect(r.body.status).toBe('unchanged');expect(f.state().putCount).toBe(0);
  for(const op of ['preview','confirm']){
    const path='/v1/twitch/advanced/moderation/'+op;
    expect(isRemoteApiAllowed('POST',path)).toBe(true);expect(isRemoteApiAllowed('GET',path)).toBe(false);
    expect(requiredDevicePermissions('POST',path,{})).toEqual(['chat','cloud']);
  }
}));
