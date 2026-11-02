import { expect, it, vi } from 'vitest';
import express, { type Request } from 'express';
import { type AddressInfo } from 'node:net';
import { PredictionTwitch } from '../integrations/twitch/src/streamcockpit-prediction.js';
import { createTwitchPredictionRouter } from '../apps/server/src/streamcockpit-twitch-prediction-router.js';
import { twitchPollActor } from '../apps/server/src/streamcockpit-twitch-poll-router.js';
import { RemoteAuth } from '../apps/server/src/remote-auth.js';
import { isRemoteApiAllowed, requiredDevicePermissions } from '../apps/server/src/remote-api-policy.js';

const active = () => ({ data: [{
  id: 'private-prediction-id', broadcaster_id: '123', status: 'ACTIVE',
  title: 'Quel boss sera vaincu ?', locks_at: '2026-11-02T21:00:00Z',
  outcomes: [{ id: 'private-yes', title: 'Boss A', users: 42 },
    { id: 'private-no', title: 'Boss B', users: 5 }],
}] });
async function fixture(run: (h: {
  call:(token?:string, method?:string)=>Promise<Response>;
  url:string; credential:string; auth:RemoteAuth; reads:ReturnType<typeof vi.fn>;
  setMode:(mode:string)=>void; setEpoch:(epoch:string|undefined)=>void;
  changeOnPredictionRead:()=>void; rotateToken:()=>void;
})=>Promise<void>) {
  const auth = new RemoteAuth(), offer = auth.createPairing(undefined, true);
  const paired = auth.pair(offer.id, offer.code, 'Prediction-test');
  const credentials = { clientId: 'client', accessToken: 'TEST_PRIVATE_TOKEN', broadcasterId: '123' };
  let mode = 'active', epoch:string|undefined = '7:20', replaceEpochOnRead = false;
  const reads = vi.fn();
  const fakeFetch = vi.fn(async (input:string|URL|Request, init?:RequestInit) => {
    const path = String(input);
    reads(path, init?.method);
    if (init?.method !== 'GET') throw new Error('WRITE_FORBIDDEN_TEST');
    if (mode === 'down') return Response.json({ message: 'hidden' }, { status: 503 });
    if (path.endsWith('/validate')) return Response.json({
      client_id: mode === 'wrong-client' ? 'foreign' : 'client',
      user_id: mode === 'wrong-owner' ? '999' : '123',
      scopes: mode === 'scope' ? [] : ['channel:read:predictions'], expires_in: 3600,
    });
    if (path.includes('/helix/predictions')) {
      if (replaceEpochOnRead) epoch = '7:21';
      if (mode === 'rotate-after-read') credentials.accessToken = 'ANOTHER_TOKEN';
      if (mode === 'none') return Response.json({ data: [] });
      if (mode === 'finished') return Response.json({ data: [{ ...active().data[0], status: 'RESOLVED' }] });
      if (mode === 'locked') return Response.json({ data: [{ ...active().data[0], status: 'LOCKED' }] });
      if (mode === 'unknown-status') return Response.json({ data: [{ ...active().data[0], status: 'HACKED' }] });
      if (mode === 'wrong-broadcaster') return Response.json({ data: [{ ...active().data[0], broadcaster_id: '999' }] });
      if (mode === 'invalid') return Response.json({ data: [{ ...active().data[0], outcomes: [{ title: 'Only one' }] }] });
      if (mode === 'empty-receipt') return Response.json({ secret: 'BAD_DATA' });
      return Response.json(active());
    }
    throw new Error('UNEXPECTED_TWITCH_PATH');
  });
  const app = express();
  app.use('/api/v1/twitch/advanced/prediction', createTwitchPredictionRouter({
    api: new PredictionTwitch(() => credentials, fakeFetch as typeof fetch),
    actor: (req:Request) => twitchPollActor(req, auth, false, true), hostLive: () => epoch,
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  try {
    const url = 'http://127.0.0.1:'+(server.address() as AddressInfo).port+
      '/api/v1/twitch/advanced/prediction';
    const call = (token = paired.credential, method = 'GET') => fetch(url, {
      method, headers: { Authorization: 'Device ' + token },
    });
    await run({call,url,credential:paired.credential,auth,reads,
      setMode: value => {mode=value},setEpoch:value=>{epoch=value},
      changeOnPredictionRead:()=>{replaceEpochOnRead=true},
      rotateToken:()=>{credentials.accessToken='ANOTHER_TOKEN'},
    });
  } finally { server.closeAllConnections(); await new Promise<void>(r => server.close(()=>r())); }
}

it('F08 prediction is GET-only with chat+cloud management pairing; never mutates Twitch', () =>
  fixture(async h => {
    const path = '/v1/twitch/advanced/prediction';
    expect(isRemoteApiAllowed('GET',path)).toBe(true);
    expect(requiredDevicePermissions('GET',path,{})).toEqual(['chat','cloud']);
    for (const method of ['POST','PUT','PATCH','DELETE','HEAD']) {
      expect(isRemoteApiAllowed(method,path)).toBe(false);
      expect((await h.call(undefined,method)).status).toBe(405);
    }
    expect((await h.call('invalid')).status).toBe(401);
    const offer = h.auth.createPairing(undefined,false,['chat','cloud']);
    const other = h.auth.pair(offer.id,offer.code,'Not manager');
    expect((await h.call(other.credential)).status).toBe(403);
    expect(h.reads).not.toHaveBeenCalled();
  }));

it('F08 prediction ACTIVE snapshot only returns sanitized, live observed data', () =>
  fixture(async h => {
    const result = await h.call();
    expect(result.status).toBe(200);
    expect(result.headers.get('cache-control')).toContain('no-store');
    expect(await result.json()).toMatchObject({
      schemaVersion:1,kind:'streamcockpit-prediction-snapshot',status:'active',
      title:'Quel boss sera vaincu ?',outcomes:['Boss A','Boss B'],mutationAvailable:false,
    });
    expect(h.reads).toHaveBeenCalledTimes(2);
    expect(h.reads.mock.calls.every(call=>call[1]==='GET')).toBe(true);
    const again=await h.call();
    expect(JSON.stringify(await again.json())).not.toContain('private-prediction-id');
    expect(h.reads).toHaveBeenCalledTimes(4); // Explicit reads are not cached.
  }));

it('F08 prediction empty, resolved and locked states never invent active odds', () =>
  fixture(async h => {
    for (const mode of ['none','finished','locked']) {
      h.setMode(mode);
      const response = await h.call();
      expect(response.status).toBe(200);
      const data=await response.json();
      expect(data.status).toBe(mode==='locked'?'locked':'none');
      if (mode!=='locked')expect(data).not.toHaveProperty('title');
      expect(JSON.stringify(data)).not.toContain('users');
    }
  }));

it('F08 prediction scope, ownership, invalid data and provider outage fail closed', () =>
  fixture(async h => {
    for (const mode of ['scope','wrong-owner','wrong-client','down','wrong-broadcaster','invalid','empty-receipt','unknown-status']) {
      h.setMode(mode);
      const response=await h.call();
      expect(response.status).toBeGreaterThanOrEqual(400);
      const raw=await response.text();
      expect(raw).not.toContain('TEST_PRIVATE_TOKEN');
      expect(raw).not.toContain('private-prediction-id');
    }
  }));

it('F08 prediction OBS offline, stop/start, token rotation and revoked pairing deny stale responses', () =>
  fixture(async h => {
    h.setEpoch(undefined);
    expect((await h.call()).status).toBe(409);
    expect(h.reads).not.toHaveBeenCalled();
    h.setEpoch('7:20');h.changeOnPredictionRead();
    expect((await h.call()).status).toBe(409);
    h.setEpoch('7:20');h.setMode('rotate-after-read');
    expect((await h.call()).status).toBe(401);
    expect(h.reads.mock.calls.every(call=>call[1]==='GET')).toBe(true);
  }));

it('F08 prediction route exists on production server but refuses disabled OBS without Twitch I/O', async () => {
  const { startDashboardServer }=await import('../apps/server/src/index.js');
  const { mkdtemp, rm }=await import('node:fs/promises');
  const { tmpdir }=await import('node:os');
  const { join }=await import('node:path');
  const dir=await mkdtemp(join(tmpdir(),'sc3-prediction-mount-'));
  let server:Awaited<ReturnType<typeof startDashboardServer>>|undefined;
  try {
    for(let attempt=0;attempt<8;attempt++) {
      const candidate=await startDashboardServer({
        port:0,dataDir:dir,remoteEnabled:false,obsEnabled:false,timerAuthority:false,
        logger:{info(){},warn(){},error(){}},
      });
      try { await fetch(candidate.url+'/api/v1/health');server=candidate;break; }
      catch(error) {
        await candidate.stop();
        if ((error as {cause?:{message?:string}})?.cause?.message!=='bad port') throw error;
      }
    }
    if(!server)throw Error('TEST_PORT_UNAVAILABLE');
    const target=server.url+'/api/v1/twitch/advanced/prediction';
    const result=await fetch(target);
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.status).not.toBe(404);
    expect((await result.text()).toLowerCase()).not.toContain('access_token');
  } finally { await server?.stop(); await rm(dir,{recursive:true,force:true}); }
},30000);
