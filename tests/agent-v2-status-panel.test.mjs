import test from 'node:test';
import assert from 'node:assert/strict';
import {agentStatusText,mountAgentStatus} from '../apps/mobile/control/agent-v2-status.js';

const fresh={status:'connected',observation:{staleAt:2000,payload:{connected:true,active:true}}};
test('Agent UI distinguishes fresh active, stopped, expired, and unavailable observations',()=>{
 assert.equal(agentStatusText(fresh,1000),'PC de stream disponible · diffusion active');
 assert.equal(agentStatusText({...fresh,observation:{staleAt:2000,payload:{connected:true,active:false}}},1000),
   'PC de stream disponible · diffusion arrêtée');
 for(const value of [fresh,{status:'unavailable',observation:fresh.observation},
   {status:'connected',observation:null},{status:'connected',observation:{staleAt:4000,payload:{active:true}}}]){
  assert.match(agentStatusText(value,3000),/indisponible/);
 }
 assert.equal(agentStatusText({status:'not_configured'},1000),'');
});
test('Agent UI owns one read, drops late updates after destroy, and never receives credentials',async()=>{
 const saved=globalThis.document;
 let label,removed=false,resolveSecond,calls=0;
 globalThis.document={createElement(){return label={textContent:'',hidden:true,
   setAttribute(){},remove(){removed=true}}}};
 const root={append(value){assert.equal(value,label)}};
 const initial={...fresh,observation:{...fresh.observation,staleAt:Date.now()+8000}};
 const panel=mountAgentStatus(root,async()=>{
  calls++;
  if(calls===1)return initial;
  return new Promise(resolve=>{resolveSecond=resolve});
 });
 try{
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls,1);assert.match(label.textContent,/diffusion active/);
  initial.observation.staleAt=Date.now()-1;
  const pending=panel.refresh();await Promise.resolve();
  assert.match(label.textContent,/indisponible/);
  await panel.refresh();assert.equal(calls,2);
  panel.destroy();
  const before=label.textContent;resolveSecond({status:'unavailable',observation:null});
  await pending;assert.equal(label.textContent,before);assert.equal(removed,true);
 }finally{panel.destroy();globalThis.document=saved}
});
