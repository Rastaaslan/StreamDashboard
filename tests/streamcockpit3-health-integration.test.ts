import {expect, it, vi} from 'vitest';
import express from 'express';
import type {AddressInfo} from 'node:net';
import {readFileSync} from 'node:fs';
import {createHealthRouter} from '../apps/server/src/streamcockpit-health/index.js';
import {mapHostHealth} from '../apps/server/src/streamcockpit-health/host-adapter.js';
import {diagnoseHealth} from '../packages/core/src/streamcockpit-health/index.js';
import {isRemoteApiAllowed, requiredDevicePermissions} from '../apps/server/src/remote-api-policy.js';

const now=1700000000000;
const device={id:'fixe',platform:'windows',enabled:true,roles:['obs-executor','services']};
const twitch={live:false,observedAt:new Date(now).toISOString()};
it('maps only timestamped evidence from the OBS host; stale/error/untimed/controller data stay UNKNOWN',()=>{
  const report=(input:Parameters<typeof mapHostHealth>[0],time=now)=>diagnoseHealth(mapHostHealth(input,time),time);
  const good=report({device,twitch});
  expect(good.status).toBe('unknown');
  expect(good.diagnostics.find(d=>d.source==='twitch')?.status).toBe('healthy');
  for(const source of ['obs','micro','dji','sync'])expect(good.diagnostics.find(d=>d.source===source)?.status).toBe('unknown');
  for(const value of [{...twitch,observedAt:''},{...twitch,error:'private token'},{...twitch,live:null}])
    expect(report({device,twitch:value}).diagnostics[2].status).toBe('unknown');
  expect(report({device,twitch},now+16000).diagnostics[2].freshness).toBe('stale');
  expect(report({device,twitch:{...twitch,observedAt:new Date(now+3000).toISOString()}}).diagnostics[2].freshness).toBe('clock-skew');
  for(const value of [undefined,{...device,roles:['controller']},{...device,enabled:false},{...device,platform:'android'}])
    expect(report({device:value,twitch}).diagnostics.every(d=>d.status==='unknown')).toBe(true);
});

it('HTTP read-only route enforces host/paired observe identity, no-store, redaction and failure',async()=>{
  const app=express();
  const readSnapshot=vi.fn(()=>({...mapHostHealth({device,twitch},now),secret:'PRIVATE'}));
  app.use('/api/v1/streamcockpit-health',createHealthRouter({
    canRead:req=>['host-fixture','paired-observe-fixture'].includes(req.headers.authorization||''),readSnapshot,now:()=>now,
  }));
  const server=app.listen(0,'127.0.0.1');
  await new Promise<void>(resolve=>server.once('listening',resolve));
  const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/streamcockpit-health`;
  try{
    for(const auth of ['', 'revoked-fixture','paired-without-observe'])expect((await fetch(url,{headers:{authorization:auth}})).status).toBe(403);
    expect(readSnapshot).not.toHaveBeenCalled();
    for(const method of ['POST','PUT','PATCH','DELETE']){
      expect(isRemoteApiAllowed(method,'/v1/streamcockpit-health')).toBe(false);
      expect((await fetch(url,{method,headers:{authorization:'host-fixture'}})).status).toBe(405);
    }
    expect(readSnapshot).not.toHaveBeenCalled();
    for(const method of ['GET','HEAD']){
      expect(isRemoteApiAllowed(method,'/v1/streamcockpit-health')).toBe(true);
      expect(requiredDevicePermissions(method,'/v1/streamcockpit-health',null)).toEqual(['observe']);
      for(const auth of ['host-fixture','paired-observe-fixture']){
        const response=await fetch(url,{method,headers:{authorization:auth}});
        expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store');
        const body=await response.text();expect(body).not.toContain('PRIVATE');
        if(method==='HEAD')expect(body).toBe('');else expect(JSON.parse(body).status).toBe('unknown');
      }
    }
    readSnapshot.mockImplementation(()=>{throw Error('PRIVATE');});
    const failure=await fetch(url,{headers:{authorization:'paired-observe-fixture'}});
    expect(failure.status).toBe(503);expect(await failure.text()).not.toContain('PRIVATE');
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

class Element {
  ownerDocument={createElement:()=>new Element()};children:Element[]=[];dataset:Record<string,string>={};textContent='';className='';
  setAttribute(){} append(...children:Element[]){this.children.push(...children);}replaceChildren(){this.children=[];}remove(){}
}
it('health page GET-only lifecycle handles offline, denial, expiry and late responses',async()=>{
  // @ts-expect-error browser JS
  const {mountHealthPage}=await import('../apps/mobile/control/streamcockpit-health/page.js');
  vi.useFakeTimers();
  try{
    const request=vi.fn(async()=>diagnoseHealth(mapHostHealth({device,twitch},now),now));
    const root=new Element();const offline=mountHealthPage(root,{online:false,request});
    expect(root.children[1].textContent).toContain('Hors ligne');expect(request).not.toHaveBeenCalled();offline.destroy();
    const live=new Element();const page=mountHealthPage(live,{online:true,request});
    await vi.advanceTimersByTimeAsync(0);
    expect(request.mock.calls).toEqual([['/api/v1/streamcockpit-health']]);
    expect(live.children[0].children[2].children).toHaveLength(6);
    await vi.advanceTimersByTimeAsync(15000);expect(live.children[0].children[1].textContent).toContain('indisponible');page.destroy();
    const denied=new Element();const failed=mountHealthPage(denied,{online:true,request:async()=>{throw Error('secret');}});
    await vi.advanceTimersByTimeAsync(0);expect(denied.children[1].textContent).toContain('autorisation');expect(denied.children[1].textContent).not.toContain('secret');failed.destroy();
    let resolve:(value:unknown)=>void=()=>{};
    const late=new Element();const gone=mountHealthPage(late,{online:true,request:()=>new Promise(r=>{resolve=r;})});
    await vi.advanceTimersByTimeAsync(0);gone.destroy();resolve(diagnoseHealth(mapHostHealth({device,twitch},now),now));
    await vi.advanceTimersByTimeAsync(0);expect(late.children[0].children[2].children).toHaveLength(0);expect(vi.getTimerCount()).toBe(0);
  }finally{vi.useRealTimers();}
});
it('entrypoints connect authenticated route and Plus page without adding a navigation tab or timer',()=>{
  const read=(p:string)=>readFileSync(p,'utf8');
  const server=read('apps/server/src/index.ts'),ui=read('apps/mobile/control/control.js');
  expect(server.indexOf("app.use('/api/v1/streamcockpit-health'")).toBeGreaterThan(server.indexOf('DEVICE_AUTH_REQUIRED'));
  expect(server).toContain("remoteAuth.permits(id, ['observe'])");
  expect(ui).toContain("health:'plus'");expect(ui).toContain("page==='health'");expect(ui).toContain('updateMobileTimerStrip()');
  expect(read('apps/mobile/control/mobile-five-tab-ui.js')).toContain('data-page="health"');
});

it('real server entrypoint serves health read-only and never promotes a controller',async()=>{
  const {startDashboardServer}=await import('../apps/server/src/index.js');
  const {mkdtemp,rm}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os');
  const {join}=await import('node:path');
  const dir=await mkdtemp(join(tmpdir(),'lot-e-health-'));
  let server:Awaited<ReturnType<typeof startDashboardServer>>|undefined;
  try{
    server=await startDashboardServer({port:0,dataDir:dir,remoteEnabled:false,obsEnabled:false,timerAuthority:false,logger:{info(){},warn(){},error(){}}});
    const url=server.url+'/api/v1/streamcockpit-health';
    const response=await fetch(url);expect(response.status).toBe(200);
    const body=await response.json();expect(body.status).toBe('unknown');
    expect(body.diagnostics.every((d:{status:string})=>d.status==='unknown')).toBe(true);
    expect((await fetch(url,{method:'POST'})).status).toBe(405);
  }finally{await server?.stop();await rm(dir,{recursive:true,force:true});}
},30000);
