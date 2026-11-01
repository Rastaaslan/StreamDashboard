import { createServer } from 'node:http';
import express, {type Request} from 'express';
import { describe, expect, it, vi } from 'vitest';
import { RemoteAuth } from '../apps/server/src/remote-auth.js';
import { ObsMixerObservation } from '../apps/server/src/streamcockpit-mixer-observation.js';
import { createMixerRouter, mixerHostEligible } from '../apps/server/src/streamcockpit-mixer-router.js';
import { isRemoteApiAllowed, requiredDevicePermissions } from '../apps/server/src/remote-api-policy.js';

describe('F05 paired-client mixer route', () => {
  it('requires observe, rejects writes and stale data, with real loopback when available', async context => {
    let now=10000;
    const cache=new ObsMixerObservation(()=>now);
    const auth=new RemoteAuth();
    const p=auth.createPairing(undefined,false,['observe']);
    const paired=auth.pair(p.id,p.code,'remote-test');
    const read=vi.fn(()=>cache.read(now));
    const route=createMixerRouter({
      canRead(req:Request) {
        const token=req.headers.authorization?.match(/^Device (\S+)$/)?.[1];
        const device=token?auth.authenticate(token):null;
        return Boolean(device && auth.permits(device,['observe']));
      },readSnapshot:read,now:()=>now,
    });
    const app=express();app.use('/api/v1/streamcockpit-mixer',route);
    const server=createServer(app);
    try {
      try { await new Promise<void>((ok,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',ok);}); }
      catch(error) {
        if((error as NodeJS.ErrnoException).code==='EPERM'){context.skip('Loopback denied in sandbox');return;}
        throw error;
      }
      const address=server.address();
      if(!address || typeof address==='string')throw Error('not listening');
      const url=`http://127.0.0.1:${address.port}/api/v1/streamcockpit-mixer`;
      const fetchMixer=(method='GET',token=paired.credential)=>fetch(url,{method,headers:{authorization:`Device ${token}`}});
      expect(isRemoteApiAllowed('GET','/v1/streamcockpit-mixer')).toBe(true);
      expect(isRemoteApiAllowed('HEAD','/v1/streamcockpit-mixer')).toBe(true);
      expect(isRemoteApiAllowed('POST','/v1/streamcockpit-mixer')).toBe(false);
      expect(requiredDevicePermissions('GET','/v1/streamcockpit-mixer',null)).toEqual(['observe']);
      expect((await fetchMixer('GET','invalid')).status).toBe(403);
      expect(read).not.toHaveBeenCalled();
      for(const method of ['POST','PUT','DELETE']) {
        const result=await fetchMixer(method);expect(result.status).toBe(405);
      }
      expect((await fetchMixer()).status).toBe(503);
      cache.observe({connected:true,connectionStatus:'connected',inputs:{Mic:{muted:false,volume:0.5}},error:null},4);
      const response=await fetchMixer();
      expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store');
      const text=await response.text();
      expect(text).not.toContain(paired.credential);
      const body=JSON.parse(text);
      expect(body).toMatchObject({owner:'FIXE',readOnly:true,revision:'obs:4:1'});
      expect(body.sources[0]).toMatchObject({gain:{state:'known',value:0.5},vod:{state:'unknown'}});
      const head=await fetchMixer('HEAD');expect(head.status).toBe(200);expect(await head.text()).toBe('');
      now+=6001;
      const stale=await (await fetchMixer()).json();
      expect(stale.sources[0].gain.state).toBe('unknown');
      auth.setPermissions(paired.deviceId,['chat']);
      expect((await fetchMixer()).status).toBe(403);
      auth.revoke(paired.deviceId);
      expect((await fetchMixer()).status).toBe(403);
    } finally {
      if(server.listening){server.closeAllConnections();await new Promise<void>(ok=>server.close(()=>ok()));}
    }
  });
});

it('fences a pairing revoked while the asynchronous host snapshot is pending', async context => {
  let now=12_000;
  const cache=new ObsMixerObservation(()=>now);
  cache.observe({connected:true,connectionStatus:'connected',inputs:{PrivateMic:{muted:false,volume:0.8}},error:null},4);
  const auth=new RemoteAuth();
  const code=auth.createPairing(undefined,false,['observe']);
  const paired=auth.pair(code.id,code.code,'paired');
  let release!: (value:ReturnType<ObsMixerObservation['read']>)=>void;
  let started!: ()=>void;
  const readStarted=new Promise<void>(resolve=>{started=resolve;});
  const router=createMixerRouter({
    canRead:req=>{
      const credential=req.headers.authorization?.match(/^Device (\S+)$/)?.[1];
      const id=credential?auth.authenticate(credential):null;
      return Boolean(id&&auth.permits(id,['observe']));
    },
    readSnapshot:()=>new Promise(resolve=>{release=resolve;started();}),
    now:()=>now,
  });
  const app=express();app.use('/api/v1/streamcockpit-mixer',router);
  const server=createServer(app);
  try {
    try {await new Promise<void>((ok,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',ok);});}
    catch(error) {if((error as NodeJS.ErrnoException).code==='EPERM'){context.skip('loopback unavailable');return;}throw error;}
    const addr=server.address();if(!addr||typeof addr==='string')throw Error('no address');
    const request=fetch(`http://127.0.0.1:${addr.port}/api/v1/streamcockpit-mixer`,{
      headers:{authorization:`Device ${paired.credential}`},
    });
    await readStarted;
    auth.revoke(paired.deviceId);
    release(cache.read(now));
    const result=await request;
    expect(result.status).toBe(403);
    const body=await result.text();
    expect(body).not.toContain('PrivateMic');
    expect(body).not.toContain(paired.credential);
  } finally {
    if(server.listening){server.closeAllConnections();await new Promise<void>(ok=>server.close(()=>ok()));}
  }
});

it('does not infer the FIXE audio authority from a controller, Android or unidentified process',()=>{
  expect(mixerHostEligible(undefined)).toBe(false);
  expect(mixerHostEligible({platform:'windows',enabled:true,roles:['controller']})).toBe(false);
  expect(mixerHostEligible({platform:'android',enabled:true,roles:['obs-executor']})).toBe(false);
  expect(mixerHostEligible({platform:'windows',enabled:false,roles:['obs-executor']})).toBe(false);
  expect(mixerHostEligible({platform:'windows',enabled:true,roles:['obs-executor']})).toBe(true);
});
