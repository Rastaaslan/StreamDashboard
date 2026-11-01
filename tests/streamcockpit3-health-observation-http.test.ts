import express, {type Request,type Response as ExpressResponse} from 'express';
import {createServer} from 'node:http';
import {expect,it,vi} from 'vitest';
import {createHealthRouter} from '../apps/server/src/streamcockpit-health/index.js';
import {ObsHealthObservation} from '../apps/server/src/streamcockpit-health/obs-observation.js';
import {mapHostHealth} from '../apps/server/src/streamcockpit-health/host-adapter.js';
import {RemoteAuth} from '../apps/server/src/remote-auth.js';
import {isRemoteApiAllowed,requiredDevicePermissions} from '../apps/server/src/remote-api-policy.js';

for(const mode of ['memory','http'] as const)it(`observed health ${mode}: auth/revocation, expiry, HEAD and zero external effects`,async context=>{
  let now=1700000000000;const obs=new ObsHealthObservation(()=>now,()=>now-1700000000000);
  const auth=new RemoteAuth();const pairing=auth.createPairing(undefined,false,['observe']);
  const paired=auth.pair(pairing.id,pairing.code,'fixture');
  const device={id:'fixe',platform:'windows',enabled:true,roles:['obs-executor']};
  const readSnapshot=vi.fn(()=>mapHostHealth({device,obs},now));
  const router=createHealthRouter({canRead:req=>{
    const credential=req.headers.authorization?.match(/^Device (\S+)$/)?.[1];
    const id=credential?auth.authenticate(credential):null;return Boolean(id&&auth.permits(id,['observe']));
  },readSnapshot,now:()=>now});
  const app=express();app.use('/api/v1/streamcockpit-health',router);
  const server=createServer(app);let base='http://fixture.invalid';
  let request:(method?:string,credential?:string)=>Promise<Response>;
  if(mode==='http') {
    try {
      await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    }catch(error){
      if((error as NodeJS.ErrnoException).code==='EPERM'){context.skip('Loopback interdit par le sandbox (EPERM)');return;}
      throw error;
    }
    const address=server.address();if(!address||typeof address==='string')throw Error('No address');
    base=`http://127.0.0.1:${address.port}/api/v1/streamcockpit-health`;
    request=(method='GET',credential=paired.credential)=>fetch(base,{method,headers:{authorization:`Device ${credential}`}});
  }else {
    request=(method='GET',credential=paired.credential)=>new Promise((resolve,reject)=>{
      let status=200;const headers=new Headers();
      const response={setHeader(key:string,value:string){headers.set(key,value);},status(code:number){status=code;return response;},
        json(body:unknown){resolve(new Response(method==='HEAD'?null:JSON.stringify(body),{status,headers}));}};
      router({url:'/',method,headers:{authorization:`Device ${credential}`},body:{obs:{connected:true},permissions:['observe']}} as Request,
        response as unknown as ExpressResponse,error=>reject(error??Error('fallthrough')));
    });
  }
  const external=vi.spyOn(globalThis,'fetch');
  try {
    expect((await request('GET','invalid')).status).toBe(403);expect(readSnapshot).not.toHaveBeenCalled();
    auth.setPermissions(paired.deviceId,['chat']);expect((await request()).status).toBe(403);expect(readSnapshot).not.toHaveBeenCalled();
    auth.setPermissions(paired.deviceId,['observe']);
    for(const method of ['POST','PUT','PATCH','DELETE']){
      expect(isRemoteApiAllowed(method,'/v1/streamcockpit-health')).toBe(false);
      expect((await request(method)).status).toBe(405);
    }
    expect(readSnapshot).not.toHaveBeenCalled();
    expect((await (await request()).json()).diagnostics[1].status).toBe('unknown');
    obs.observe({connected:true,connectionStatus:'connected'});
    const response=await request();expect(response.headers.get('cache-control')).toBe('no-store');
    const body=await response.text();expect(body).not.toContain(paired.credential);expect(body).not.toMatch(/streaming|token|password/);
    expect(JSON.parse(body).diagnostics[1]).toMatchObject({code:'connected',observedAt:now});
    expect(JSON.parse(body).diagnostics[2].status).toBe('unknown');
    const head=await request('HEAD');expect(head.status).toBe(200);expect(await head.text()).toBe('');
    expect(requiredDevicePermissions('GET','/v1/streamcockpit-health',null)).toEqual(['observe']);
    now+=15001;expect((await (await request()).json()).diagnostics[1]).toMatchObject({status:'unknown',freshness:'stale'});
    obs.observe({connected:false,connectionStatus:'error'});
    expect((await (await request()).json()).diagnostics[1]).toMatchObject({status:'critical',code:'disconnected'});
    auth.revoke(paired.deviceId);const reads=readSnapshot.mock.calls.length;
    expect((await request()).status).toBe(403);expect(readSnapshot).toHaveBeenCalledTimes(reads);
    if(mode==='memory')expect(external).not.toHaveBeenCalled();
    else for(const [url] of external.mock.calls)expect(url).toBe(base);
  }finally{
    external.mockRestore();
    if(server.listening){server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
  }
});
