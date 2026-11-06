import {describe,it,expect} from 'vitest';
import express from 'express';
import {request as httpRequest} from 'node:http';
import type {AddressInfo} from 'node:net';
import {createTwitchModerationRouter} from '../apps/server/src/streamcockpit-twitch-moderation-router.js';
import {RemoteAuth} from '../apps/server/src/remote-auth.js';
import {twitchPollActor} from '../apps/server/src/streamcockpit-twitch-poll-router.js';
import {ObservedAutoModQueue,parseAutomodNotification} from '../integrations/twitch/src/streamcockpit-automod-queue.js';
import {isRemoteApiAllowed,requiredDevicePermissions} from '../apps/server/src/remote-api-policy.js';

async function fixture(run:(data:{
  call:(method?:string,token?:string,path?:string)=>Promise<{status:number;body:any;headers:any}>;
  queue:ObservedAutoModQueue;auth:RemoteAuth;paired:{deviceId:string;credential:string};
  setHost:(value:string)=>void;onRead:(callback:()=>void)=>void;
})=>Promise<void>) {
  const auth=new RemoteAuth(),p=auth.createPairing(undefined,true,['chat','cloud']);
  const paired=auth.pair(p.id,p.code,'Android');
  const queue=new ObservedAutoModQueue(()=>10_000);
  queue.connection('CONNECTED','42');
  let host='FIXE',reads=0,onRead=()=>{};
  const app=express();
  app.use('/v1/twitch/advanced/moderation',createTwitchModerationRouter({
    api:{} as never,
    actor:req=>twitchPollActor(req,auth,false,true),
    host:()=>{reads++;onRead();return host;},
    held:()=>queue.snapshot('42',true),
    viewerHistory:userId=>queue.viewerHistory('42',userId,true),
  }));
  const server=app.listen(0,'127.0.0.1');
  await new Promise<void>(resolve=>server.once('listening',resolve));
  const call=(method='GET',token=paired.credential,path='held')=>new Promise<{status:number;body:any;headers:any}>((resolve,reject)=>{
    const req=httpRequest('http://127.0.0.1:'+(server.address()as AddressInfo).port+'/v1/twitch/advanced/moderation/'+path,{
      method,headers:{Authorization:'Device '+token}},res=>{
      const chunks:Buffer[]=[];res.on('data',c=>chunks.push(c));res.on('error',reject);
      res.on('end',()=>{try{resolve({status:res.statusCode||0,body:JSON.parse(Buffer.concat(chunks).toString()),headers:res.headers})}catch(e){reject(e)}});
    });
    req.on('error',reject);req.setTimeout(5000,()=>req.destroy(Error('TIMEOUT')));req.end();
  });
  try{await run({call,queue,auth,paired,setHost:v=>{host=v},onRead:fn=>{onRead=fn}});}
  finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
}

describe('F02 read-only paired observed AutoMod, never Twitch queue completeness',()=>{
  it('authenticated GET returns EventSub observations without provider writes or cache',async()=>fixture(async f=>{
    const event={metadata:{message_type:'notification',subscription_type:'automod.message.hold',subscription_version:'2'},
      payload:{event:{broadcaster_user_id:'42',message_id:'held-1',user_id:'12',user_name:'Viewer',
        reason:'automod',held_at:'2026-11-03T15:00:00Z',message:{text:'review'}}}};
    f.queue.receive(parseAutomodNotification(event)!);
    const r=await f.call();
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('private, no-store');
    expect(r.body).toMatchObject({kind:'streamcockpit-automod-observed',status:'partial-observation',
      messages:[{id:'held-1',text:'review'}]});
    const path='/v1/twitch/advanced/moderation/held';
    expect(isRemoteApiAllowed('GET',path)).toBe(true);
    expect(isRemoteApiAllowed('POST',path)).toBe(false);
    expect(requiredDevicePermissions('GET',path,{})).toEqual(['chat','cloud']);
    expect((await f.call('POST')).status).toBe(405);
  }));
  it('denies stale pairing and missing cloud permission, never reveals messages',async()=>fixture(async f=>{
    expect((await f.call('GET','wrong')).status).toBe(401);
    f.auth.setPermissions(f.paired.deviceId,['chat']);
    const result=await f.call();
    expect(result.status).toBe(403);
    expect(JSON.stringify(result)).not.toContain('review');
  }));
  it('refuses authority change between reads, no stale observation sent',async()=>fixture(async f=>{
    let reads=0;
    f.onRead(()=>{if(++reads===2)f.setHost('NEW_FIXE');});
    const r=await f.call();
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('MODERATION_PRECONDITION');
  }));
  it('returns unavailable after disconnect without claiming an empty Twitch queue',async()=>fixture(async f=>{
    f.queue.connection('DEGRADED','42');
    expect((await f.call()).body).toMatchObject({status:'unavailable',messages:[]});
  }));
  it('selected viewer has strictly scoped read-only AutoMod observations, with pairing and host fences',async()=>fixture(async f=>{
    const hold={metadata:{message_type:'notification',subscription_type:'automod.message.hold',subscription_version:'2'},
      payload:{event:{broadcaster_user_id:'42',message_id:'held1',user_id:'12',user_name:'Viewer',
        reason:'automod',held_at:'2026-11-03T15:00:00Z',message:{text:'PRIVATE_MESSAGE'}}}};
    f.queue.receive(parseAutomodNotification(hold)!);
    f.queue.receive(parseAutomodNotification({
      metadata:{message_type:'notification',subscription_type:'automod.message.update',subscription_version:'2'},
      payload:{event:{broadcaster_user_id:'42',message_id:'held1',status:'approved'}},
    })!);
    const path='/v1/twitch/advanced/moderation/viewer/12';
    expect(isRemoteApiAllowed('GET',path)).toBe(true);
    expect(isRemoteApiAllowed('POST',path)).toBe(false);
    expect(requiredDevicePermissions('GET',path,{})).toEqual(['chat','cloud']);
    const r=await f.call('GET',f.paired.credential,'viewer/12');
    expect(r.status).toBe(200);expect(r.headers['cache-control']).toBe('private, no-store');
    expect(r.body).toMatchObject({kind:'streamcockpit-automod-viewer-observed',
      status:'partial-observation',entries:[{status:'approved',observedAt:10000}]});
    expect(JSON.stringify(r.body)).not.toContain('PRIVATE_MESSAGE');
    expect((await f.call('GET',f.paired.credential,'viewer/987')).body.entries).toHaveLength(0);
    expect((await f.call('GET',f.paired.credential,'viewer/invalid')).status).toBe(400);
    expect((await f.call('POST',f.paired.credential,'viewer/12')).status).toBe(405);
    expect((await f.call('GET','wrong','viewer/12')).status).toBe(401);
    let reads=0;f.onRead(()=>{if(++reads===2)f.setHost('NEW_FIXE')});
    expect((await f.call('GET',f.paired.credential,'viewer/12')).status).toBe(409);
    f.onRead(()=>{});f.setHost('FIXE');
    f.auth.setPermissions(f.paired.deviceId,['chat']);
    expect((await f.call('GET',f.paired.credential,'viewer/12')).status).toBe(403);
    f.queue.connection('DISCONNECTED','42');
    expect(f.queue.viewerHistory('42','12',true)).toMatchObject({status:'unavailable',entries:[]});
    f.queue.connection('CONNECTED','42');
    // The selected viewer's witnessed outcome remains available for 15 minutes
    // across a same-account reconnect, while the old held ACTION is erased.
    expect(f.queue.viewerHistory('42','12',true).entries).toMatchObject([{status:'approved'}]);
    expect(f.queue.snapshot('42',true).messages).toHaveLength(0);
  }));
});
