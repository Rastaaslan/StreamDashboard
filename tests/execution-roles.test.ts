import {expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {startDashboardServer} from '../apps/server/src/index.js';
import {migrateInstallation,type InstallationDevice} from '../apps/mobile/shared/installation.js';

it('disabled engines reject effects while states, configuration and unrelated services remain usable',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'sd-role-test-'));
 const model=migrateInstallation({id:'role-device',platform:'windows'});
 let descriptor:InstallationDevice={...model.devices[0],roles:['controller']};
 const server=await startDashboardServer({port:0,host:'127.0.0.1',obsEnabled:false,dataDir:directory,deviceDescriptor:async()=>descriptor,logger:{info(){},warn(){},error(){}}});
 try{
  const origin='http://127.0.0.1:'+server.port;
  expect((await fetch(origin+'/api/v1/health')).status).toBe(200);
  const state=await fetch(origin+'/api/v2/state');expect(state.status).toBe(200);
  const sounds=await (await fetch(origin+'/api/v1/soundboard')).json();expect(sounds.available).toBe(false);expect(sounds.outputs).toEqual([]);
  const action=await fetch(origin+'/api/v2/actions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:'role_test_sound',action:'sound.play',soundId:'unavailable',issuedAt:new Date().toISOString()})});
  expect(action.status).toBe(409);expect((await action.json()).error.code).toBe('DEVICE_ROLE_STOPPED');
  expect((await fetch(origin+'/api/v2/youtube')).status).toBe(409);
  expect((await fetch(origin+'/api/v2/youtube/chat')).status).toBe(409);
  // Adding a role in persisted topology is not evidence its native engine has restarted.
  descriptor={...descriptor,roles:['controller','audio','services','display']};
  expect((await fetch(origin+'/api/v2/youtube')).status).toBe(409);
 }finally{await server.stop();await rm(directory,{recursive:true,force:true});}
});
