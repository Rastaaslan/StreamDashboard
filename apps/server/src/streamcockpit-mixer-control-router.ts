import {createHash,randomUUID} from 'node:crypto';
import {Router,type Request} from 'express';
import {validObsAudioTracks,validObsAudioMonitor,type ObsAudioChange,type ObsAudioSource} from '../../../integrations/obs/src/client.js';
import {isObsRequestRejection} from '../../../integrations/obs/src/output-result.js';
import {audioReceiptId,validateAudioChange,sameAudioSource,audioChangeObserved,reverseAudioChange,type AudioReceipt as Receipt,type AudioReceiptJournal,type AudioReceiptRecord} from './streamcockpit-audio-receipts.js';

class MixerFault extends Error { constructor(readonly code:string,readonly status=409){super(code)} }
const exact=(value:unknown,keys:string[])=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const same=sameAudioSource;
const owner=(actor:string)=>'mixer:'+createHash('sha256').update(actor).digest('hex')+':';
function change(value:unknown):ObsAudioChange {
 try{validateAudioChange(value as ObsAudioChange);return structuredClone(value as ObsAudioChange)}
 catch{throw new MixerFault('INVALID',400)}
}
type Context={actor:string;host:string;authority:string};
type Plan=Context&{before:ObsAudioSource;change:ObsAudioChange;expiresAt:number};
/** One consent/readback path for gain, mute and observed OBS source routing.
 * Track flags do not prove the Twitch VOD output mapping or physical audibility. */
export function createMixerControlRouter(options:{
 actor(request:Request):Promise<string>|string;host():Promise<string|undefined>|string|undefined;
 read(sourceId:string,routing?:boolean):Promise<ObsAudioSource>;write(before:ObsAudioSource,change:ObsAudioChange):Promise<void>;
 serialize<T>(operation:(assertCurrent:()=>void)=>Promise<T>):Promise<T>;
 reserve(id:string,fingerprint:string):Promise<void>;reservation(id:string):string|undefined;now?:()=>number;
 /** Stable authenticated FIXE identity, distinct from the transient OBS connection. */
 authority?():Promise<string|undefined>|string|undefined;journal?:AudioReceiptJournal;
}){
 const router=Router(),plans=new Map<string,Plan>(),receipts=new Map<string,{context:Context;value:Receipt;expiresAt:number}>();
 const flights=new Map<string,{context:Context;operation:Promise<Receipt>}>(),now=options.now??Date.now,runtime=randomUUID();
 const archived=(id:string,context:Context)=>{
  const record=options.journal?.read(id,context.actor,context.authority);
  if(record?.context.runtime===runtime&&record.context.host!==context.host)throw new MixerFault('AUTHORITY_CHANGED');
  return record;
 };
 const archivedValue=(record:AudioReceiptRecord):Receipt=>record.receipt??{schemaVersion:1,kind:'streamcockpit-mixer-receipt',
  confirmationId:record.id,status:'uncertain',change:record.change,rollbackAvailable:false};
 const reconcileCached=(id:string,context:Context,value:Receipt):Receipt=>{
  // A lost local COMMIT acknowledgement can be resolved by verified read-only
  // evidence, never by repeating OBS or completing an uncertain intent.
  if(value.status!=='uncertain'||!options.journal)return value;
  const stored=archived(id,context);return stored?.receipt??value;
 };
 const actorOnly=async(request:Request,expected?:string)=>{
  const actor=await options.actor(request);
  if(!actor||expected&&actor!==expected)throw new MixerFault('FORBIDDEN',403);
  return actor;
 };
 const check=async(request:Request,expected?:Context)=>{
  const actor=await actorOnly(request,expected?.actor);
  const host=await options.host();
  const authority=options.authority?await options.authority():host;
  if(!host||!authority||expected&&(actor!==expected.actor||host!==expected.host||authority!==expected.authority))throw new MixerFault('AUTHORITY_CHANGED');
  return {actor,host,authority};
 };
 const read=async(sourceId:string,routing=false)=>{
  const s=await options.read(sourceId,routing),at=now();
  if(!s||s.sourceId!==sourceId||typeof s.inputUuid!=='string'||!s.inputUuid||!Number.isSafeInteger(s.generation)||s.generation<0||!Number.isFinite(s.gain)||s.gain<0||s.gain>20||typeof s.mute!=='boolean'||!Number.isFinite(s.observedAt)||s.observedAt>at||at-s.observedAt>5000)throw new MixerFault('NOT_OBSERVED');
  if(routing&&(!validObsAudioTracks(s.tracks)||!validObsAudioMonitor(s.monitorType)))throw new MixerFault('NOT_OBSERVED');
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
    if(receipt.context.host!==context.host||receipt.context.authority!==context.authority)throw new MixerFault('AUTHORITY_CHANGED');
    await check(req,context);res.json(reconcileCached(id,context,receipt.value));return;
   }
   if(flight?.context.actor===context.actor){
    if(flight.context.host!==context.host||flight.context.authority!==context.authority)throw new MixerFault('AUTHORITY_CHANGED');
    await check(req,context);res.json({schemaVersion:1,kind:'streamcockpit-mixer-status',confirmationId:id,status:'running'});return;
   }
   const durable=archived(id,context);
   if(durable){await check(req,context);res.json(archivedValue(durable));return}
   const reservation=options.reservation(id);
   if(!reservation?.startsWith(owner(context.actor)))throw new MixerFault('NOT_FOUND',404);
   await check(req,context);res.json({schemaVersion:1,kind:'streamcockpit-mixer-status',confirmationId:id,status:'uncertain',rollbackAvailable:false});
  }catch(error){const e=error instanceof MixerFault?error:new MixerFault('UNAVAILABLE',503);res.status(e.status).json({error:{code:'MIXER_'+e.code,retryable:false}})}
 });
 router.get('/history',async(req,res)=>{
  try{
   const context=await check(req),raw=req.query.before;
   if(raw!==undefined&&(typeof raw!=='string'||!/^\d{1,16}$/.test(raw)))throw new MixerFault('INVALID',400);
   const before=raw===undefined?undefined:Number(raw);
   if(before!==undefined&&(!Number.isSafeInteger(before)||before<1))throw new MixerFault('INVALID',400);
   if(!options.journal)throw new MixerFault('HISTORY_UNAVAILABLE',503);
   const rows=options.journal.history(context.actor,context.authority,before);
   await check(req,context);
   res.json({schemaVersion:1,kind:'streamcockpit-mixer-history',readOnly:true,
    entries:rows.map(({sequence,record})=>({sequence,recordedAt:record.createdAt,receipt:archivedValue(record)})),
    nextBefore:rows.length===100?rows.at(-1)!.sequence:null});
  }catch(error){const e=error instanceof MixerFault?error:new MixerFault('UNAVAILABLE',503);res.status(e.status).json({error:{code:'MIXER_'+e.code,retryable:false}})}
 });
 for(const op of ['preview','confirm']as const)router.all('/'+op,async(req,res)=>{
  if(req.method!=='POST'){res.set('Allow','POST').status(405).json({error:{code:'METHOD_NOT_ALLOWED'}});return}
  try{
   const context=await check(req);purge();
   if(op==='preview'){
    let requested:ObsAudioChange,before:ObsAudioSource;
    if(exact(req.body,['change'])){requested=change(req.body.change);before=await read(requested.sourceId,'tracks'in requested||'monitorType'in requested)}
    else if(exact(req.body,['rollbackReceiptId'])&&typeof req.body.rollbackReceiptId==='string'){
     const cached=receipts.get(req.body.rollbackReceiptId),saved=cached?undefined:archived(req.body.rollbackReceiptId,context);
     const prior=cached?.value??saved?.receipt;
     if(cached&&(cached.context.actor!==context.actor||cached.context.host!==context.host||cached.context.authority!==context.authority))throw new MixerFault('ROLLBACK_UNAVAILABLE');
     if(!prior?.rollbackAvailable||!prior.before||!prior.after)throw new MixerFault('ROLLBACK_UNAVAILABLE');
     before=await read(prior.change.sourceId,'tracks'in prior.change||'monitorType'in prior.change);
     // Cross-runtime history is not continuity of OBS generation. A NEW preview
     // requires the same UUID and current gain/mute, then binds the new generation.
     const observed=saved&&saved.context.runtime!==runtime?{...prior.after,generation:before.generation}:prior.after;
     if(!same(before,observed))throw new MixerFault('REVISION_CONFLICT');
     requested=reverseAudioChange(prior.before,prior.change);
    }else throw new MixerFault('INVALID',400);
    await check(req,context);
    if(plans.size>=100)throw new MixerFault('BUSY',503);
    const confirmationId=randomUUID(),expiresAt=now()+45_000;
    plans.set(confirmationId,{...context,before,change:requested,expiresAt});
    res.json({schemaVersion:1,kind:'streamcockpit-mixer-preview',confirmationId,expiresAt,change:requested,before});return;
   }
   if(!exact(req.body,['confirmationId','confirmed'])||!audioReceiptId(req.body.confirmationId)||req.body.confirmed!==true)throw new MixerFault('INVALID',400);
   const id=req.body.confirmationId,previous=receipts.get(id),flight=flights.get(id);
   if(previous?.context.actor===context.actor){
    if(previous.context.host!==context.host||previous.context.authority!==context.authority)throw new MixerFault('AUTHORITY_CHANGED');
    await check(req,context);res.json(reconcileCached(id,context,previous.value));return;
   }
   if(flight?.context.actor===context.actor){
    if(flight.context.host!==context.host||flight.context.authority!==context.authority)throw new MixerFault('AUTHORITY_CHANGED');
    const value=await flight.operation;await check(req,context);res.json(value);return;
   }
   const durable=archived(id,context);
   if(durable){await check(req,context);res.json(archivedValue(durable));return}
   const plan=plans.get(id);
   if(!plan||plan.actor!==context.actor||plan.host!==context.host||plan.authority!==context.authority||plan.expiresAt<=now())throw new MixerFault('CONSENT_EXPIRED');
   if(flights.size>=20)throw new MixerFault('BUSY',503);
   plans.delete(id);
   const operation=options.serialize(async assertCurrent=>{
    const perform=async():Promise<Receipt>=>{
    let sent=false;
    try{
     await check(req,context);assertCurrent();
     if(plan.expiresAt<=now())throw new MixerFault('CONSENT_EXPIRED');
     const routing='tracks'in plan.change||'monitorType'in plan.change;
     let current=await read(plan.change.sourceId,routing);assertCurrent();
     if(!same(current,plan.before))throw new MixerFault('REVISION_CONFLICT');
     await options.reserve(id,owner(context.actor)+createHash('sha256').update(JSON.stringify(plan)).digest('hex'));
     if(options.journal&&!options.journal.reserve(id,{...context,runtime},plan.change))throw new MixerFault('CONSENT_EXPIRED');
     await check(req,context);assertCurrent();
     current=await read(plan.change.sourceId,routing);assertCurrent();
     if(!same(current,plan.before))throw new MixerFault('REVISION_CONFLICT');
     await check(req,context);assertCurrent();
     const unchanged=audioChangeObserved(current,current,plan.change);
     if(!unchanged){sent=true;await options.write(current,plan.change);assertCurrent()}
     const after=await read(plan.change.sourceId,routing);assertCurrent();await check(req,context);assertCurrent();
     if(!audioChangeObserved(current,after,plan.change))throw new MixerFault('READBACK_MISMATCH');
     return {schemaVersion:1 as const,kind:'streamcockpit-mixer-receipt' as const,confirmationId:id,status:unchanged?'unchanged' as const:'confirmed' as const,change:plan.change,before:current,after,rollbackAvailable:!unchanged};
    }catch(error){
     if(!sent)throw error;
     return {schemaVersion:1 as const,kind:'streamcockpit-mixer-receipt' as const,confirmationId:id,status:isObsRequestRejection(error)?'rejected' as const:'uncertain' as const,change:plan.change,rollbackAvailable:false};
    }
    };
    const result=await perform();
    try{options.journal?.complete(id,{...context,runtime},result);return result}
    catch{return {schemaVersion:1,kind:'streamcockpit-mixer-receipt',confirmationId:id,status:'uncertain',change:plan.change,rollbackAvailable:false} as Receipt}
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
