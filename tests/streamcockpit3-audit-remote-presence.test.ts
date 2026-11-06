import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {networkInterfaces} from 'node:os';
import path from 'node:path';
import {WebSocket} from 'ws';
import {startDashboardServer,type DashboardServerHandle} from '../apps/server/src/index.js';

const logger={info(){},warn(){},error(){}};
const LAN=Object.values(networkInterfaces()).flat().find(item=>item?.family==='IPv4'&&!item.internal)?.address;
let handle:DashboardServerHandle|undefined;
let temporary='';
afterEach(async()=>{
 await handle?.stop();handle=undefined;
 if(temporary)await rm(temporary,{recursive:true,force:true});
 temporary='';
});
it('FIXE only: observed authenticated WS socket is distinct from stored pairing and stale last contact',async()=>{
 if(!LAN)throw new Error('Adresse LAN IPv4 requise pour exercer la protection remote');
 temporary=await mkdtemp(path.resolve('.remote-presence-audit-'));
 handle=await startDashboardServer({port:0,host:'0.0.0.0',remoteEnabled:true,obsEnabled:false,timerAuthority:false,dataDir:temporary,logger});
 const local=`http://127.0.0.1:${handle.port}`;
 const lan=`http://${LAN}:${handle.port}`;
 const endpoint=`${local}/api/v1/remote/devices/presence`;
 const pair=async(name:string)=>{
  const invite=await fetch(`${local}/api/v1/remote/pairing`,{method:'POST'}).then(r=>r.json());
  const response=await fetch(`${lan}/api/v1/remote/pair`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...invite,name})});
  expect(response.status).toBe(201);
  return response.json();
 };
 const active=await pair('Téléphone test');
 const idle=await pair('Client non connecté');
 const list=async()=>fetch(endpoint).then(r=>r.json());
 const initial=await list();
 expect(initial).toMatchObject({devices:expect.any(Array),observedAt:expect.any(String)});
 expect(initial.devices).toEqual(expect.arrayContaining([expect.objectContaining({id:active.deviceId,webSocketOpen:false}),expect.objectContaining({id:idle.deviceId,webSocketOpen:false})]));
 expect(JSON.stringify(initial)).not.toContain(active.credential);
 const remoteForbidden=await fetch(`${lan}/api/v1/remote/devices/presence`,{headers:{authorization:`Device ${active.credential}`}});
 expect(remoteForbidden.status).toBe(403);
 const ticketResponse=await fetch(`${lan}/api/v1/remote/ws-ticket`,{method:'POST',headers:{authorization:`Device ${active.credential}`}});
 expect(ticketResponse.status).toBe(201);
 const ticket=await ticketResponse.json();
 const ws=new WebSocket(`${lan.replace('http:','ws:')}/ws/v1?ticket=${encodeURIComponent(ticket.ticket)}`);
 try {
  await new Promise<void>((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject)});
  await vi.waitFor(async()=>{const rows=(await list()).devices;expect(rows.find((d:any)=>d.id===active.deviceId)?.webSocketOpen).toBe(true);expect(rows.find((d:any)=>d.id===idle.deviceId)?.webSocketOpen).toBe(false)}, {timeout:2500,interval:40});
  expect(JSON.stringify(await list())).not.toContain(ticket.ticket);
 } finally {ws.close();}
 await vi.waitFor(async()=>expect((await list()).devices.find((d:any)=>d.id===active.deviceId)?.webSocketOpen).toBe(false),{timeout:2500,interval:40});
},20000);
