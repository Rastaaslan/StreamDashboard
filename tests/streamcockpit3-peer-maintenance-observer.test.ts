import {afterEach,expect,it,vi} from 'vitest';
import {createServer,type Server} from 'node:https';
import {readFile} from 'node:fs/promises';
import {X509Certificate} from 'node:crypto';
import {createPeerMaintenanceObserver,validatePeerMaintenanceObserver} from '../apps/desktop/src/streamcockpit-peer-maintenance-observer.js';
import {createIndependentMaintenanceObserver} from '../apps/desktop/src/streamcockpit-maintenance-observer.js';
import {controllerMaintenanceObservation} from '../apps/desktop/src/streamcockpit-controller-maintenance.js';
const servers:Server[]=[],observers:ReturnType<typeof createPeerMaintenanceObserver>[]=[];
afterEach(async()=>{for(const o of observers.splice(0))await o.close();for(const s of servers.splice(0))await new Promise<void>(r=>{s.closeAllConnections();s.close(()=>r())})});
async function fixture(response:any={authority:'fixe',safe:true,observedAt:Date.now()},status=200){
 const [key,cert]=await Promise.all([readFile('tests/fixtures/tls/agent.key'),readFile('tests/fixtures/tls/agent.pem')]);
 const received:Array<{method?:string;path?:string;authorization?:string}>=[];
 const server=createServer({key,cert},(req,res)=>{received.push({method:req.method,path:req.url,authorization:req.headers.authorization});
  res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(typeof response==='function'?response():response));
 });servers.push(server);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const address=server.address() as {port:number};
 const config={peer:{origin:'https://127.0.0.1:'+address.port,fingerprint:new X509Certificate(cert).fingerprint256.replaceAll(':','').toLowerCase(),credential:'TEST_ONLY_DEVICE_CREDENTIAL_000000'}};
 return {config,received,observer:(value=config)=>{const o=createPeerMaintenanceObserver(value);observers.push(o);return o}};
}
it('actual TLS observer pins FIXE before sending its device credential and makes only one fixed read-only GET',async()=>{
 const f=await fixture(()=>({authority:'fixe',safe:true,observedAt:Date.now()})),o=f.observer();
 expect(await o.observe()).toMatchObject({authority:'fixe-independent',obs:'idle',twitch:'offline'});
 expect(f.received).toEqual([{method:'GET',path:'/api/v1/maintenance/safety',authorization:'Device TEST_ONLY_DEVICE_CREDENTIAL_000000'}]);
 await o.close();expect(await o.observe()).toBeUndefined();expect(f.received).toHaveLength(1);
});
it('actual mismatched TLS pin sends no credential or HTTP request and cannot authorize an update',async()=>{
 const f=await fixture(),o=f.observer({peer:{...f.config.peer,fingerprint:'0'.repeat(64)}});
 expect(await o.observe()).toBeUndefined();expect(f.received).toEqual([]);
});
it.each([
 {authority:'control',safe:true,observedAt:Date.now()},
 {authority:'fixe',safe:false,observedAt:Date.now()},
 {authority:'fixe',safe:true,observedAt:0},
 {authority:'fixe',safe:true,observedAt:Date.now()+60000},
 {authority:'fixe',safe:true},
])('refuses unknown, active, control or stale native observations %j',async value=>{
 const f=await fixture(value);expect(await f.observer().observe()).toBeUndefined();expect(f.received).toHaveLength(1);
});
it('does not follow an update-safety redirect or retry an unavailable authority',async()=>{
 const f=await fixture({},302);expect(await f.observer().observe()).toBeUndefined();expect(f.received).toHaveLength(1);
});
it('reuses the controller pairing and independent pin without reading FIXE provider accounts',async()=>{
 const store={getControllerBindings:vi.fn(async()=>({server:'https://fixe.test:19443',credential:'TEST_ONLY_OLD_BINDING',actions:[]})),
  getControllerDevice:vi.fn(async()=> 'TEST_ONLY_DEVICE_CREDENTIAL')};
 const peers={fingerprint:vi.fn(async()=> 'a'.repeat(64))};
 expect(await controllerMaintenanceObservation(store as any,peers as any)).toEqual({peer:{
  origin:'https://fixe.test:19443',credential:'TEST_ONLY_DEVICE_CREDENTIAL',fingerprint:'a'.repeat(64)}});
 expect(store.getControllerDevice).toHaveBeenCalledExactlyOnceWith('https://fixe.test:19443');
 expect(peers.fingerprint).toHaveBeenCalledExactlyOnceWith('https://fixe.test:19443');
});
it.each(['http://fixe.test','https://fixe.test/path','https://user:pass@fixe.test'])('refuses unbound origin %s',origin=>{
 expect(()=>validatePeerMaintenanceObserver({peer:{origin,fingerprint:'a'.repeat(64),credential:'TEST_ONLY_DEVICE_CREDENTIAL'}})).toThrow();
});

it('the existing external-maintenance observer dispatches the paired configuration to a real pinned TLS reader',async()=>{
 const f=await fixture(()=>({authority:'fixe',safe:true,observedAt:Date.now()}));
 const o=await createIndependentMaintenanceObserver(f.config);observers.push(o);
 expect(await o.observe()).toMatchObject({authority:'fixe-independent',obs:'idle',twitch:'offline'});
 expect(f.received).toHaveLength(1);
});
