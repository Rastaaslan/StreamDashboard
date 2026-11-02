import { expect, it, vi } from 'vitest';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { AdvancedTwitch } from '../integrations/twitch/src/streamcockpit-advanced.js';
import { StreamcockpitTwitchService } from '../apps/server/src/streamcockpit-twitch-service.js';
import { createTwitchCapabilitiesRouter, twitchReadActor } from '../apps/server/src/streamcockpit-twitch-router.js';
import { RemoteAuth } from '../apps/server/src/remote-auth.js';
import { isRemoteApiAllowed, requiredDevicePermissions } from '../apps/server/src/remote-api-policy.js';

const path = '/v1/twitch/advanced/capabilities';
async function fixture(run: (f: { url: string; request: typeof fetch; auth: RemoteAuth; credential: string; id: string; transport: ReturnType<typeof vi.fn>; setMode(value: string): void }) => Promise<void>) {
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
  const router = createTwitchCapabilitiesRouter({service, actor: req => twitchReadActor(req, auth, false, true)});
  const request = (async (_url: unknown, init?: RequestInit) => new Promise<Response>((resolve,reject)=>{
    let status=200;
    const headers=new Headers();
    const response={
      set(key:string,value:string){headers.set(key,value);return response;},
      status(value:number){status=value;return response;},
      json(body:unknown){resolve(new Response(init?.method==='HEAD'?null:JSON.stringify(body),{status,headers}));},
    };
    router({method:init?.method||'GET',url:'/',headers:Object.fromEntries(new Headers(init?.headers)),body:init?.body?JSON.parse(String(init.body)):undefined} as ExpressRequest,
      response as unknown as ExpressResponse,error=>reject(error||Error('Unexpected fallthrough')));
  })) as typeof fetch;
  await run({url:'http://fixture.invalid',request,auth,credential:paired.credential,id:paired.deviceId,transport,setMode:value=>{mode=value;}});
}

it('Express in-memory requires paired chat identity; JSON cannot grant rights; refuses every mutation', async () => fixture(async f => {
  expect((await f.request(f.url)).status).toBe(401);
  for (const method of ['POST','PUT','PATCH','DELETE']) {
    expect(isRemoteApiAllowed(method,path)).toBe(false);
    expect((await f.request(f.url,{method,headers:{'content-type':'application/json'},body:JSON.stringify({id:'host',canRead:true,canInteract:true})})).status).toBe(405);
  }
  expect(f.transport).not.toHaveBeenCalled();
  f.auth.setPermissions(f.id,['observe','cloud']);
  expect((await f.request(f.url,{headers:{authorization:`Device ${f.credential}`}})).status).toBe(403);
  expect(f.transport).not.toHaveBeenCalled();
}));

it('Express in-memory exposes verified read capabilities only, no cache, secrets, or public-live assertion', async () => fixture(async f => {
  for (const method of ['GET','HEAD']) {
    expect(isRemoteApiAllowed(method,path)).toBe(true);
    expect(requiredDevicePermissions(method,path,{canRead:true})).toEqual(['chat']);
    const response = await f.request(f.url,{method,headers:{authorization:`Device ${f.credential}`}});
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.text(); expect(body).not.toContain('PRIVATE'); expect(body).not.toContain('isLive');
    if (method === 'GET') { const data=JSON.parse(body); expect(data.shield.status).toBe('verified'); expect(data.automod.status).toBe('verified'); expect(data.shield.mutationAvailable).toBe(false); }
    else expect(body).toBe('');
  }
  expect(f.transport).toHaveBeenCalledTimes(6);
}));

it.each(['offline','401','revoke','disconnect','403','429','503','malformed','missing'])('Express in-memory invalidates evidence on %s without retry', async mode => fixture(async f => {
  f.setMode(mode);
  const response=await f.request(f.url,{headers:{authorization:`Device ${f.credential}`}});
  const body=await response.text(); expect(body).not.toContain('PRIVATE');
  const data=JSON.parse(body);
  if (['offline','401','revoke','disconnect'].includes(mode)) { expect(response.status).toBeGreaterThanOrEqual(400); expect(data.status).toBe('unknown'); }
  else { expect(response.status).toBe(200); expect(data.shield.status).toBe({'403':'forbidden','429':'rate-limited','503':'unavailable',malformed:'unavailable',missing:'missing-scope'}[mode]); }
  expect(f.transport.mock.calls.length).toBeLessThanOrEqual(3);
  if (['offline','401','missing'].includes(mode)) expect(f.transport).toHaveBeenCalledTimes(1);
}));

it('poll preview/confirm allow only paired POST with chat+cloud permissions',()=>{
  for(const suffix of ['poll/preview','poll/confirm']){
    const route='/v1/twitch/advanced/'+suffix;
    expect(isRemoteApiAllowed('POST',route)).toBe(true);
    for(const method of ['GET','HEAD','PUT','DELETE'])expect(isRemoteApiAllowed(method,route)).toBe(false);
  }
});
