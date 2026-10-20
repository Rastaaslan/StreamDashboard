import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { registerControlRoutes } from '../apps/server/src/control-routes.js';
import type { ObsClient } from '../integrations/obs/src/client.js';

type RouteOptions = Parameters<typeof registerControlRoutes>[0];

async function requestReplay(replayStatus:ObsClient['replayStatus']) {
  const app=express();
  const obs={replayStatus:vi.fn(replayStatus),setReplayBuffer:vi.fn(),saveReplay:vi.fn()};
  const unused:express.RequestHandler=(_req,res)=>{res.status(501).end();};
  registerControlRoutes({
    app,
    obs:obs as unknown as ObsClient,
    control:{} as RouteOptions['control'],
    youtube:{} as RouteOptions['youtube'],
    wizebotCommands:{} as RouteOptions['wizebotCommands'],
    timerSource:()=>'',state:()=>({}),observe:async()=>{},isLocal:()=>true,port:()=>0,
    settings:unused,planningCreate:unused,planningUpdate:unused,planningDelete:unused,recurrence:unused,
  });
  const server=await new Promise<Server>(resolve=>{
    const listener=app.listen(0,'127.0.0.1',()=>resolve(listener));
  });
  try{
    const response=await fetch('http://127.0.0.1:'+(server.address() as AddressInfo).port+'/api/v2/replay');
    const body=await response.json();
    expect(obs.replayStatus).toHaveBeenCalledTimes(1);
    expect(obs.setReplayBuffer).not.toHaveBeenCalled();
    expect(obs.saveReplay).not.toHaveBeenCalled();
    return {status:response.status,body};
  }finally{
    server.closeAllConnections();
    await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  }
}

describe('Replay status HTTP route',()=>{
  it('preserves a returned OBS 604 diagnostic and all known profile settings',async()=>{
    const diagnostic={
      active:false,enabled:true,available:false,mode:'Advanced' as const,seconds:90,directory:'C:\\QA\\Clips',
      error:'OBS 604 : tampon activé dans le profil mais indisponible. Appliquez les réglages lorsque les sorties sont arrêtées.',
    };
    const response=await requestReplay(async()=>diagnostic);
    expect(response.status).toBe(200);
    expect(response.body).toEqual(diagnostic);
  });

  it('keeps a stopped but available buffer distinct from an unavailable buffer',async()=>{
    const available={
      active:false,enabled:true,available:true,mode:'Simple' as const,seconds:45,directory:'D:\\QA\\Replays',error:'',
    };
    const response=await requestReplay(async()=>available);
    expect(response.status).toBe(200);
    expect(response.body).toEqual(available);
  });

  it('reports a failed network observation as unknown and retains its message',async()=>{
    const response=await requestReplay(async()=>{throw new Error('Connexion OBS perdue pendant la lecture du tampon.');});
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      active:null,enabled:null,available:null,mode:null,seconds:null,directory:'',
      error:'Connexion OBS perdue pendant la lecture du tampon.',
    });
  });
});
