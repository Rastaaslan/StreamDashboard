import {expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {startDashboardServer} from '../apps/server/src/index.js';
import {PlanningOrchestrator} from '../packages/core/src/planning.js';
import {emptyCompanionState,reconcileCompanionBatch,resolveCompanionConflict} from '../apps/server/src/companion-sync.js';
import {drainCompanionProviders} from '../apps/server/src/companion-providers.js';
import {isManagementApiAllowed,isRemoteApiAllowed,requiredDevicePermissions} from '../apps/server/src/remote-api-policy.js';
import type {CalendarItem} from '../packages/contracts/src/index.js';
const item:CalendarItem={id:'event_123',title:'Publié',category:'live',startAtUtc:'2030-11-01T18:00:00.000Z',endAtUtc:'2030-11-01T19:00:00.000Z',ownership:'LOCAL',editable:true,desiredPublication:{local:true,twitch:false,google:false}};
it('held ownership blocks every publication entry point, companion edits and deletion',async()=>{
 const held={...item,editable:false,transferredTo:'other',transferId:'transfer_123',deletionPending:true};let effects=0;
 const providers={google:{create:async()=>{effects++;return {id:'bad'};},update:async()=>{effects++;return {};},delete:async()=>{effects++;}}};
 const planner=new PlanningOrchestrator([held],providers,async()=>{effects++;});
 for(const operation of [()=>planner.update(item.id,item),()=>planner.retry(item.id,'google'),()=>planner.remove(item.id,{local:true,google:true}),()=>planner.resolveConflict(item.id,'google','local'),()=>planner.markRemoteDeleted(item.id,'google'),()=>planner.markConflict(item.id,'google',{title:'Other',startAtUtc:item.startAtUtc,endAtUtc:item.endAtUtc})])await expect(operation()).rejects.toThrow('transféré');
 await planner.refreshTwitch();await expect(planner.create(item)).rejects.toThrow('identité');
 const state=emptyCompanionState();state.providerWork[item.id+':google']={item:held,provider:'google',action:'publish',status:'queued'};
 await drainCompanionProviders([held],state,providers,async()=>{effects++;});
 const result=reconcileCompanionBatch([held],[],state,[{id:'offline-edit',entityId:item.id,type:'delete',baseRevision:1}]);
 expect(result.conflicts[0].fields).toEqual(['ownership']);expect(result.planning).toEqual([held]);
 expect(()=>resolveCompanionConflict(result.planning,result.companion,'offline-edit','android')).toThrow('transféré');expect(effects).toBe(0);
});
it('two actual servers retain holds and receipts over restart, activate once and return ownership',async()=>{
 const directories=await Promise.all([0,1].map(()=>mkdtemp(path.join(tmpdir(),'sd-handoff-'))));
 const start=(i:number)=>startDashboardServer({port:0,host:'127.0.0.1',obsEnabled:false,dataDir:directories[i],logger:{info(){},warn(){},error(){}}});
 const servers=await Promise.all([start(0),start(1)]);
 const request=async(i:number,route:string,body?:unknown,method=body?'POST':'GET')=>{const response=await fetch('http://127.0.0.1:'+servers[i].port+route,{method,headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const value=await response.json();if(!response.ok)throw new Error(JSON.stringify(value));return value;};
 const snapshot=(i:number)=>request(i,'/api/v2/autonomy');
 try{
  await request(0,'/api/v2/planning',item);
  let [a,b]=await Promise.all([snapshot(0),snapshot(1)]);const event=a.bundle.data.host.planning[0];
  const ticket={id:'server_handoff',from:a.workspace,to:b.workspace,item:event};
  const phase=(i:number,operation:string,proof?:unknown)=>request(i,'/api/v2/planning/handoff',{workspace:i===0?a.workspace:b.workspace,operation,ticket,proof});
  const prepared=await phase(0,'prepare');await servers[0].stop();servers[0]=await start(0);
  a=await snapshot(0);expect(a.bundle.data.host.planning[0].transferId).toBe(ticket.id);
  await expect(request(0,'/api/v2/planning/'+event.id,{expectedRevision:a.bundle.data.host.planningRevisions[event.id]},'DELETE')).rejects.toThrow('transféré');
  const staged=await phase(1,'stage',prepared.receipt),released=await phase(0,'release',staged.receipt);
  await servers[1].stop();servers[1]=await start(1);await phase(1,'activate',released.receipt);await phase(1,'activate',released.receipt);
  b=await snapshot(1);expect(b.bundle.data.host.planning).toHaveLength(1);expect(b.bundle.data.host.planning[0].id).toBe(event.id);
  const back={id:'server_reverse',from:b.workspace,to:a.workspace,item:b.bundle.data.host.planning[0]};
  const reverse=(i:number,operation:string,proof?:unknown)=>request(i,'/api/v2/planning/handoff',{workspace:i===0?a.workspace:b.workspace,operation,ticket:back,proof});
  const p=await reverse(1,'prepare'),s=await reverse(0,'stage',p.receipt),r=await reverse(1,'release',s.receipt);await reverse(0,'activate',r.receipt);
  await servers[0].stop();servers[0]=await start(0);a=await snapshot(0);expect(a.bundle.data.host.planning[0].editable).toBe(true);expect(a.bundle.data.host.planning[0].transferredTo).toBeUndefined();
 }finally{await Promise.all(servers.map(server=>server.stop()));await Promise.all(directories.map(directory=>rm(directory,{recursive:true,force:true})));}
 expect(isManagementApiAllowed('POST','/v2/planning/handoff')).toBe(true);expect(isRemoteApiAllowed('POST','/v2/planning/handoff')).toBe(false);expect(requiredDevicePermissions('POST','/v2/planning/handoff',{})).toEqual(['configuration','planning']);
},30000);
