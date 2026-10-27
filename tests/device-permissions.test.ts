import {expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir,networkInterfaces} from 'node:os';
import path from 'node:path';
import {RemoteAuth} from '../apps/server/src/remote-auth.js';
import {requiredDevicePermissions} from '../apps/server/src/remote-api-policy.js';
import {startDashboardServer} from '../apps/server/src/index.js';
import {migrateInstallation} from '../apps/mobile/shared/installation.js';
it('persists restricted grants through pairing, restart, change and revocation without promoting RC11.7 scopes',()=>{
 const first=new RemoteAuth(),code=first.createPairing(undefined,true,['observe','obs']);
 const auth=new RemoteAuth(Date.now,[],first.serializePairings()),paired=auth.pair(code.id,code.code,'Controller');
 const restarted=new RemoteAuth(Date.now,auth.serialize());
 expect(restarted.permissions(paired.deviceId)).toEqual(['observe','obs']);
 expect(restarted.permits(paired.deviceId,['clips'])).toBe(false);
 const ticket=restarted.createWsTicket(paired.credential).ticket;
 restarted.setPermissions(paired.deviceId,[]);expect(restarted.consumeWsTicket(ticket)).toBeNull();
 expect(()=>restarted.setPermissions(paired.deviceId,['configuration'])).toThrow('toutes les permissions');
 restarted.revoke(paired.deviceId);expect(restarted.permissions(paired.deviceId)).toEqual([]);
 const legacy=first.createPairing(),old=first.pair(legacy.id,legacy.code,'Legacy');expect(first.canManage(old.deviceId)).toBe(false);
});
it('requires action-specific grants and prevents indirect configuration and legacy command bypasses',()=>{
 const actions=[{id:'clip',type:'replay.save',value:'',label:'Clip',shortcut:'',color:'green'}] as const;
 expect(requiredDevicePermissions('POST','/v2/actions',{action:'clip'},[...actions])).toEqual(['clips']);
 expect(requiredDevicePermissions('POST','/v2/actions',{action:'live.start'})).toEqual(['obs','cloud']);
 expect(requiredDevicePermissions('POST','/v1/commands',{type:'OBS_SET_SCENE'})).toEqual(['configuration']);
 expect(requiredDevicePermissions('POST','/v2/autonomy/sync',{})).toEqual(['configuration']);
 expect(requiredDevicePermissions('GET','/v2/youtube/chat',{})).toEqual(['chat']);
});
it('retains restricted and empty permissions through an actual server shutdown and disk reload',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'sd-permission-restart-')),model=migrateInstallation({id:'persisted-agent',platform:'windows'});
 const start=()=>startDashboardServer({port:0,host:'0.0.0.0',remoteEnabled:true,obsEnabled:false,dataDir:directory,deviceDescriptor:async()=>model.devices[0],logger:{info(){},warn(){},error(){}}});
 let server=await start();const address=Object.values(networkInterfaces()).flat().find(value=>value?.family==='IPv4'&&!value.internal)!.address,json={'content-type':'application/json'};
 try{
  const pairs=[];
  for(const permissions of [['observe'],[]]){
   const code=await (await fetch(server.url+'/api/v1/remote/pairing',{method:'POST',headers:json,body:JSON.stringify({management:true,permissions})})).json() as any;
   pairs.push(await (await fetch(`http://${address}:${server.port}/api/v1/remote/pair`,{method:'POST',headers:json,body:JSON.stringify({...code,name:'Restricted'})})).json() as any);
  }
  await server.stop();server=await start();
  const devices=await (await fetch(server.url+'/api/v1/remote/devices')).json() as any[];
  expect(devices.map(device=>device.permissions)).toEqual([['observe'],[]]);
  for(const paired of pairs){
   const response=await fetch(`http://${address}:${server.port}/api/v2/actions`,{method:'POST',headers:{...json,authorization:'Device '+paired.credential},body:JSON.stringify({id:'no_restart_effect',action:'micro',issuedAt:new Date().toISOString()})});
   expect(response.status).toBe(403);expect(await response.json()).toMatchObject({error:{code:'DEVICE_PERMISSION_DENIED'}});
  }
 }finally{await server.stop();await rm(directory,{recursive:true,force:true});}
});
it('enforces restricted permissions over LAN, reports granted capabilities and rejects remote administration',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'sd-permissions-'));
 const model=migrateInstallation({id:'physical-device',platform:'windows'});
 const server=await startDashboardServer({port:0,host:'0.0.0.0',remoteEnabled:true,obsEnabled:false,dataDir:directory,deviceDescriptor:async()=>model.devices[0],logger:{info(){},warn(){},error(){}}});
 try {
  const address=Object.values(networkInterfaces()).flat().find(v=>v?.family==='IPv4'&&!v.internal)!.address;
  const remote=`http://${address}:${server.port}`,local=`http://127.0.0.1:${server.port}`,json={'content-type':'application/json'};
  const code=await (await fetch(local+'/api/v1/remote/pairing',{method:'POST',headers:json,body:JSON.stringify({management:true,permissions:['observe']})})).json() as any;
  const paired=await (await fetch(remote+'/api/v1/remote/pair',{method:'POST',headers:json,body:JSON.stringify({...code,name:'Read-only'})})).json() as any;
  const headers={...json,authorization:'Device '+paired.credential};
  const descriptor=await (await fetch(remote+'/api/v2/device',{headers})).json() as any;
  expect(descriptor.observed.permissions).toEqual(['observe']);
  expect((await fetch(remote+'/api/v2/state',{headers})).status).toBe(200);
  for(const origin of ['http://127.0.0.1:48133','http://127.0.0.1:48134']){
   const state=await fetch(remote+'/api/v2/state',{headers:{...headers,origin}});expect(state.status).toBe(200);expect(state.headers.get('access-control-allow-origin')).toBe(origin);
   expect((await fetch(remote+'/api/v2/state',{headers:{origin}})).status).toBe(401);
  }
  expect((await fetch(remote+'/api/v2/state',{headers:{...headers,origin:'https://untrusted.example'}})).status).toBe(403);
  const refused=await fetch(remote+'/api/v2/actions',{method:'POST',headers,body:JSON.stringify({id:'denied_action',action:'micro',issuedAt:new Date().toISOString()})});
  expect(refused.status).toBe(403);expect(await refused.json()).toMatchObject({error:{code:'DEVICE_PERMISSION_DENIED'}});
  const route='/api/v1/remote/devices/'+paired.deviceId+'/permissions',body=JSON.stringify({permissions:['observe','obs'],expectedPermissions:['observe']});
  expect((await fetch(remote+route,{method:'PUT',headers,body})).status).toBe(403);
  expect((await fetch(local+route,{method:'PUT',headers:json,body})).status).toBe(200);
  expect((await fetch(local+route,{method:'PUT',headers:json,body})).status).toBe(409);
 } finally {await server.stop();await rm(directory,{recursive:true,force:true});}
});
