import {describe,it,expect,vi} from 'vitest';
import {PairingRequests,registerPairingRequests} from '../apps/server/src/pairing-requests.js';
import {RemoteAuth} from '../apps/server/src/remote-auth.js';

describe('CB-199 PC consent and reconnect',()=>{
 it('requires consent, matching code and private poll secret; issues once and reconnects after restart',async()=>{
  const queue=new PairingRequests(),auth=new RemoteAuth(),pending=queue.create('Android');
  const issue=vi.fn(async(name:string)=>{const c=auth.createPairing();return auth.pair(c.id,c.code,name);});
  expect(await queue.poll(pending.id,pending.secret,issue)).toEqual({state:'pending'});expect(issue).not.toHaveBeenCalled();
  await expect(queue.poll(pending.id,'attacker',issue)).rejects.toThrow();expect(()=>queue.decide(pending.id,'wrong',true)).toThrow();
  queue.decide(pending.id,pending.code,true);
  const [one,two]=await Promise.all([queue.poll(pending.id,pending.secret,issue),queue.poll(pending.id,pending.secret,issue)]);expect(one).toEqual(two);expect(issue).toHaveBeenCalledTimes(1);
  const paired=one.paired as {credential:string;deviceId:string};expect(new RemoteAuth(Date.now,auth.serialize()).authenticate(paired.credential)).toBe(paired.deviceId);
 });
 it('denial, expiry and restart never grant credentials',async()=>{
  let now=0;const queue=new PairingRequests(()=>now),issue=vi.fn(async()=>({credential:'never'}));
  const denied=queue.create('Android');queue.decide(denied.id,denied.code,false);expect(await queue.poll(denied.id,denied.secret,issue)).toEqual({state:'denied'});
  const expired=queue.create('Android');now=300001;await expect(queue.poll(expired.id,expired.secret,issue)).rejects.toThrow();
  await expect(new PairingRequests().poll(denied.id,denied.secret,issue)).rejects.toThrow();expect(issue).not.toHaveBeenCalled();
 });
 it('bounds unsolicited requests and never exposes poll secrets to the PC list',()=>{const queue=new PairingRequests();const pending=queue.create('Android');expect(JSON.stringify(queue.list())).not.toContain(pending.secret);for(let i=1;i<32;i++)queue.create('Android');expect(()=>queue.create('overflow')).toThrow();});
});

it('HTTP boundary requires TLS and permits consent only on the local PC, never a remote manager',async()=>{
 const routes=new Map<string,Function>(),issue=vi.fn(async()=>({credential:'test-only'}));
 registerPairingRequests({post:(p:string,h:Function)=>routes.set('POST '+p,h),get:(p:string,h:Function)=>routes.set('GET '+p,h)} as any,{enabled:()=>true,fingerprint:()=> 'ab'.repeat(32),isLocal:req=>!(req.socket as any).encrypted,issue});
 async function call(route:string,body={},encrypted=true,id=''){
  let status=200,value:any;const response={status:(s:number)=>{status=s;return response;},sendStatus:(s:number)=>{status=s;},json:(v:any)=>{value=v;},locals:{management:true}};
  await routes.get(route)!({body,socket:{encrypted},params:{id}},response,(e:Error)=>{throw e;});return {status,value};
 }
 const route='POST /api/v1/remote/requests';
 expect((await call(route,{name:'Android',fingerprint:'spoofed'})).status).toBe(403);
 expect((await call(route,{name:'Android',fingerprint:'ab'.repeat(32)},false)).status).toBe(403);
 const {value:p}=await call(route,{name:'Android',fingerprint:'ab'.repeat(32)});
 expect((await call('GET /api/v1/remote/requests')).status).toBe(403);
 expect((await call('POST /api/v1/remote/requests/:id/decision',{code:p.code,approve:true},true,p.id)).status).toBe(403);
 expect(issue).not.toHaveBeenCalled();
 await call('POST /api/v1/remote/requests/:id/decision',{code:p.code,approve:true},false,p.id);
 expect((await call('POST /api/v1/remote/requests/:id/poll',{secret:p.secret},false,p.id)).status).toBe(403);
 expect((await call('POST /api/v1/remote/requests/:id/poll',{secret:p.secret},true,p.id)).value.state).toBe('approved');expect(issue).toHaveBeenCalledTimes(1);
});
