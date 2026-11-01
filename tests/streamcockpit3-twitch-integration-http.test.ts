import { expect, it, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AdvancedTwitch } from '../integrations/twitch/src/streamcockpit-advanced.js';
import { StreamcockpitTwitchService } from '../apps/server/src/streamcockpit-twitch-service.js';
import { createTwitchCapabilitiesRouter, twitchReadActor } from '../apps/server/src/streamcockpit-twitch-router.js';
import { RemoteAuth } from '../apps/server/src/remote-auth.js';
import { isRemoteApiAllowed, requiredDevicePermissions } from '../apps/server/src/remote-api-policy.js';

const path = '/v1/twitch/advanced/capabilities';
async function fixture(run: (f: { url: string; auth: RemoteAuth; credential: string; id: string; transport: ReturnType<typeof vi.fn>; setMode(value: string): void }) => Promise<void>) {
  const auth = new RemoteAuth();
  const pairing = auth.createPairing(undefined, false, ['chat']);
  const paired = auth.pair(pairing.id, pairing.code, 'fixture');
  let mode = 'ok';
  const transport = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    expect(init?.method).toBe('GET');
    if (mode === 'offline') throw Error('PRIVATE');
    if (mode === 'revoke') auth.revoke(paired.deviceId);
    if (mode === 'disconnect') credentials.accessToken = '';
    if (mode === '401') return Response.json({ message: 'PRIVATE' }, { status: 401 });
    if (String(input).includes('/validate')) return Response.json({client_id:'client',user_id:'42',scopes: mode === 'missing' ? [] : ['moderator:read:shield_mode','moderator:read:automod_settings'],expires_in:3600});
    if (mode === '403' || mode === '429' || mode === '503') return Response.json({message:'PRIVATE'},{status:Number(mode)});
    if (mode === 'malformed') return Response.json({data:[{}]});
    return Response.json({ data: [String(input).includes('shield_mode') ? { is_active: true } : { broadcaster_id: '42', moderator_id: '42', overall_level: 1 }] });
  });
  const credentials = { clientId: 'client', accessToken: 'PRIVATE', broadcasterId: '42' };
  const service = new StreamcockpitTwitchService(new AdvancedTwitch(() => credentials, transport as typeof fetch));
  const app = express(); app.use(express.json());
  app.use('/api'+path, createTwitchCapabilitiesRouter({service, actor: req => twitchReadActor(req, auth, false, true)}));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  try { await run({url:`http://127.0.0.1:${(server.address() as AddressInfo).port}/api${path}`,auth,credential:paired.credential,id:paired.deviceId,transport,setMode:value=>{mode=value;}}); }
  finally { server.closeAllConnections(); await new Promise<void>(resolve=>server.close(()=>resolve())); }
}

it('HTTP requires paired chat identity; JSON cannot grant rights; refuses every mutation', async () => fixture(async f => {
  expect((await fetch(f.url)).status).toBe(401);
  for (const method of ['POST','PUT','PATCH','DELETE']) {
    expect(isRemoteApiAllowed(method,path)).toBe(false);
    expect((await fetch(f.url,{method,headers:{'content-type':'application/json'},body:JSON.stringify({id:'host',canRead:true,canInteract:true})})).status).toBe(405);
  }
  expect(f.transport).not.toHaveBeenCalled();
  f.auth.setPermissions(f.id,['observe','cloud']);
  expect((await fetch(f.url,{headers:{authorization:`Device ${f.credential}`}})).status).toBe(403);
  expect(f.transport).not.toHaveBeenCalled();
}));

it('HTTP exposes verified read capabilities only, no cache, secrets, or public-live assertion', async () => fixture(async f => {
  for (const method of ['GET','HEAD']) {
    expect(isRemoteApiAllowed(method,path)).toBe(true);
    expect(requiredDevicePermissions(method,path,{canRead:true})).toEqual(['chat']);
    const response = await fetch(f.url,{method,headers:{authorization:`Device ${f.credential}`}});
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.text(); expect(body).not.toContain('PRIVATE'); expect(body).not.toContain('isLive');
    if (method === 'GET') { const data=JSON.parse(body); expect(data.shield.status).toBe('verified'); expect(data.automod.status).toBe('verified'); expect(data.shield.mutationAvailable).toBe(false); }
    else expect(body).toBe('');
  }
  expect(f.transport).toHaveBeenCalledTimes(6);
}));

it.each(['offline','401','revoke','disconnect','403','429','503','malformed','missing'])('HTTP invalidates evidence on %s without retry', async mode => fixture(async f => {
  f.setMode(mode);
  const response=await fetch(f.url,{headers:{authorization:`Device ${f.credential}`}});
  const body=await response.text(); expect(body).not.toContain('PRIVATE');
  const data=JSON.parse(body);
  if (['offline','401','revoke','disconnect'].includes(mode)) { expect(response.status).toBeGreaterThanOrEqual(400); expect(data.status).toBe('unknown'); }
  else { expect(response.status).toBe(200); expect(data.shield.status).toBe({'403':'forbidden','429':'rate-limited','503':'unavailable',malformed:'unavailable',missing:'missing-scope'}[mode]); }
  expect(f.transport.mock.calls.length).toBeLessThanOrEqual(3);
  if (['offline','401','missing'].includes(mode)) expect(f.transport).toHaveBeenCalledTimes(1);
}));

it('poll preview/confirm are not remote-allowlisted in any method',()=>{
  for(const suffix of ['poll/preview','poll/confirm']) for(const method of ['GET','HEAD','POST']) expect(isRemoteApiAllowed(method,'/v1/twitch/advanced/'+suffix)).toBe(false);
});

it('real server mounts read route behind origin guard and leaves poll mutations absent',async()=>{
  const {startDashboardServer}=await import('../apps/server/src/index.js');
  const {mkdtemp,rm}=await import('node:fs/promises');
  const dir=await mkdtemp(join(tmpdir(),'lot-j-server-'));
  let server:Awaited<ReturnType<typeof startDashboardServer>>|undefined;
  try {
    server=await startDashboardServer({port:0,dataDir:dir,remoteEnabled:false,obsEnabled:false,timerAuthority:false,logger:{info(){},warn(){},error(){}}});
    const response=await fetch(server.url+'/api'+path);
    expect(response.status).toBe(401); expect(await response.json()).toMatchObject({status:'unknown',error:{code:'unauthorized'}});
    expect((await fetch(server.url+'/api'+path,{headers:{origin:'https://untrusted.invalid'}})).status).toBe(403);
    expect((await fetch(server.url+'/api'+path,{method:'POST'})).status).toBe(405);
    for(const action of ['preview','confirm']) expect((await fetch(server.url+'/api/v1/twitch/advanced/poll/'+action,{method:'POST'})).status).toBe(404);
  } finally { await server?.stop(); await rm(dir,{recursive:true,force:true}); }
},30000);
