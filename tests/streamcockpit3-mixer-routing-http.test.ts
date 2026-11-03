import {describe,it,expect,vi} from 'vitest';
import express,{type Request} from 'express';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {createMixerRouter} from '../apps/server/src/streamcockpit-mixer-router.js';
import {isRemoteApiAllowed,requiredDevicePermissions} from '../apps/server/src/remote-api-policy.js';
import {RemoteAuth} from '../apps/server/src/remote-auth.js';

const sample=(name='Game Audio')=>({
  schemaVersion:1 as const,kind:'streamcockpit-obs-audio-routing' as const,
  sourceId:name,generation:4,observedAt:1000,
  tracks:[1,2,3,4,5,6].map(number=>({number,enabled:number===1||number===2})),
  monitorType:'OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT',
  vodTrack:'unverified' as const,
});
async function withRouting(
  task:(h:{
    call:(source?:string,token?:string,method?:string)=>Promise<Response>,
    auth:RemoteAuth,device:string,read:ReturnType<typeof vi.fn>,
    resolve:(value:ReturnType<typeof sample>)=>void,
  })=>Promise<void>,
  deferred=false,
){
  const auth=new RemoteAuth();
  const pairing=auth.createPairing(undefined,false,['observe']);
  const pair=auth.pair(pairing.id,pairing.code,'Android QA');
  let resolve!:(result:ReturnType<typeof sample>)=>void;
  const read=vi.fn((source:string)=>deferred
    ?new Promise<ReturnType<typeof sample>>(ok=>{resolve=ok})
    :Promise.resolve(sample(source)));
  const router=createMixerRouter({
    canRead:(req:Request)=>{
      const key=req.headers.authorization?.match(/^Device (\S+)$/)?.[1];
      const id=key?auth.authenticate(key):null;
      return Boolean(id&&auth.permits(id,['observe']));
    },
    readSnapshot:()=>undefined,readRouting:read,now:()=>1000,
  });
  const app=express();app.use('/api/v1/streamcockpit-mixer',router);
  const server=createServer(app);
  await new Promise<void>((ok,err)=>{server.once('error',err);server.listen(0,'127.0.0.1',ok)});
  const address=server.address() as AddressInfo;
  const call=(source='Game Audio',token=pair.credential,method='GET')=>fetch(
    'http://127.0.0.1:'+address.port+'/api/v1/streamcockpit-mixer/routing?sourceId='+encodeURIComponent(source),{
    method,headers:{Authorization:'Device '+token},
  });
  try{await task({call,auth,device:pair.deviceId,read,resolve:v=>resolve(v)})}
  finally{server.closeAllConnections();await new Promise<void>(ok=>server.close(()=>ok()))}
}
describe('F05 OBS audio tracks only on explicit authenticated read',()=>{
  it('allows only authorized GET with observe permission and never a writer',async()=>{
    expect(isRemoteApiAllowed('GET','/v1/streamcockpit-mixer/routing')).toBe(true);
    expect(isRemoteApiAllowed('POST','/v1/streamcockpit-mixer/routing')).toBe(false);
    expect(isRemoteApiAllowed('HEAD','/v1/streamcockpit-mixer/routing')).toBe(false);
    expect(requiredDevicePermissions('GET','/v1/streamcockpit-mixer/routing',undefined)).toEqual(['observe']);
    await withRouting(async h=>{
      expect((await h.call('Game Audio','bad-token')).status).toBe(403);
      expect(h.read).not.toHaveBeenCalled();
      const response=await h.call();
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      const value=await response.json();
      expect(value).toMatchObject({sourceId:'Game Audio',kind:'streamcockpit-obs-audio-routing',vodTrack:'unverified'});
      expect(value.tracks).toEqual([1,2,3,4,5,6].map(number=>({number,enabled:number===1||number===2})));
      expect(value).not.toHaveProperty('inputUuid');
      expect((await h.call('Game Audio',undefined,'POST')).status).toBe(405);
      expect((await h.call('Game Audio',undefined,'HEAD')).status).toBe(405);
      expect(h.read).toHaveBeenCalledTimes(1);
    });
  });
  it('fails closed when pairing is revoked while OBS routing lookup is in flight',async()=>{
    await withRouting(async h=>{
      const promise=h.call();
      await vi.waitFor(()=>expect(h.read).toHaveBeenCalledOnce());
      h.auth.revoke(h.device);
      h.resolve(sample());
      const response=await promise;
      expect(response.status).toBe(403);
      expect(await response.text()).not.toContain('Game Audio');
    },true);
  });
  it('rejects malformed source or unverified host routing data',async()=>{
    await withRouting(async h=>{
      expect((await h.call('')).status).toBe(400);
      expect((await h.call('x'.repeat(201))).status).toBe(400);
      expect(h.read).not.toHaveBeenCalled();
    });
  });
});
