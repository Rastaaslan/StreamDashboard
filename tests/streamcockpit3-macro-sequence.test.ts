import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {ControlService,validateConfiguration,type ControlAdapter} from '../apps/server/src/control-service.js';
import {defaultControlData,type DeckAction} from '../packages/contracts/src/control.js';
import {macroSequenceSteps} from '../apps/server/src/streamcockpit-macro-sequence.js';
import {masterContextConfig} from '../apps/server/src/streamcockpit-master-context.js';
import {withContextFixture} from './helpers/streamcockpit-context-fixture.js';

const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true})});
const macro=(value='scene-live,scene-pause'):DeckAction=>
 ({id:'two-scenes',label:'Séquence scènes',type:'macro.sequence',value,color:'purple',shortcut:''});
const request=(action='two-scenes',id='macro_12345678',revision=1)=>({
 id,action,confirmed:true,expectedRevision:revision,issuedAt:new Date().toISOString(),expectedAction:macro(),
});
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'sc3-macro-sequence-'));roots.push(root);
 const file=join(root,'control.json'),actions:DeckAction[]=[...defaultControlData().configuration.actions,macro()];
 const calls:string[]=[];const execute=vi.fn(async (a:DeckAction,id:string,recheck?:()=>Promise<void>)=>{
   await recheck?.();const disk=JSON.parse(await readFile(file,'utf8'));
   const trace=disk.receipts.at(-1)?.macroSteps;
   expect(trace).toBeDefined();expect(trace?.some((s:any)=>s.status==='running')).toBe(true);
   calls.push(a.id+':'+id);
 });
 const adapter:ControlAdapter={live:async()=>false,output:async()=>{},metadata:async()=>{},action:execute};
 const control=await ControlService.open(file,adapter);
 const config=control.snapshot().configuration;config.actions=actions;await control.configure(config,config.revision);
 return {file,control,execute,calls};
}
it('rejects missing, self, repeated, nested and unsafe public Twitch steps before any side effect',()=>{
 const config=defaultControlData().configuration,allowed=macro();
 for(const bad of ['','scene-live','scene-live,scene-live','two-scenes,scene-live',
   'scene-live,live.start','scene-live,wizebot-uptime','scene-live,replay.save',
   'scene-live,scene-pause,scene-live','scene-live,scene-pause,scene-intro,scene-live,scene-pause,scene-live']){
   const value={...config,actions:[...config.actions,{...allowed,value:bad}]};
   expect(()=>validateConfiguration(value)).toThrow();
 }
 expect(()=>validateConfiguration({...config,actions:[...config.actions,{...allowed,shortcut:'Control+Alt+Shift+F18'}]})).toThrow('manuellement');
 expect(()=>macroSequenceSteps({...allowed,value:'scene-live,scene-pause'},[...config.actions,allowed]).map(s=>s.id))
  .not.toThrow();
});
it('confirms two sequenced OBS actions only once with persisted per-step intent and exact restart readback',async()=>{
 const f=await fixture(),id=randomUUID(),rev=f.control.snapshot().configuration.revision;
 const r=await f.control.execute(request('two-scenes',id,rev));
 expect(r).toMatchObject({status:'succeeded',macroSteps:[
  {id:'scene-live',status:'succeeded'},{id:'scene-pause',status:'succeeded'}]});
 expect(f.calls).toEqual(['scene-live:'+id+'_step_1','scene-pause:'+id+'_step_2']);
 await f.control.stop();const reopened=await ControlService.open(f.file,{
  live:async()=>false,output:async()=>{},metadata:async()=>{},action:f.execute});
 expect((await reopened.execute(request('two-scenes',id,rev))).status).toBe('succeeded');
 expect(f.execute).toHaveBeenCalledTimes(2);await reopened.stop();
});
it('never dispatches a third step after an uncertain second step, including after process restart',async()=>{
 const f=await fixture();let n=0;
 f.execute.mockImplementation(async()=>{if(++n===2)throw new Error('lost OBS receipt')});
 const c=f.control.snapshot().configuration;c.actions.push({id:'third',label:'Third',type:'timer.add',value:'30',color:'green',shortcut:''});
 const macro=c.actions.find(x=>x.id==='two-scenes')!;macro.value='scene-live,scene-pause,third';
 await f.control.configure(c,c.revision);const rev=f.control.snapshot().configuration.revision;
 const id='uncertain_macro_1',q={...request('two-scenes',id,rev),expectedAction:macro};
 const result=await f.control.execute(q);
 expect(result.status).toBe('uncertain');expect(result.macroSteps?.map(s=>s.status))
  .toEqual(['succeeded','uncertain','pending']);expect(n).toBe(2);
 await f.control.stop();
 const reopened=await ControlService.open(f.file,{live:async()=>false,output:async()=>{},metadata:async()=>{},action:f.execute});
 expect((await reopened.execute(q)).status).toBe('uncertain');expect(n).toBe(2);await reopened.stop();
});
it('blocks later steps if actor rights disappear, preserving confirmed work and an uncertain receipt',async()=>{
 const f=await fixture(),rev=f.control.snapshot().configuration.revision;
 let granted=true;f.execute.mockImplementation(async()=>{granted=false});
 const r=await f.control.execute(request('two-scenes','permission_revoked',rev),async()=>{
  if(!granted)throw Object.assign(new Error('permission revoked'),{name:'CONTEXT_FORBIDDEN'});
 });
 expect(r.status).toBe('uncertain');expect(r.macroSteps?.map(s=>s.status))
  .toEqual(['succeeded','pending']);expect(f.execute).toHaveBeenCalledTimes(1);await f.control.stop();
});
it('refuses a stale revision and changed button before the first step',async()=>{
 const f=await fixture(),rev=f.control.snapshot().configuration.revision;
 expect((await f.control.execute(request('two-scenes','stale_config_1',rev-1))).status).toBe('failed');
 expect(f.execute).not.toHaveBeenCalled();
 const config=f.control.snapshot().configuration,action=config.actions.find(x=>x.id==='two-scenes')!;
 action.value='scene-pause,scene-live';await f.control.configure(config,rev);
 const old=await f.control.execute(request('two-scenes','modified_binding',rev+1));
 expect(old.status).toBe('failed');expect(f.execute).not.toHaveBeenCalled();await f.control.stop();
});
it('exposes manual macro in the selected master bank but not as a public live command',()=>{
 const configuration=defaultControlData().configuration;configuration.actions.push(macro());
 const context=masterContextConfig(configuration,{live:'Live'},null);
 expect(context.actions.find(a=>a.id==='two-scenes')?.capabilities).toEqual(['obs']);
 expect(context.banks.find(b=>b.id==='live')?.actionIds).toContain('two-scenes');
});
it('real paired HTTP + sole OBS bus: button executes timer then scene exactly once with an observed receipt',async()=>withContextFixture(async f=>{
 const c=f.control.snapshot().configuration;
 c.actions.push({id:'seq-obs',label:'Pause avec minute',type:'macro.sequence',
   value:'timer,scene-pause',color:'purple',shortcut:''});
 await f.control.configure(c,c.revision);
 const before=await f.read();expect(before.body.presentation.actions.some((a:any)=>a.id==='seq-obs')).toBe(true);
 const id=randomUUID(),r=await fetch(f.origin+'/api/v2/actions',{
  method:'POST',headers:{'content-type':'application/json',authorization:'Device '+f.paired.credential},
  body:JSON.stringify({id,confirmed:true,issuedAt:new Date().toISOString(),action:'seq-obs',
   expectedAction:c.actions.at(-1),expectedRevision:c.revision+1,expectedContextToken:before.body.proof}),
 });
 const body=await r.json();expect(r.status).toBe(200);
 expect(body.status).toBe('succeeded');expect(body.macroSteps).toHaveLength(2);
 expect(f.domain.timer.remaining).toBe(360);expect(f.obs.state.scene).toBe('Pause');
 const replay=await fetch(f.origin+'/api/v2/actions',{method:'POST',headers:{'content-type':'application/json',authorization:'Device '+f.paired.credential},
  body:JSON.stringify({id,confirmed:true,issuedAt:new Date().toISOString(),action:'seq-obs',expectedAction:c.actions.at(-1),expectedRevision:c.revision+1,expectedContextToken:before.body.proof})});
 expect((await replay.json()).status).toBe('succeeded');
 expect(f.rpc.filter((x:any)=>x.type==='SetCurrentProgramScene')).toHaveLength(1);
}));
it('blocks later queued macro steps when the host shuts down, without repeating the first effect',async()=>{
 const f=await fixture(),rev=f.control.snapshot().configuration.revision;let release!:()=>void;
 const hold=new Promise<void>(resolve=>{release=resolve});let entered!:()=>void;
 const started=new Promise<void>(resolve=>{entered=resolve});
 f.execute.mockImplementation(async()=>{entered();await hold});
 const running=f.control.execute(request('two-scenes','shutdown_macro',rev));
 await started;const stopping=f.control.stop();release();const result=await running;await stopping;
 expect(result.status).toBe('uncertain');
 expect(result.macroSteps?.map(s=>s.status)).toEqual(['succeeded','pending']);
 expect(f.execute).toHaveBeenCalledTimes(1);
});
it('recovers an in-flight macro receipt as uncertain after simulated host process death',async()=>{
 const f=await fixture();const disk=JSON.parse(await readFile(f.file,'utf8'));
 disk.receipts=[{id:'crashed_macro',action:'two-scenes',fingerprint:'sha',status:'running',
  message:'executing',createdAt:new Date().toISOString(),macroSteps:[
  {id:'scene-live',type:'mode.set',status:'succeeded'},
  {id:'scene-pause',type:'mode.set',status:'running'}]}];
 const {writeFile}=await import('node:fs/promises');
 await f.control.stop();await writeFile(f.file,JSON.stringify(disk));
 const reopened=await ControlService.open(f.file,{live:async()=>false,output:async()=>{},metadata:async()=>{},action:f.execute});
 expect(reopened.snapshot().receipts[0]).toMatchObject({status:'uncertain',macroSteps:[
  {status:'succeeded'},{status:'uncertain'}]});
 expect(f.execute).not.toHaveBeenCalled();await reopened.stop();
});

it('requires explicit sequence confirmation before any step',async()=>{
 const f=await fixture(),q={...request('two-scenes','not_confirmed',f.control.snapshot().configuration.revision),confirmed:false};
 expect((await f.control.execute(q)).status).toBe('failed');expect(f.execute).not.toHaveBeenCalled();await f.control.stop();
});
it.each([false,true])('real paired context follows its own acknowledged scene, but refuses an unrelated context change (changed=%s)',async changed=>withContextFixture(async f=>{
 const c=f.control.snapshot().configuration;
 const macro:DeckAction={id:'pause-then-timer',label:'Pause puis minuteur',type:'macro.sequence',value:'scene-pause,timer',color:'purple',shortcut:''};
 c.actions.push(macro);await f.control.configure(c,c.revision);
 const initial=await f.read(),remaining=f.domain.timer.remaining;
 if(changed){const original=f.bus.execute.bind(f.bus);vi.spyOn(f.bus,'execute').mockImplementation(async(...args:any[])=>{
  const result=await original(...args);if(args[0]?.type==='obs.scene')f.setGame('Changed outside sequence');return result;
 })}
 const response=await fetch(f.origin+'/api/v2/actions',{method:'POST',headers:{'content-type':'application/json',authorization:'Device '+f.paired.credential},body:JSON.stringify({
  id:randomUUID(),issuedAt:new Date().toISOString(),action:macro.id,expectedAction:macro,expectedRevision:c.revision+1,confirmed:true,expectedContextToken:initial.body.proof,
 })});
 const result=await response.json();expect(response.status).toBe(200);expect(result.status).toBe(changed?'uncertain':'succeeded');
 expect(f.obs.state.scene).toBe('Pause');expect(f.domain.timer.remaining).toBe(remaining+(changed?0:60));
 expect(result.macroSteps.map((s:any)=>s.status)).toEqual(['succeeded',changed?'pending':'succeeded']);
 // The old shared preview token is NOT silently reauthorized for the new scene.
 const other=await f.action('timer',initial.body.proof);expect(other.body.status).not.toBe('succeeded');
 expect(f.domain.timer.remaining).toBe(remaining+(changed?0:60));
}));
it('refuses a stale native keyboard binding to a macro despite supplied confirmation',async()=>withContextFixture(async f=>{
 const c=f.control.snapshot().configuration,macro:DeckAction={id:'seq-key',label:'Sequence',type:'macro.sequence',value:'timer,scene-pause',color:'purple',shortcut:''};
 c.actions.push(macro);await f.control.configure(c,c.revision);
 const result=await fetch(f.origin+'/api/v2/actions',{method:'POST',headers:{'content-type':'application/json',authorization:'Device '+f.paired.credential},body:JSON.stringify({
  id:randomUUID(),issuedAt:new Date().toISOString(),action:macro.id,expectedRevision:c.revision+1,expectedAction:macro,confirmed:true,trigger:'keyboard',
 })});expect(result.status).toBe(409);expect(f.rpc.filter((r:any)=>r.type.startsWith('Set'))).toEqual([]);
}));
