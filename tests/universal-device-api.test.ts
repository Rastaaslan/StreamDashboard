import {expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir,networkInterfaces} from 'node:os';
import path from 'node:path';
import {startDashboardServer} from '../apps/server/src/index.js';
import {migrateInstallation} from '../apps/mobile/shared/installation.js';

it('discloses a stable device descriptor only to authorized management controllers',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'sd-device-api-'));
 const model=migrateInstallation({id:'physical-device',platform:'windows',legacy:{name:'Device'}});
 const descriptor={...model.devices[0],privateSettings:'not-public'};
 const server=await startDashboardServer({port:0,host:'0.0.0.0',remoteEnabled:true,obsEnabled:false,dataDir:directory,deviceDescriptor:async()=>descriptor,logger:{info(){},warn(){},error(){}}});
 try{
  const lan=Object.values(networkInterfaces()).flat().find(v=>v?.family==='IPv4'&&!v.internal)?.address;
  if(!lan)throw Error('LAN test requires a non-loopback interface');
  const remote=`http://${lan}:${server.port}`,local=`http://127.0.0.1:${server.port}`,json={'content-type':'application/json'};
  expect((await fetch(remote+'/api/v2/device')).status).toBe(401);
  for(const management of [false,true]){
   const pairing=await fetch(local+'/api/v1/remote/pairing',{method:'POST',headers:json,body:JSON.stringify({management})}).then(r=>r.json());
   const paired=await fetch(remote+'/api/v1/remote/pair',{method:'POST',headers:json,body:JSON.stringify({...pairing,name:'Controller'})}).then(r=>r.json());
   const headers={...json,authorization:'Device '+paired.credential};
   const response=await fetch(remote+'/api/v2/device',{headers});
   expect(response.status).toBe(management?200:403);
   if(management){
    const value=await response.json();
    expect(value).toMatchObject({version:1,device:{id:'physical-device'},observed:{obsConnected:false}});
    expect(value.device).not.toHaveProperty('privateSettings');
    expect((await fetch(remote+'/api/v2/device',{method:'PUT',headers,body:'{}'})).status).toBe(403);
   }
  }
 }finally{await server.stop();await rm(directory,{recursive:true,force:true});}
});
