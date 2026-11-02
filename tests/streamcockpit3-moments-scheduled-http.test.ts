import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express, { type Request } from 'express';
import { expect, it } from 'vitest';
import { RemoteAuth } from '../apps/server/src/remote-auth.js';
import { ScheduledMomentBinding } from '../apps/server/src/streamcockpit-moments-scheduled.js';
import { createMomentsManualRouter } from '../apps/server/src/streamcockpit-moments-manual-router.js';
import { isRemoteApiAllowed, requiredDevicePermissions } from '../apps/server/src/remote-api-policy.js';

const now = Date.parse('2030-01-01T20:00:00Z');
const planned = {id:'series::20300101',title:'Minecraft prévu',category:'live' as const,kind:'LIVE' as const,
  startAtUtc:new Date(now-60000).toISOString(),endAtUtc:new Date(now+3600000).toISOString()};
async function fixture(run: (f: {
  url: string; auth: RemoteAuth; deviceId: string; credential: string; tracker: ScheduledMomentBinding;
  setReader:(reader:(()=>Promise<ReturnType<ScheduledMomentBinding['snapshot']>>) | undefined)=>void;
})=>Promise<void>) {
  const tracker=new ScheduledMomentBinding();
  const observe=(streaming:boolean)=>tracker.observe({connected:true,streamingKnown:true,streaming,
    connectionGeneration:1,observedAt:now,planning:()=>[planned]});
  observe(false);observe(true);
  const auth=new RemoteAuth(), pairing=auth.createPairing(undefined,false,['observe','clips']);
  const paired=auth.pair(pairing.id,pairing.code,'Android test');
  let reader:(()=>Promise<ReturnType<ScheduledMomentBinding['snapshot']>>) | undefined;
  const app=express();app.use(express.json({limit:'4kb'}));
  app.use('/api/v1/streamcockpit-moments/manual',createMomentsManualRouter({
    authorize(req:Request){
      const credential=req.headers.authorization?.match(/^Device (\S+)$/)?.[1];
      const id=credential?auth.authenticate(credential):null;
      return id && auth.permits(id,['observe','clips']) ? id : undefined;
    },
    activeSessionId:async()=>tracker.activeSessionId(),
    recordManual:async()=>{throw new Error('Not exercised here');},
    lookupManual:async()=>({journalObserved:false}),
    listScheduled:async()=>reader?reader():tracker.snapshot(),
    selectScheduled:async id=>tracker.select(id),
  }));
  const server=createServer(app);
  try {
    await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    await run({url:'http://127.0.0.1:'+(server.address() as AddressInfo).port+
      '/api/v1/streamcockpit-moments/manual',auth,deviceId:paired.deviceId,credential:paired.credential,
      tracker,setReader:value=>{reader=value;}});
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve=>server.close(()=>resolve()));
  }
}
const call=(url:string,credential:string,method:'GET'|'POST'='GET',body?:unknown)=>fetch(url,{
  method,headers:{Authorization:'Device '+credential,'Content-Type':'application/json'},
  body:method==='POST'?JSON.stringify(body):undefined,
});

it('F09 scheduled browser APIs permit paired observe+clips only; user explicitly binds witnessed OBS run',()=>fixture(async f=>{
  expect(isRemoteApiAllowed('GET','/v1/streamcockpit-moments/manual/scheduled')).toBe(true);
  expect(isRemoteApiAllowed('POST','/v1/streamcockpit-moments/manual/scheduled/select')).toBe(true);
  expect(isRemoteApiAllowed('POST','/v1/streamcockpit-moments/manual/scheduled')).toBe(false);
  expect(isRemoteApiAllowed('GET','/v1/streamcockpit-moments/manual/scheduled/select')).toBe(false);
  expect(requiredDevicePermissions('GET','/v1/streamcockpit-moments/manual/scheduled',{})).toEqual(['observe','clips']);
  expect(requiredDevicePermissions('POST','/v1/streamcockpit-moments/manual/scheduled/select',{})).toEqual(['observe','clips']);
  expect((await call(f.url+'/scheduled','invalid')).status).toBe(403);
  f.auth.setPermissions(f.deviceId,['observe']);
  expect((await call(f.url+'/scheduled',f.credential)).status).toBe(403);
  f.auth.setPermissions(f.deviceId,['observe','clips']);
  const list=await call(f.url+'/scheduled',f.credential);
  expect(list.status).toBe(200);
  expect(list.headers.get('cache-control')).toContain('no-store');
  expect(await list.json()).toEqual({schemaVersion:1,kind:'streamcockpit-scheduled-candidates',
    available:true,candidates:[{id:planned.id,title:planned.title,startAtUtc:planned.startAtUtc}]});
  expect((await call(f.url+'/scheduled/select',f.credential,'POST',{scheduleId:'not_in_host_plan'})).status).toBe(409);
  expect((await call(f.url+'/scheduled/select',f.credential,'POST',{scheduleId:'x',sessionId:'fake'})).status).toBe(400);
  const selected=await call(f.url+'/scheduled/select',f.credential,'POST',{scheduleId:planned.id});
  expect(selected.status).toBe(200);
  const receipt=await selected.json();
  expect(receipt).toMatchObject({schemaVersion:1,kind:'streamcockpit-scheduled-binding',
    sessionId:expect.stringMatching(/^scheduled_[0-9a-f]{64}$/)});
  expect((await (await call(f.url+'/context',f.credential)).json()).sessionId).toBe(receipt.sessionId);
  expect((await (await call(f.url+'/scheduled/select',f.credential,'POST',{scheduleId:planned.id})).json()).sessionId).toBe(receipt.sessionId);
  f.tracker.observe({connected:false,streamingKnown:false,streaming:false,connectionGeneration:1,observedAt:now,planning:()=>[planned]});
  expect((await (await call(f.url+'/scheduled',f.credential)).json()).available).toBe(false);
  expect((await call(f.url+'/scheduled/select',f.credential,'POST',{scheduleId:planned.id})).status).toBe(409);
}));

it('F09 scheduled candidate response cannot leak after pairing revoked during host read',()=>fixture(async f=>{
  let opened!:()=>void, release!:()=>void;
  const entered=new Promise<void>(resolve=>{opened=resolve;});
  const gate=new Promise<void>(resolve=>{release=resolve;});
  f.setReader(async()=>{opened();await gate;return f.tracker.snapshot();});
  const pending=call(f.url+'/scheduled',f.credential);
  await entered;f.auth.revoke(f.deviceId);release();
  const result=await pending;
  expect(result.status).toBe(403);
  expect(await result.text()).not.toContain(planned.title);
}));
