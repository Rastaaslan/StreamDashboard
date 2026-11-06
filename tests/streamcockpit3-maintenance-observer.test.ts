import {afterEach,expect,it,vi} from 'vitest';
import {encode,decode} from '@msgpack/msgpack';
import {WebSocketServer} from 'ws';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createIndependentMaintenanceObserver,inspectWindowsMaintenanceWriters,
 validateMaintenanceObserverConfiguration,type MaintenanceObserverConfiguration} from '../apps/desktop/src/streamcockpit-maintenance-observer.js';
const cleanup:Array<()=>Promise<unknown>>=[];
afterEach(async()=>{vi.restoreAllMocks();for(const work of cleanup.splice(0).reverse())await work()});
async function fixture(){
 const requests:string[]=[],http:string[]=[];
 const values:Record<string,unknown>={GetStreamStatus:{outputActive:false},GetRecordStatus:{outputActive:false},
  GetOutputList:{outputs:[{outputName:'main',outputActive:false,outputFlags:{OBS_OUTPUT_SERVICE:true}}]}};
 const ws=new WebSocketServer({host:'127.0.0.1',port:0});await once(ws,'listening');
 cleanup.push(async()=>{for(const socket of ws.clients)socket.terminate();await new Promise<void>(r=>ws.close(()=>r()))});
 ws.on('connection',socket=>{socket.send(encode({op:0,d:{obsWebSocketVersion:'5.6.0',rpcVersion:1}}));
  socket.on('message',bytes=>{const {op,d}=decode(bytes as Buffer) as any;
   if(op===1){socket.send(encode({op:2,d:{negotiatedRpcVersion:1}}));return}
   if(op!==6)return;requests.push(d.requestType);
   const response=d.requestType==='CallVendorRequest'?{responseData:{success:true,
    ...(d.requestData.requestType==='version'?{version:'1.2.4'}:{outputs:[{name:'second',type:'stream',active:false}]})}}:values[d.requestType];
   socket.send(encode({op:7,d:{requestId:d.requestId,requestType:d.requestType,requestStatus:{result:true,code:100},responseData:response}}));
  });
 });
 const address=ws.address();if(!address||typeof address==='string')throw Error('FIXTURE_PORT');
 const config:MaintenanceObserverConfiguration={obs:{url:'ws://127.0.0.1:'+address.port,password:'TEST_ONLY'},outputs:{twitch:{kind:'main',name:''}},
  twitch:{clientId:'TEST_CLIENT',accessToken:'TEST_TOKEN',broadcasterId:'42'}};
 const provider={claim:{client_id:'TEST_CLIENT',user_id:'42',expires_in:3600} as Record<string,unknown>,streams:{data:[]} as Record<string,unknown>};
 const fetchApi=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(input);http.push(url);expect(init).toMatchObject({method:'GET',redirect:'error',cache:'no-store'});
  return Response.json(url.includes('/validate')?provider.claim:provider.streams);
 });
 const open=async()=>{const observer=await createIndependentMaintenanceObserver(config,{fetchApi:fetchApi as typeof fetch});cleanup.push(()=>observer.close());return observer};
 return {ws,config,values,provider,http,requests,fetchApi,open};
}
it('independently reads OBS and Helix while exposing no command or token-refresh path',async()=>{
 const f=await fixture(),o=await f.open();const sample=await o.observe();
 expect(sample).toMatchObject({authority:'fixe-independent',obs:'idle',twitch:'offline'});
 expect(f.requests.sort()).toEqual(['GetOutputList','GetRecordStatus','GetStreamStatus']);
 expect(f.http).toEqual(['https://id.twitch.tv/oauth2/validate','https://api.twitch.tv/helix/streams?user_id=42&first=1']);
 expect(JSON.stringify(sample)).not.toMatch(/TEST_TOKEN|TEST_ONLY|TEST_CLIENT/);
 await o.close();expect(await o.observe()).toBeUndefined();
});
it.each(['stream','record','stream-unknown','record-unknown','native-active','native-unknown','native-flags'])(
 'refuses %s rather than infer an idle OBS',async kind=>{
 const f=await fixture();
 if(kind.startsWith('stream'))f.values.GetStreamStatus={outputActive:kind==='stream'?true:undefined};
 else if(kind.startsWith('record'))f.values.GetRecordStatus={outputActive:kind==='record'?true:undefined};
 else f.values.GetOutputList={outputs:[{outputName:'other',outputActive:kind==='native-active'?true:kind==='native-unknown'?undefined:false,
  outputFlags:kind==='native-flags'?{}:{OBS_OUTPUT_SERVICE:true}}]};
 expect(await (await f.open()).observe()).toBeUndefined();
});
it('reuses configured Aitum read-only inspection without start/stop hotkeys',async()=>{
 const f=await fixture();f.config.outputs.second={kind:'aitum-suite',name:'second'};
 const o=await f.open();expect(await o.observe()).toMatchObject({obs:'idle'});
 expect(f.requests.filter(x=>x==='CallVendorRequest')).toHaveLength(2);
 expect(f.requests.some(x=>/^Set|^Start|^Stop|Hotkey/.test(x))).toBe(false);
});
it.each(['owner','client','expired','malformed','live','absent-data'])(
 'refuses Twitch %s without posting, refreshing or logging credentials',async variant=>{
 const f=await fixture();
 if(variant==='owner')f.provider.claim.user_id='43';if(variant==='client')f.provider.claim.client_id='other';
 if(variant==='expired')f.provider.claim.expires_in=0;if(variant==='malformed')f.provider.claim.expires_in='3600';
 if(variant==='live')f.provider.streams={data:[{user_id:'42',type:'live'}]};if(variant==='absent-data')f.provider.streams={};
 expect(await (await f.open()).observe()).toBeUndefined();
 expect(f.fetchApi.mock.calls.every(([,init])=>init?.method==='GET')).toBe(true);
});
it('refuses a new OBS stream transition during a provider read, even if it finishes idle',async()=>{
 const f=await fixture(),o=await f.open();let finish!:(r:Response)=>void;
 f.fetchApi.mockImplementation(async url=>String(url).includes('/validate')?Response.json(f.provider.claim):new Promise<Response>(r=>{finish=r}));
 const result=o.observe();await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
 expect(f.fetchApi).toHaveBeenCalledTimes(2);
 for(const socket of f.ws.clients)socket.send(encode({op:5,d:{eventType:'StreamStateChanged',eventIntent:64,eventData:{outputActive:true}}}));
 await new Promise(r=>setTimeout(r,30));finish(Response.json({data:[]}));
 expect(await result).toBeUndefined();
});
it('does not reconnect or report cached idle after independent OBS transport loss',async()=>{
 const f=await fixture(),o=await f.open();expect(await o.observe()).toBeDefined();
 for(const socket of f.ws.clients)socket.terminate();await new Promise(r=>setTimeout(r,40));
 expect(await o.observe()).toBeUndefined();expect(f.requests).toHaveLength(3);
});
it('coalesces concurrent reads and masks provider errors',async()=>{
 const f=await fixture(),o=await f.open();f.fetchApi.mockRejectedValue(Error('Bearer TEST_TOKEN private-data'));
 expect(await Promise.all([o.observe(),o.observe()])).toEqual([undefined,undefined]);
 expect(f.fetchApi).toHaveBeenCalledTimes(1);
});
it.each(['https://example.test','ws://user:password@localhost:4455','ws://localhost:4455/?secret=1'])(
 'rejects unsupported observer endpoint %s before network use',url=>{
 expect(()=>validateMaintenanceObserverConfiguration({obs:{url,password:''},outputs:{},twitch:{clientId:'x',accessToken:'x',broadcasterId:'42'}})).toThrow();
});
(process.platform==='win32'?it:it.skip)('native Windows writer inspection sees a real child referencing ONLY a temporary installation',async()=>{
 const root=await mkdtemp(join(tmpdir(),'sc3-maintenance-observer-'));cleanup.push(()=>rm(root,{recursive:true,force:true}));
 const app=join(root,'application'),profile=join(root,'profile');
 const child=spawn(process.execPath,['-e',"process.stdout.write('ready');setInterval(()=>{},1000)",app],{stdio:['ignore','pipe','ignore'],windowsHide:true});
 cleanup.push(async()=>{if(child.exitCode===null&&child.signalCode===null){const exit=once(child,'exit');child.kill();await exit}});
 await once(child.stdout!,'data');expect(await inspectWindowsMaintenanceWriters(app,profile)).toBe(false);
 const exit=once(child,'exit');child.kill();await exit;
 expect(await inspectWindowsMaintenanceWriters(app,profile)).toBe(true);
},15000);
