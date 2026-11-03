import {it,expect,vi} from 'vitest';
import express from 'express';
import {request as httpRequest} from 'node:http';
import type {AddressInfo} from 'node:net';
import {SimpleMomentsTwitch} from '../integrations/twitch/src/streamcockpit-simple-moments.js';
import {createTwitchMomentRouter,twitchMomentActor} from '../apps/server/src/streamcockpit-twitch-moment-router.js';
import {requiredDevicePermissions} from '../apps/server/src/remote-api-policy.js';
import {RemoteAuth} from '../apps/server/src/remote-auth.js';
async function fixture(run:(f:any)=>Promise<void>){
  let mode='ok',host='1:1',streamId='123456',count=0;
  const auth=new RemoteAuth(),p=auth.createPairing(undefined,true,['chat','cloud','clips']),paired=auth.pair(p.id,p.code,'Phone');
  const credentials={clientId:'client',accessToken:'PRIVATE',broadcasterId:'42'},record=vi.fn(async()=> 'recorded' as const);
  const transport=vi.fn(async(url:any,init?:RequestInit)=>{
    if(String(url).includes('/validate'))return Response.json({client_id:'client',user_id:'42',scopes:mode==='scope'?[]:['clips:edit','channel:manage:broadcast'],expires_in:300});
    if(String(url).includes('/streams?')){
      if(mode==='revoke')auth.revoke(paired.deviceId);
      return Response.json({data:mode==='offline'?[]:[{id:streamId,user_id:'42',type:'live'}]});
    }
    if(init?.method==='POST'){
      count++;if(mode==='lost')throw Error('PRIVATE');
      if(mode==='bad-receipt')return Response.json({data:[{id:'clip',edit_url:'https://evil.invalid/private'}]});
      if(String(url).includes('/markers'))return Response.json({data:[{id:'123',created_at:new Date().toISOString(),position_seconds:17,description:'Important'}]});
      return Response.json({data:[{id:'SafeClip',edit_url:'https://clips.twitch.tv/SafeClip/edit'}]});
    }
    throw Error('Unexpected provider request');
  });
  const app=express();app.use(express.json());app.use('/moment',createTwitchMomentRouter({api:new SimpleMomentsTwitch(()=>credentials,transport as typeof fetch),
    actor:req=>twitchMomentActor(req,auth,false,true),hostLive:()=>host,record}));
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  const call=(path:string,body?:any)=>new Promise<any>((resolve,reject)=>{
    const req=httpRequest('http://127.0.0.1:'+(server.address()as AddressInfo).port+'/moment/'+path,{method:'POST',headers:{'Content-Type':'application/json',authorization:'Device '+paired.credential}},res=>{
      const chunks:Buffer[]=[];res.on('data',c=>chunks.push(c));res.on('error',reject);res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(chunks).toString())})}catch(e){reject(e)}});
    });req.on('error',reject);req.setTimeout(5000,()=>req.destroy(Error('TIMEOUT')));req.end(JSON.stringify(body));
  });
  try{await run({call,record,transport,setMode:(v:string)=>{mode=v},setHost:(v:string)=>{host=v},setStreamId:(v:string)=>{streamId=v},writes:()=>count})}
  finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
}
it.each(['marker','clip'])('F04 paired HTTP %s: source live proof, exact receipt, one POST and F09 observation',async kind=>fixture(async f=>{
  const p=await f.call('preview',{draft:{kind,description:'Important'}});expect(p.status).toBe(200);expect(f.writes()).toBe(0);
  const body={confirmationId:p.body.confirmationId,confirmed:true},r=await f.call('confirm',body);
  expect(r.status).toBe(200);expect(r.body).toMatchObject({kind:'streamcockpit-moment-confirmation',momentKind:kind,status:kind==='marker'?'confirmed':'accepted',journal:'recorded'});
  expect(f.record).toHaveBeenCalledOnce();expect(f.record.mock.calls[0][0]).toMatchObject({kind,correlationId:p.body.confirmationId});
  expect((await f.call('confirm',body)).status).toBe(409);expect(f.writes()).toBe(1);expect(JSON.stringify(r)).not.toContain('PRIVATE');
}));
it.each(['scope','offline','revoke'])('F04 %s cannot issue a provider POST',async mode=>fixture(async f=>{
  f.setMode(mode);expect((await f.call('preview',{draft:{kind:'clip',description:''}})).status).toBeGreaterThanOrEqual(400);expect(f.writes()).toBe(0);expect(f.record).not.toHaveBeenCalled();
}));
it.each(['lost','bad-receipt'])('F04 %s remains uncertain and never recreates a clip',async mode=>fixture(async f=>{
  const p=await f.call('preview',{draft:{kind:'clip',description:''}});f.setMode(mode);
  const body={confirmationId:p.body.confirmationId,confirmed:true};
  const r=await f.call('confirm',body);expect(r.status).toBe(503);expect(r.body.error).toEqual({code:'MOMENT_UNCERTAIN',retryable:false});
  await f.call('confirm',body);expect(f.writes()).toBe(1);expect(f.record).not.toHaveBeenCalled();
}));
it('F04 invalidates consent on host epoch change and distinguishes journal failure from provider receipt',async()=>fixture(async f=>{
  let p=await f.call('preview',{draft:{kind:'marker',description:'Important'}});f.setHost('1:2');
  expect((await f.call('confirm',{confirmationId:p.body.confirmationId,confirmed:true})).status).toBe(409);expect(f.writes()).toBe(0);
  p=await f.call('preview',{draft:{kind:'marker',description:'Important'}});
  f.record.mockRejectedValueOnce(Error('PRIVATE'));
  const r=await f.call('confirm',{confirmationId:p.body.confirmationId,confirmed:true});
  expect(r.body).toMatchObject({status:'confirmed',journal:'uncertain'});expect(f.writes()).toBe(1);expect(JSON.stringify(r)).not.toContain('PRIVATE');
}));

it.each(['marker','clip'])('F04 %s consent is tied to Twitch stream ID across a rapid restart',async kind=>fixture(async f=>{
  const initial=await f.call('preview',{draft:{kind,description:'Important'}});
  expect(initial.status).toBe(200);
  f.setStreamId('123457'); // Same broadcaster and FIXE host epoch, different Twitch live session.
  const stale=await f.call('confirm',{confirmationId:initial.body.confirmationId,confirmed:true});
  expect(stale.status).toBe(409);
  expect(stale.body.error).toEqual({code:'MOMENT_PRECONDITION',retryable:false});
  expect(f.writes()).toBe(0);expect(f.record).not.toHaveBeenCalled();
  const fresh=await f.call('preview',{draft:{kind,description:'Important'}});
  expect(fresh.status).toBe(200);
  const valid=await f.call('confirm',{confirmationId:fresh.body.confirmationId,confirmed:true});
  expect(valid.status).toBe(200);expect(f.writes()).toBe(1);
}));
it.each(['','not-a-stream-id'])('F04 refuses a Twitch live response without a trustworthy stream ID',async streamId=>fixture(async f=>{
  f.setStreamId(streamId);
  const preview=await f.call('preview',{draft:{kind:'clip',description:''}});
  expect(preview.status).toBe(409);
  expect(f.writes()).toBe(0);
}));

it('F04 public moment mutations additionally require the clips grant',()=>{
  const auth=new RemoteAuth(),p=auth.createPairing(undefined,true,['chat','cloud']),session=auth.pair(p.id,p.code,'No clips');
  const req={headers:{authorization:'Device '+session.credential}} as import('express').Request;
  expect(()=>twitchMomentActor(req,auth,false,true)).toThrow('forbidden');
  for(const op of ['preview','confirm'])expect(requiredDevicePermissions('POST','/v1/twitch/advanced/moment/'+op,{})).toEqual(['chat','cloud','clips']);
});
