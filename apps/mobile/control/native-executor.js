import {openReplica} from './autonomy-store.js';
import {LOCAL_SCOPE} from './device-workspace.js';
import {createDeviceAudio} from './device-audio.js';
import {createDeviceServices} from './device-services.js';
import {createLocalExecutor} from './local-executor.js';
import {deviceRoleAvailable} from '../shared/installation.js';

let executor,device,opening;
// This page has no preload, native bridge, remote frame or navigation. The
// native owner supplies only the local runtime address and active role snapshot.
globalThis.sdLocalExecutor={
 async request(operation,body,context){
  const endpoint=context.endpoint;
  if(!['http://127.0.0.1:48133','http://127.0.0.1:48135'].includes(endpoint))throw new Error('Agent local invalide.');
  device=context.device;
  if(!executor)await (opening??=(async()=>{
   const store=await openReplica(LOCAL_SCOPE),audio=createDeviceAudio({store});
   const services=createDeviceServices({store,enabled:capability=>deviceRoleAvailable(device,capability),request:async(path,body,method=body===undefined?'GET':'POST')=>{
    const response=await fetch(endpoint+path,{method,headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(65000)});
    const result=await response.json();if(!response.ok)throw Object.assign(new Error(result.error?.message||'Service local indisponible.'),{status:response.status});return result;
   }});
   executor=createLocalExecutor({store,audio,services,enabled:capability=>deviceRoleAvailable(device,capability)});
  })().finally(()=>{opening=undefined;}));
  if(operation==='state')return executor.state();
  if(operation==='command')return executor.command(body);
  throw new Error('Opération locale inconnue.');
 },
 dispose(){executor?.dispose();},
};
