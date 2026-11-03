import {expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request as httpRequest} from 'node:http';
import {startDashboardServer} from '../apps/server/src/index.js';

async function withServer(run:(url:string)=>Promise<void>){
  const dir=await mkdtemp(join(tmpdir(),'sc3-scope-'));
  const host=await startDashboardServer({port:0,dataDir:dir,obsEnabled:false,timerAuthority:false,remoteEnabled:false,logger:{info(){},warn(){},error(){}}});
  try{await run(host.url)}finally{await host.stop();await rm(dir,{recursive:true,force:true})}
}
function request(url:string,method='GET',body?:unknown):Promise<{status:number;body:string}>{
  return new Promise((resolve,reject)=>{
    const req=httpRequest(url,{method,headers:{'content-type':'application/json'}},res=>{
      const chunks:Buffer[]=[];res.on('data',c=>chunks.push(c));res.on('error',reject);
      res.on('end',()=>resolve({status:res.statusCode??0,body:Buffer.concat(chunks).toString()}));
    });
    req.on('error',reject);req.setTimeout(5000,()=>req.destroy(Error('TIMEOUT')));
    req.end(body===undefined?undefined:JSON.stringify(body));
  });
}
it('real HTTP host explicitly disables V4 routes for every verb, with no production encoder',async()=>withServer(async url=>{
  for(const route of ['/api/clipforge','/api/v1/clipforge/render','/api/v2/clipforge/jobs','/api/v1/streamcockpit-clipforge/preview','/api/v2/CLIPFORGE']){
    for(const method of ['GET','POST','PUT','DELETE','PATCH','HEAD']){
      const res=await request(url+route,method);
      expect(res.status,method+' '+route).toBe(410);
      if(method!=='HEAD')expect(JSON.parse(res.body)).toMatchObject({error:{code:'FEATURE_DEFERRED',retryable:false,targetVersion:'4.0'}});
    }
  }
}),30000);
it('legacy command aliases cannot execute V4 actions; simple replay route remains present',async()=>withServer(async url=>{
  for(const path of ['/api/commands','/api/v1/commands','/api/v2/actions']){
    for(const action of ['clipforge.render','clipforge:export','media.render','video.export.vertical']){
      const res=await request(url+path,'POST',{action,type:action});
      expect(res.status).toBe(410);
    }
  }
  const res=await request(url+'/api/v2/replay');
  expect(res.status).not.toBe(410);
  expect(res.status).not.toBe(404);
}),30000);
