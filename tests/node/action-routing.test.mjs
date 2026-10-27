import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createActionRouter} from '../../apps/mobile/control/action-routing.js';
import {migrateInstallation,planInstallationChange,validateInstallation} from '../../apps/mobile/shared/installation.js';
const action={id:'trigger',type:'scene.set',value:'intro',label:'Intro',color:'purple',shortcut:''};
function fixture(platform='windows',preset='custom') {
 let installation=migrateInstallation({id:'local',platform});installation.preset=preset;
 const definitions={a:{...action,id:'target-a'},b:{...action,id:'target-b'}};
 for(const id of ['a','b'])installation.devices.push({id,name:id,platform:'windows',enabled:true,roles:['obs-executor'],capabilities:['obs','clips','audio','chat'],endpoint:`https://${id}.test`});
 installation.actionRoutes=[{workspace:'local',actionId:'trigger',deviceId:'a',definition:definitions.a}];
 const calls=[],down=new Set();let changedIdentity=false,failPost=false,dispatches=0;
 const router=createActionRouter({installation:()=>installation,workspace:()=> 'local',localEndpoint:'',credential:async origin=>'token-'+new URL(origin).hostname,request:async(path,body,method,origin,token)=>{
   calls.push({path,body,method,origin,token});const id=new URL(origin).hostname[0];
   if(down.has(id))throw Error('offline');
   if(path==='/api/v2/device')return {device:{id:changedIdentity?'replacement':id}};
   if(path==='/api/v2/state')return {configuration:{actions:[definitions[id]]},host:{state:{obs:{connected:true}}}};
   dispatches++;if(failPost)throw Error('timeout');return {status:'succeeded'};
 }});
 return {router,calls,definitions,down,get installation(){return installation;},change:changes=>{installation=planInstallationChange(installation,changes,installation.revision).next;},changedIdentity:()=>{changedIdentity=true;},failPost:()=>{failPost=true;},get dispatches(){return dispatches;}};
}
for(const preset of ['single-pc','single-pc-deck','dual-pc','dual-pc-deck','custom'])test(preset+': touch and desktop route by physical executor, never by selected workspace',async()=>{
 const f=fixture(preset.includes('deck')?'android':'windows',preset);
 const result=await f.router.execute(action,{id:'command',issuedAt:new Date().toISOString()});
 assert.equal(result.deviceId,'a');assert.equal(f.dispatches,1);
 assert.ok(f.calls.every(c=>c.origin==='https://a.test'&&c.token==='token-a.test'));
 assert.equal(f.calls.at(-1).body.expectedAction.id,'target-a');
 f.change({actionRoutes:[...f.installation.actionRoutes,{workspace:'local',actionId:'second',deviceId:'b',definition:f.definitions.b}]});
 f.down.add('a');await assert.rejects(f.router.execute(action,{}),/offline/);
 assert.equal((await f.router.execute({...action,id:'second'},{})).deviceId,'b');
 f.down.clear();assert.equal((await f.router.execute(action,{})).deviceId,'a');
});
test('Android alone has no invented executor or queued OBS command',async()=>{
 const installation=migrateInstallation({id:'phone',platform:'android'});
 let calls=0;const router=createActionRouter({installation:()=>installation,workspace:()=> 'local',credential:async()=>'',request:async()=>{calls++;}});
 assert.equal(router.status(action),null);await assert.rejects(router.execute(action,{}),/Aucune destination/);assert.equal(calls,0);
});
test('retired identity, changed action and reassigned address cannot execute or fall back',async()=>{
 const f=fixture();f.change({disableDeviceId:'a'});await assert.rejects(f.router.execute(action,{}),/désactivé/);assert.equal(f.calls.length,0);
 f.change({device:{...f.installation.devices.find(d=>d.id==='a'),enabled:true}});
 f.definitions.a={...f.definitions.a,value:'different'};await assert.rejects(f.router.execute(action,{}),/bouton a changé/);assert.equal(f.dispatches,0);
 f.changedIdentity();await assert.rejects(f.router.execute(action,{}),/identité/);assert.equal(f.dispatches,0);
});
test('an interrupted dispatch is never replayed and the association remains restorable',async()=>{
 const f=fixture();f.failPost();await assert.rejects(f.router.execute(action,{}),/timeout/);
 await f.router.observe('a');assert.equal(f.dispatches,1);assert.equal(f.installation.actionRoutes.length,1);
 assert.throws(()=>validateInstallation({...f.installation,actionRoutes:[...f.installation.actionRoutes,...f.installation.actionRoutes]}),/dupliquée/);
});
test('peer role changes are re-observed after disable and enable without pairing again or replaying a command',async()=>{
 const installation=migrateInstallation({id:'local',platform:'windows'});
 installation.devices.push({id:'peer',name:'Peer',platform:'windows',enabled:true,roles:[],capabilities:['obs'],endpoint:'https://peer.test'});
 installation.actionRoutes=[{workspace:'local',actionId:action.id,deviceId:'peer',definition:action}];
 let roles=['obs-executor'],sent=0;
 const router=createActionRouter({installation:()=>installation,workspace:()=> 'local',localEndpoint:'',credential:async()=> 'fixture',request:async path=>{
  if(path==='/api/v2/device')return {device:{id:'peer',roles},observed:{permissions:['obs']}};
  if(path==='/api/v2/state')return {configuration:{actions:[action]},host:{state:{obs:{connected:true}}}};
  sent++;return {status:'succeeded'};
 }});
 assert.equal(router.status(action).status,'unknown');await router.execute(action,{});assert.equal(sent,1);
 roles=[];await assert.rejects(router.execute(action,{}),/arrêté/);assert.equal(sent,1);
 roles=['obs-executor'];await router.execute(action,{});assert.equal(sent,2);assert.deepEqual(installation.devices[1].roles,[]);
});
