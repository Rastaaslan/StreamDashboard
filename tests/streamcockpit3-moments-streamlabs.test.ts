import {it,expect,vi} from 'vitest';
import {StreamlabsMomentProducer} from '../apps/server/src/streamcockpit-moments-streamlabs.js';
import {MomentsPipeline} from '../apps/server/src/streamcockpit-moments.js';
import {normalizeStreamlabsEvents} from '../integrations/streamlabs/src/events.js';
const now=Date.parse('2026-11-03T15:00:00Z');
const packet=(id='one',overrides={})=>({for:'twitch_account',type:'subscription',message:[{_id:id,name:'Private viewer',message:'oauth:PRIVATE',amount:100,currency:'EUR',...overrides}]});
function fixture(){
 let raw:string|null=null,clock=now,host:string|undefined='FIXE',session:string|undefined='live_1';
 const state={connected:true,streamingKnown:true,streaming:true,connectionGeneration:1,streamEpoch:2,providerGeneration:3,providerConnected:true};
 const pipeline=new MomentsPipeline({read:async()=>raw,compareAndSwap:async(expected,replacement)=>{if(raw!==expected)return false;raw=replacement;return true}});
 const record=vi.fn(input=>pipeline.recordStreamlabsObservation(input)),getHost=vi.fn(async()=>host),active=vi.fn(async()=>session);
 const make=()=>new StreamlabsMomentProducer({snapshot:()=>({...state}),host:getHost,activeSessionId:active,record,now:()=>clock});
 const producer=make();producer.observeState();
 return{producer,make,pipeline,state,record,getHost,active,events:(value=packet())=>normalizeStreamlabsEvents(value,new Date(clock)),
  clock:(value:number)=>{clock=value},host:(value:string|undefined)=>{host=value},session:(value:string|undefined)=>{session=value}};
}
it('F09 Streamlabs stores one host receipt with fixed labels and no private provider payload',async()=>{
 const f=fixture();await f.producer.observe(f.events());await f.producer.observe(f.events());
 const output=await f.pipeline.exportObserved('live_1');
 expect(output?.markers).toHaveLength(1);expect(output?.markers[0]).toMatchObject({source:'streamlabs',status:'observed',instant:now,title:'Abonnement Twitch reçu'});
 expect(f.record).toHaveBeenCalledTimes(1);expect(JSON.stringify(output)).not.toMatch(/Private viewer|PRIVATE|amount|currency|message/);
});
it('F09 provider duplicate after restart keeps original session and receipt instant',async()=>{
 const f=fixture();await f.producer.observe(f.events());const original=await f.pipeline.exportObserved('live_1');
 f.clock(now+60_000);f.session('live_2');const restarted=f.make();restarted.observeState();
 await restarted.observe(f.events());
 expect(await f.pipeline.exportObserved('live_1')).toEqual(original);
 expect(await f.pipeline.exportObserved('live_2')).toBeUndefined();
 expect((await f.pipeline.listObservedSessions())?.map(s=>s.sessionId)).toEqual(['live_1']);
});
it('F09 excludes test, YouTube, control, unknown type, stale occurrence and untrusted timestamps',async()=>{
 const f=fixture();
 const inputs=[{...packet(),isTest:true},{...packet(),for:'youtube_account'},{...packet(),type:'rollendcredits'},{...packet(),type:'unknown-future'},
  packet('old',{created_at:new Date(now-60_000).toISOString()}),packet('future',{created_at:new Date(now+60_000).toISOString()})];
 for(const input of inputs)await f.producer.observe(f.events(input));
 await f.producer.observe([{...f.events()[0],receivedAt:'invalid'}]);
 await f.producer.observe([{...f.events()[0],receivedAt:new Date(now-20_000).toISOString()}]);
 await f.producer.observe([{...f.events()[0],receivedAt:new Date(now+1).toISOString()}]);
 expect(f.record).not.toHaveBeenCalled();
});
it.each(['connected','streamingKnown','streaming','providerConnected']as const)('F09 denies unavailable %s',async field=>{
 const f=fixture();f.state[field]=false;await f.producer.observe(f.events());expect(f.record).not.toHaveBeenCalled();
});
it('F09 refuses missing FIXE host, unbound session or absent OBS witness',async()=>{
 const f=fixture();f.host(undefined);await f.producer.observe(f.events());
 const g=fixture();g.session(undefined);await g.producer.observe(g.events());
 const h=fixture();h.state.streaming=false;h.producer.observeState();h.state.streaming=true;await h.producer.observe(h.events());
 expect(f.record).not.toHaveBeenCalled();expect(g.record).not.toHaveBeenCalled();expect(h.record).not.toHaveBeenCalled();
});
it.each(['connectionGeneration','streamEpoch','providerGeneration']as const)('F09 fences %s changed during host authorization',async field=>{
 const f=fixture();f.getHost.mockImplementationOnce(async()=>{f.state[field]++;return 'FIXE'});
 await f.producer.observe(f.events());expect(f.record).not.toHaveBeenCalled();
});
it('F09 rechecks host and session after awaited authorization',async()=>{
 const f=fixture();f.getHost.mockResolvedValueOnce('FIXE').mockResolvedValueOnce('OTHER');
 await f.producer.observe(f.events());expect(f.record).not.toHaveBeenCalled();
 const g=fixture();g.active.mockResolvedValueOnce('live_1').mockResolvedValueOnce('live_2');
 await g.producer.observe(g.events());expect(g.record).not.toHaveBeenCalled();
});
it('F09 never automatically retries an uncertain disk commit even on a duplicate event',async()=>{
 const f=fixture();f.record.mockRejectedValueOnce(Error('MOMENTS_WRITE_UNCERTAIN'));
 await expect(f.producer.observe(f.events())).rejects.toThrow('MOMENTS_WRITE_UNCERTAIN');
 await f.producer.observe(f.events());expect(f.record).toHaveBeenCalledTimes(1);
});
it('F09 shutdown drains an already accepted write and never starts a second one',async()=>{
 const f=fixture();let finish!:()=>void;
 f.record.mockImplementationOnce(()=>new Promise(resolve=>{finish=()=>resolve({}as never)}));
 const work=f.producer.observe(f.events());await vi.waitFor(()=>expect(f.record).toHaveBeenCalledTimes(1));
 let stopped=false;const stopping=f.producer.stop().then(()=>{stopped=true});
 await Promise.resolve();expect(stopped).toBe(false);
 await f.producer.observe(f.events(packet('second')));expect(f.record).toHaveBeenCalledTimes(1);
 finish();await work;await stopping;expect(stopped).toBe(true);
});

it('F09 final host check rejects a role switch immediately before persistence',async()=>{
 const f=fixture();f.getHost.mockResolvedValueOnce('FIXE').mockResolvedValueOnce('FIXE').mockResolvedValueOnce('OTHER');
 await f.producer.observe(f.events());expect(f.record).not.toHaveBeenCalled();
});
it('F09 journal reconciles a committed but unacknowledged event only on explicit later observation',async()=>{
 let raw:string|null=null,fail=true;
 const pipeline=new MomentsPipeline({read:async()=>raw,compareAndSwap:async(expected,replacement)=>{
  if(raw!==expected)return false;raw=replacement;if(fail){fail=false;throw Error('MOMENTS_WRITE_UNCERTAIN')}return true;
 }});
 const input={sessionId:'live_1',instant:now,sourceEventId:'sl_first',correlationId:'sl_first',title:'Don Streamlabs reçu'};
 await expect(pipeline.recordStreamlabsObservation(input)).rejects.toThrow('MOMENTS_WRITE_UNCERTAIN');
 const original=await pipeline.exportObserved('live_1');expect(original?.markers).toHaveLength(1);
 const result=await pipeline.recordStreamlabsObservation({...input,sessionId:'live_2',instant:now+60_000});
 expect(result.outcome).toBe('replayed');expect(result.moment).toEqual(original!.markers[0]);
 expect(await pipeline.exportObserved('live_2')).toBeUndefined();
 await expect(pipeline.recordStreamlabsObservation({...input,title:'Autre type'})).rejects.toThrow('MOMENT_EVENT_CONFLICT');
});
