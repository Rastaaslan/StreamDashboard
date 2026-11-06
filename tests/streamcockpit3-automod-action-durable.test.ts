import {expect,it} from 'vitest';
import express from 'express';
import {request as httpRequest} from 'node:http';
import type {AddressInfo} from 'node:net';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {RemoteAuth} from '../apps/server/src/remote-auth.js';
import {twitchPollActor} from '../apps/server/src/streamcockpit-twitch-poll-router.js';
import {createTwitchModerationRouter} from '../apps/server/src/streamcockpit-twitch-moderation-router.js';
import {AutoModActionIntentSqlite} from '../apps/server/src/streamcockpit-automod-action-intent-sqlite.js';
import {HeldAutoModActionTwitch} from '../integrations/twitch/src/streamcockpit-automod-action.js';
import {ObservedAutoModQueue,parseAutomodNotification} from '../integrations/twitch/src/streamcockpit-automod-queue.js';

const hold=(messageId='held-1')=>({metadata:{message_type:'notification',subscription_type:'automod.message.hold',subscription_version:'2'},
  payload:{event:{broadcaster_user_id:'42',user_id:'12',message_id:messageId,user_name:'Viewer',reason:'automod',
    held_at:'2026-11-06T10:00:00Z',message:{text:'private message'}}}});
async function withTemp(fn:(file:string)=>Promise<void>){
  const folder=await mkdtemp(join(tmpdir(),'sc3-f02-durable-'));
  try{await fn(join(folder,'automod-action-intents.sqlite'));}
  finally{await rm(folder,{recursive:true,force:true});}
}
async function startHost(file:string,onWrite:()=>Promise<Response>){
  const auth=new RemoteAuth(),p=auth.createPairing(undefined,true,['chat','cloud']),paired=auth.pair(p.id,p.code,'Android');
  const clock=Date.now(),queue=new ObservedAutoModQueue(()=>clock);
  queue.connection('CONNECTED','42');queue.receive(parseAutomodNotification(hold())!);
  const creds={clientId:'client',accessToken:'PRIVATE_TOKEN',broadcasterId:'42'};
  const provider=async(url:unknown)=>{
    if(String(url).includes('oauth2/validate'))
      return Response.json({client_id:'client',user_id:'42',scopes:['moderator:manage:automod'],expires_in:3600});
    return await onWrite();
  };
  const app=express();app.use(express.json());
  app.use('/moderation',createTwitchModerationRouter({
    api:{} as never,actionApi:new HeldAutoModActionTwitch(()=>creds,provider as typeof fetch,()=>clock),
    actionAttempts:new AutoModActionIntentSqlite(file),
    actor:req=>twitchPollActor(req,auth,false,true),host:()=> 'FIXE',now:()=>clock,
    held:()=>queue.snapshot('42',true),
  }));
  const server=app.listen(0,'127.0.0.1');
  await new Promise<void>(resolve=>server.once('listening',resolve));
  const call=(endpoint:string,body:unknown)=>new Promise<{status:number;body:any}>((resolve,reject)=>{
    const req=httpRequest('http://127.0.0.1:'+(server.address() as AddressInfo).port+'/moderation/'+endpoint,{
      method:'POST',headers:{Authorization:'Device '+paired.credential,'Content-Type':'application/json'}},res=>{
        const chunks:Buffer[]=[];res.on('data',c=>chunks.push(c));res.on('error',reject);
        res.on('end',()=>{try{resolve({status:res.statusCode||0,body:JSON.parse(Buffer.concat(chunks).toString())});}
          catch(error){reject(error)}});
      });
    req.on('error',reject);req.setTimeout(5000,()=>req.destroy(Error('TIMEOUT')));req.end(JSON.stringify(body));
  });
  return {call,close:async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}};
}
it.each(['accepted','lost'] as const)('F02 %s AutoMod POST reserves before provider and never repeats after host/router restart',async mode=>withTemp(async file=>{
  let posts=0;
  const provider=async()=>{posts++;if(mode==='lost')throw Error('PRIVATE lost response');return new Response(null,{status:204})};
  const before=await startHost(file,provider);
  try{
    const preview=await before.call('held-action/preview',{messageId:'held-1',userId:'12',decision:'ALLOW'});
    expect(preview.status).toBe(200);
    const sent=await before.call('held-action/confirm',{confirmationId:preview.body.confirmationId,confirmed:true});
    expect(sent.status).toBe(mode==='accepted'?200:503);
    expect(posts).toBe(1);
  }finally{await before.close();}
  const after=await startHost(file,provider);
  try{
    // Newly observed hold and fresh actor/UUID cannot permit the same Twitch POST.
    expect((await after.call('held-action/preview',{messageId:'held-1',userId:'12',decision:'DENY'})).status).toBe(409);
    expect(posts).toBe(1);
  }finally{await after.close();}
}));
it('F02 one-shot SQLite reservation is shared across independent clients, scoped by broadcaster+message',()=>withTemp(async file=>{
  const a=new AutoModActionIntentSqlite(file),b=new AutoModActionIntentSqlite(file);
  expect(a.isBlocked('42','held-1')).toBe(false);
  expect(a.reserve('42','held-1','12','ALLOW')).toBe(true);
  expect(b.isBlocked('42','held-1')).toBe(true);
  expect(b.reserve('42','held-1','12','DENY')).toBe(false);
  expect(b.reserve('42','held-2','12','DENY')).toBe(true);
  expect(new AutoModActionIntentSqlite(file).isBlocked('42','held-2')).toBe(true);
}));
it('F02 rejects an NTFS alternate-data-stream path before any database action',()=>withTemp(async file=>{
  if(process.platform==='win32')
    expect(()=>new AutoModActionIntentSqlite(file+':shadow.sqlite')).toThrow('AUTOMOD_ACTION_FENCE_UNAVAILABLE');
}));
it('F02 refuses a newly corrupted journal between consent and commit, without any Helix POST',()=>withTemp(async file=>{
  let writes=0;
  const host=await startHost(file,async()=>{writes++;return new Response(null,{status:204})});
  try{
    const preview=await host.call('held-action/preview',{messageId:'held-1',userId:'12',decision:'ALLOW'});
    expect(preview.status).toBe(200);
    const raw=Buffer.from('corrupted between preview and consent');
    await writeFile(file,raw);
    const result=await host.call('held-action/confirm',{confirmationId:preview.body.confirmationId,confirmed:true});
    expect(result.status).toBe(503);
    expect(result.body.error).toMatchObject({retryable:false});
    expect(writes).toBe(0);
    expect(await readFile(file)).toEqual(raw);
  }finally{await host.close()}
}));
it('F02 malformed local database fails closed before Helix POST and remains byte-identical',()=>withTemp(async file=>{
  const raw=Buffer.from('foreign data with no SQLite identity');
  await writeFile(file,raw);
  const host=await startHost(file,async()=>{throw Error('must not reach Twitch')});
  try{
    const reply=await host.call('held-action/preview',{messageId:'held-1',userId:'12',decision:'ALLOW'});
    expect(reply.status).toBe(503);
    expect(reply.body.error).toMatchObject({retryable:false});
  }finally{await host.close();}
  expect(await readFile(file)).toEqual(raw);
}));
