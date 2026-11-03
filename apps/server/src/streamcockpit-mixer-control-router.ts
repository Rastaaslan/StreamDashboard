import {createHash,randomUUID} from 'node:crypto';
import {Router,type Request} from 'express';
import type {ObsAudioChange,ObsAudioSource} from '../../../integrations/obs/src/client.js';
import {isObsRequestRejection} from '../../../integrations/obs/src/output-result.js';

class MixerFault extends Error { constructor(readonly code:string,readonly status=409){super(code)} }
const exact=(value:unknown,keys:string[])=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const same=(a:ObsAudioSource,b:ObsAudioSource)=>a.sourceId===b.sourceId&&a.inputUuid===b.inputUuid&&a.generation===b.generation&&a.gain===b.gain&&a.mute===b.mute;
const owner=(actor:string)=>'mixer:'+createHash('sha256').update(actor).digest('hex')+':';
function change(value:unknown):ObsAudioChange {
 const c=value as Record<string,unknown>;
 if(!c||typeof c.sourceId!=='string'||!c.sourceId.trim()||c.sourceId.length>200)throw new MixerFault('INVALID',400);
 if(exact(c,['sourceId','gain'])&&typeof c.gain==='number'&&Number.isFinite(c.gain)&&c.gain>=0&&c.gain<=20)return {sourceId:c.sourceId,gain:c.gain};
 if(exact(c,['sourceId','mute'])&&typeof c.mute==='boolean')return {sourceId:c.sourceId,mute:c.mute};
 throw new MixerFault('INVALID',400);
}
type Context={actor:string;host:string};
type Plan=Context&{before:ObsAudioSource;change:ObsAudioChange;expiresAt:number};
type Receipt={schemaVersion:1;kind:'streamcockpit-mixer-receipt';confirmationId:string;status:'confirmed'|'unchanged'|'uncertain'|'rejected';change:ObsAudioChange;before?:ObsAudioSource;after?:ObsAudioSource;rollbackAvailable:boolean};
/** A narrow gain/mute command path. Routing/meters/device presence stay separate evidence. */
export function createMixerControlRouter(options:{
 actor(request:Request):Promise<string>|string;host():Promise<string|undefined>|string|undefined;
 read(sourceId:string):Promise<ObsAudioSource>;write(before:ObsAudioSource,change:ObsAudioChange):Promise<void>;
 serialize<T>(operation:(assertCurrent:()=>void)=>Promise<T>):Promise<T>;
 reserve(id:string,fingerprint:string):Promise<void>;reservation(id:string):string|undefined;now?:()=>number;
}){
 const router=Router(),plans=new Map<string,Plan>(),receipts=new Map<string,{context:Context;value:Receipt;expiresAt:number}>();
 const flights=new Map<string,{context:Context;operation:Promise<Receipt>}>(),now=options.now??Date.now;
 const actorOnly=async(request:Request,expected?:string)=>{
  const actor=await options.actor(request);
  if(!actor||expected&&actor!==expected)throw new MixerFault('FORBIDDEN',403);
  return actor;
 };
 const check=async(request:Request,expected?:Context)=>{
  const actor=await actorOnly(request,expected?.actor);
  const host=await options.host();
  if(!host||expected&&(actor!==expected.actor||host!==expected.host))throw new MixerFault('AUTHORITY_CHANGED');
  return {actor,host};
 };
 const read=async(sourceId:string)=>{
  const s=await options.read(sourceId),at=now();
  if(!s||s.sourceId!==sourceId||typeof s.inputUuid!=='string'||!s.inputUuid||!Number.isSafeInteger(s.generation)||s.generation<0||!Number.isFinite(s.gain)||s.gain<0||s.gain>20||typeof s.mute!=='boolean'||!Number.isFinite(s.observedAt)||s.observedAt>at||at-s.observedAt>5000)throw new MixerFault('NOT_OBSERVED');
  return structuredClone(s);
 };
 const purge=()=>{for(const[id,p]of plans)if(p.expiresAt<=now())plans.delete(id);for(const[id,r]of receipts)if(r.expiresAt<=now())receipts.delete(id)};
 router.use((_q,r,next)=>{r.set('Cache-Control','private, no-store');next()});
 router.get('/status/:id',async(req,res)=>{
  try{
   const context=await check(req),id=String(req.params.id);
   if(!/^[0-9a-f-]{36}$/i.test(id))throw new MixerFault('INVALID',400);
   const receipt=receipts.get(id),flight=flights.get(id);
   if(receipt?.context.actor===context.actor){
    if(receipt.context.host!==context.host)throw new MixerFault('AUTHORITY_CHANGED');
    await check(req,context);res.json(receipt.value);return;
   }
   if(flight?.context.actor===context.actor){
    if(flight.context.host!==context.host)throw new MixerFault('AUTHORITY_CHANGED');
    await check(req,context);res.json({schemaVersion:1,kind:'streamcockpit-mixer-status',confirmationId:id,status:'running'});return;
   }
   const reservation=options.reservation(id);
   if(!reservation?.startsWith(owner(context.actor)))throw new MixerFault('NOT_FOUND',404);
   await check(req,context);res.json({schemaVersion:1,kind:'streamcockpit-mixer-status',confirmationId:id,status:'uncertain',rollbackAvailable:false});
  }catch(error){const e=error instanceof MixerFault?error:new MixerFault('UNAVAILABLE',503);res.status(e.status).json({error:{code:'MIXER_'+e.code,retryable:false}})}
 });
 for(const op of ['preview','confirm']as const)router.all('/'+op,async(req,res)=>{
  if(req.method!=='POST'){res.set('Allow','POST').status(405).json({error:{code:'METHOD_NOT_ALLOWED'}});return}
  try{
   const context=await check(req);purge();
   if(op==='preview'){
    let requested:ObsAudioChange,before:ObsAudioSource;
    if(exact(req.body,['change'])){requested=change(req.body.change);before=await read(requested.sourceId)}
    else if(exact(req.body,['rollbackReceiptId'])&&typeof req.body.rollbackReceiptId==='string'){
     const prior=receipts.get(req.body.rollbackReceiptId);
     if(!prior||prior.context.actor!==context.actor||prior.context.host!==context.host||!prior.value.rollbackAvailable||!prior.value.before||!prior.value.after)throw new MixerFault('ROLLBACK_UNAVAILABLE');
     before=await read(prior.value.change.sourceId);
     if(!same(before,prior.value.after))throw new MixerFault('REVISION_CONFLICT');
     requested='gain'in prior.value.change?{sourceId:before.sourceId,gain:prior.value.before.gain}:{sourceId:before.sourceId,mute:prior.value.before.mute};
    }else throw new MixerFault('INVALID',400);
    await check(req,context);
    if(plans.size>=100)throw new MixerFault('BUSY',503);
    const confirmationId=randomUUID(),expiresAt=now()+45_000;
    plans.set(confirmationId,{...context,before,change:requested,expiresAt});
    res.json({schemaVersion:1,kind:'streamcockpit-mixer-preview',confirmationId,expiresAt,change:requested,before});return;
   }
   if(!exact(req.body,['confirmationId','confirmed'])||typeof req.body.confirmationId!=='string'||req.body.confirmed!==true)throw new MixerFault('INVALID',400);
   const id=req.body.confirmationId,previous=receipts.get(id),flight=flights.get(id);
   if(previous?.context.actor===context.actor){
    if(previous.context.host!==context.host)throw new MixerFault('AUTHORITY_CHANGED');
    await check(req,context);res.json(previous.value);return;
   }
   if(flight?.context.actor===context.actor){
    if(flight.context.host!==context.host)throw new MixerFault('AUTHORITY_CHANGED');
    const value=await flight.operation;await check(req,context);res.json(value);return;
   }
   const plan=plans.get(id);
   if(!plan||plan.actor!==context.actor||plan.host!==context.host||plan.expiresAt<=now())throw new MixerFault('CONSENT_EXPIRED');
   if(flights.size>=20)throw new MixerFault('BUSY',503);
   plans.delete(id);
   const operation=options.serialize(async assertCurrent=>{
    let sent=false;
    try{
     await check(req,context);assertCurrent();
     if(plan.expiresAt<=now())throw new MixerFault('CONSENT_EXPIRED');
     let current=await read(plan.change.sourceId);assertCurrent();
     if(!same(current,plan.before))throw new MixerFault('REVISION_CONFLICT');
     await options.reserve(id,owner(context.actor)+createHash('sha256').update(JSON.stringify(plan)).digest('hex'));
     await check(req,context);assertCurrent();
     current=await read(plan.change.sourceId);assertCurrent();
     if(!same(current,plan.before))throw new MixerFault('REVISION_CONFLICT');
     await check(req,context);assertCurrent();
     const unchanged='gain'in plan.change?current.gain===plan.change.gain:current.mute===plan.change.mute;
     if(!unchanged){sent=true;await options.write(current,plan.change);assertCurrent()}
     const after=await read(plan.change.sourceId);assertCurrent();await check(req,context);assertCurrent();
     if(after.inputUuid!==current.inputUuid||after.generation!==current.generation||
       ('gain'in plan.change?(Math.abs(after.gain-plan.change.gain)>0.000001||after.mute!==current.mute):(after.mute!==plan.change.mute||after.gain!==current.gain)))throw new MixerFault('READBACK_MISMATCH');
     return {schemaVersion:1 as const,kind:'streamcockpit-mixer-receipt' as const,confirmationId:id,status:unchanged?'unchanged' as const:'confirmed' as const,change:plan.change,before:current,after,rollbackAvailable:!unchanged};
    }catch(error){
     if(!sent)throw error;
     return {schemaVersion:1 as const,kind:'streamcockpit-mixer-receipt' as const,confirmationId:id,status:isObsRequestRejection(error)?'rejected' as const:'uncertain' as const,change:plan.change,rollbackAvailable:false};
    }
   });
   flights.set(id,{context,operation});
   try{
    const value=await operation;
    if(receipts.size>=500)receipts.delete(receipts.keys().next().value!);
    receipts.set(id,{context,value,expiresAt:now()+600_000});
    await actorOnly(req,context.actor);res.json(value);
   }finally{flights.delete(id)}
  }catch(error){const e=error instanceof MixerFault?error:new MixerFault('UNAVAILABLE',503);res.status(e.status).json({error:{code:'MIXER_'+e.code,retryable:false}})}
 });
 return router;
}
