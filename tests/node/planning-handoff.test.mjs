import {test} from 'node:test';
import assert from 'node:assert/strict';
import {transitionPlanningHandoff,planningOwned} from '../../apps/mobile/shared/planning-handoff.js';
import {runPlanningHandoff} from '../../apps/mobile/control/planning-handoff.js';
const item={id:'event_123',title:'Publié',category:'live',startAtUtc:'2030-11-01T18:00:00.000Z',endAtUtc:'2030-11-01T19:00:00.000Z',ownership:'LOCAL',editable:true,providers:{google:{status:'synced',calendarId:'calendar',remoteId:'event',remoteRevision:'etag'},twitch:{status:'synced',remoteId:'segment',accountId:'channel'}}};
function fixture(){
 const states={a:{items:[structuredClone(item)],journal:{}},b:{items:[],journal:{}}};
 const job={ticket:{id:'transfer_one',from:'a',to:'b',item:structuredClone(item)},source:{id:'a'},target:{id:'b'},status:'pending'};
 let saved=structuredClone(job),calls=0,lose=0;
 const call=async(target,body)=>{
  const result=transitionPlanningHandoff(states[target.id],body.workspace,body.operation,body.ticket,body.proof);
  // Every phase is committed and reopened before its response reaches the controller.
  states[target.id]=JSON.parse(JSON.stringify(result.state));
  assert.ok(Object.values(states).flatMap(state=>state.items).filter(planningOwned).length<=1,'two owners');
  if(++calls===lose)throw Error('network lost after durable commit');return {receipt:result.receipt};
 };
 return {states,job,call,persist:async job=>{saved=JSON.parse(JSON.stringify(job));},saved:()=>saved,lose:phase=>{lose=phase;}};
}
for(let phase=1;phase<=4;phase++)test('lost response after phase '+phase+' resumes without a second owner',async()=>{
 const f=fixture();f.lose(phase);await assert.rejects(runPlanningHandoff(f.job,f.call,f.persist),/network lost/);
 await runPlanningHandoff(f.saved(),f.call,f.persist);
 assert.equal(f.saved().status,'completed');assert.deepEqual(f.states.b.items,[item]);assert.equal(planningOwned(f.states.a.items[0]),false);
});
for(let phase=0;phase<4;phase++)test('cancellation after phase '+phase+' restores the source and rejects delayed activation',async()=>{
 const f=fixture();if(phase){f.lose(phase);await assert.rejects(runPlanningHandoff(f.job,f.call,f.persist));}
 await runPlanningHandoff(f.saved(),f.call,f.persist,true);
 assert.deepEqual(f.states.a.items,[item]);assert.deepEqual(f.states.b.items,[]);assert.equal(f.saved().status,'cancelled');
 await assert.rejects(runPlanningHandoff(f.job,f.call,f.persist),/annulé/);
 assert.throws(()=>transitionPlanningHandoff(f.states.b,'b','activate',f.job.ticket,{ticket:f.job.ticket,status:'released'}),/annulé/);
});
test('a completed handoff reverses with the destination edits and cannot be cancelled or replayed over them',async()=>{
 const f=fixture();await runPlanningHandoff(f.job,f.call,f.persist);await assert.rejects(runPlanningHandoff(f.job,f.call,f.persist,true),/sens inverse/);
 f.states.b.items[0].title='Modifié sur B';
 const back={ticket:{id:'transfer_back',from:'b',to:'a',item:structuredClone(f.states.b.items[0])},source:{id:'b'},target:{id:'a'},status:'pending'};
 await runPlanningHandoff(back,f.call,f.persist);assert.equal(planningOwned(f.states.a.items[0]),true);assert.equal(f.states.a.items[0].title,'Modifié sur B');
 await runPlanningHandoff(f.job,f.call,async()=>{});assert.equal(planningOwned(f.states.b.items[0]),false);assert.equal(f.states.a.items[0].title,'Modifié sur B');
});
test('conflicts, changed identities, uncertain publications and forged mismatching receipts preserve state',()=>{
 const f=fixture(),ticket=f.job.ticket;
 assert.throws(()=>transitionPlanningHandoff(f.states.a,'different','prepare',ticket));
 assert.throws(()=>transitionPlanningHandoff(f.states.a,'a','prepare',{...ticket,item:{...item,title:'stale'}}));
 assert.throws(()=>transitionPlanningHandoff(f.states.a,'a','prepare',{...ticket,item:{...item,providers:{google:{uncertainCreate:{}}}}}));
 const prepared=transitionPlanningHandoff(f.states.a,'a','prepare',ticket);
 assert.throws(()=>transitionPlanningHandoff(f.states.a,'b','stage',ticket,prepared.receipt),/même identité/);
 assert.throws(()=>transitionPlanningHandoff(prepared.state,'a','release',ticket,{status:'staged',ticket:{...ticket,to:'c'}}),/Reçu/);
 assert.deepEqual(f.states.a.items,[item]);assert.equal(Object.keys(f.states.a.journal).length,0);
});
test('a copy relinquished by the previous local-import workflow can return without deleting its history',async()=>{
 const f=fixture();f.states.b.items=[{...item,editable:false,transferredTo:'a'}];
 await runPlanningHandoff(f.job,f.call,f.persist);
 assert.deepEqual(f.states.b.items,[item]);assert.equal(f.states.a.items[0].transferredTo,'b');
});
