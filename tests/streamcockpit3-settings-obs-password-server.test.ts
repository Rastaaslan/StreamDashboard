import {afterEach,expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {startDashboardServer,type DashboardServerHandle} from '../apps/server/src/index.js';

let server:DashboardServerHandle|undefined,dir='';
async function start(){
 dir=await mkdtemp(path.join(os.tmpdir(),'sc3-obs-password-guard-'));
 server=await startDashboardServer({port:0,dataDir:dir,obsEnabled:false,twitchClientId:'',logger:{info(){},warn(){},error(){}}});
 return server;
}
afterEach(async()=>{if(server)await server.stop();server=undefined;if(dir)await rm(dir,{recursive:true,force:true});dir='';});
async function put(route:string,body:unknown){
 const response=await fetch(server!.url+route,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 return {status:response.status,body:await response.json()};
}
async function state(){return fetch(server!.url+'/api/v1/state').then(response=>response.json());}
async function v2(){return fetch(server!.url+'/api/v2/state').then(response=>response.json());}

it('v1 rejects simultaneous OBS password replacement and clearing before mutating ANY setting',async()=>{
 await start();
 expect((await put('/api/v1/settings',{obsPassword:'saved-secret',streamerName:'Before'})).status).toBe(200);
 const initial=await state();
 expect(initial.settings.obsPasswordSet).toBe(true);
 const conflicting=await put('/api/v1/settings',{clearObsPassword:true,obsPassword:'replacement',streamerName:'SHOULD_NOT_SAVE'});
 expect(conflicting.status).toBe(400);
 expect(JSON.stringify(conflicting.body)).toMatch(/mot de passe OBS|effacement/i);
 const after=await state();
 expect(after.settings.obsPasswordSet).toBe(true);
 expect(after.settings.streamerName).toBe('Before');
 expect(after.settings.obsPassword).toBeUndefined();
 expect((await put('/api/v1/settings',{obsPassword:'',streamerName:'Blank keeps secret'})).status).toBe(200);
 expect((await state()).settings.obsPasswordSet).toBe(true);
},20000);

it('v2 refuses a conflicting password patch with a fresh revision, without invalidating it',async()=>{
 await start();
 expect((await put('/api/v1/settings',{obsPassword:'saved-secret'})).status).toBe(200);
 const revision=(await v2()).host.settingsRevision;
 const conflict=await put('/api/v2/settings',{expectedRevision:revision,clearObsPassword:true,obsPassword:'replacement',accent:'red'});
 expect(conflict.status).toBe(400);
 expect((await v2()).host.settingsRevision).toBe(revision);
 expect((await state()).settings.obsPasswordSet).toBe(true);
 const accepted=await put('/api/v2/settings',{expectedRevision:revision,clearObsPassword:true});
 expect(accepted.status).toBe(200);
 expect((await state()).settings.obsPasswordSet).toBe(false);
 const stale=await put('/api/v2/settings',{expectedRevision:revision,obsPassword:'stale-secret'});
 expect(stale.status).toBe(409);
 expect((await state()).settings.obsPasswordSet).toBe(false);
},20000);
