import {createHash,randomUUID} from 'node:crypto';
import {Router,type Request} from 'express';
import {selectContextPresentation,type ContextConfig,type DeviceRole,type StreamState} from '../../../packages/core/src/streamcockpit-context.js';
import type {ControlConfiguration,DeckAction} from '../../../packages/contracts/src/control.js';
import {actionCapability,actionDefinition} from '../../mobile/shared/action-definition.js';
export interface MasterContextActor {id:string;role:'stream-pc'|'paired-controller';capabilities:string[]}
export interface MasterContextObservation {host:string;generation:number;epoch:number;observedAt:number;scene:string|null;game:string|null;streamState:StreamState|null}
class ContextFault extends Error {constructor(readonly status:number,readonly code:string){super(code==='CONTEXT_FORBIDDEN'||code==='CONTEXT_ACTION_FORBIDDEN'?'Action contextuelle non autorisée.':'Contexte maître expiré, modifié ou indisponible : actualisez le Deck.')} }
/** Fixed 3.0 banks reuse configured actions; no modular layout or inferred hardware role. */
export function masterContextConfig(configuration:ControlConfiguration,modes:Record<string,string|undefined>,game:string|null):ContextConfig{
 const definitions=configuration.actions.filter(a=>actionDefinition(a)&&!['live.start','live.stop'].includes(a.type));
 const actions=definitions.map(a=>({id:a.id,label:a.label,roles:['stream-pc','paired-controller']as DeviceRole[],capabilities:[actionCapability(a.type)]}));
 const bank=(id:string,label:string,types?:string[])=>({id,label,actionIds:definitions.filter(a=>!types||types.includes(a.type)).map(a=>a.id)});
 const banks=[bank('regie','Régie'),bank('live','Régie de jeu',['mic.toggle','scene.set','mode.set','replay.save','sound.play','sound.stop','alert.play','macro.sequence']),
  bank('discussion','Discussion',['mic.toggle','scene.set','mode.set','chat.send','wizebot.command','sound.play','sound.stop','macro.sequence']),
  bank('pause','Pause',['mic.toggle','scene.set','mode.set','timer.add','sound.play','sound.stop','macro.sequence']),
  bank('intro','Introduction',['mic.toggle','scene.set','mode.set','timer.add','sound.play','sound.stop','macro.sequence']),
  bank('end','Fin de session',['scene.set','mode.set','chat.send','wizebot.command','sound.stop'])];
 const rules:ContextConfig['rules']=[{id:'live',priority:10,bankId:'live',when:{streamState:'live'}}];
 for(const id of ['live','pause','intro','end','discussion'])if(modes[id])rules.push({id:'scene-'+id,priority:id==='live'?30:100,bankId:id,when:{scene:modes[id]}});
 if(game){banks.push(bank('game','Jeu · '+game,['mic.toggle','scene.set','mode.set','replay.save','sound.play','sound.stop','alert.play','macro.sequence']));rules.push({id:'game',priority:40,bankId:'game',when:{game,streamState:'live'}})}
 return {schemaVersion:1,platform:'twitch',actions,banks,rules,fallbackBankId:'regie'};
}
export function createMasterContext(options:{
 actor(request:Request):Promise<MasterContextActor|undefined>|MasterContextActor|undefined;
 source():Promise<MasterContextObservation|undefined>|MasterContextObservation|undefined;
 configuration():ControlConfiguration;modes():Record<string,string|undefined>;now?:()=>number;
}){
 const proofs=new Map<string,{actor:string;fingerprint:string;until:number}>(),now=options.now??Date.now;
 const view=async(req:Request)=>{
  const first=await options.actor(req);if(!first)throw new ContextFault(403,'CONTEXT_FORBIDDEN');
  const source=await options.source(),actor=await options.actor(req);
  if(!actor||actor.id!==first.id)throw new ContextFault(403,'CONTEXT_FORBIDDEN');
  const at=now(),configuration=options.configuration(),modes=options.modes();
  const usable=Boolean(source&&Number.isSafeInteger(source.generation)&&source.generation>=0&&Number.isSafeInteger(source.epoch)&&source.epoch>=0&&
   Number.isFinite(source.observedAt)&&source.observedAt<=at&&at-source.observedAt<15_000&&source.scene!==null&&source.streamState!==null);
  const snapshot={scene:usable?source!.scene:null,game:usable?source!.game:null,streamState:usable?source!.streamState:null,role:actor.role,capabilities:actor.capabilities,network:usable?'online' as const:'unknown' as const};
  const presentation=selectContextPresentation(masterContextConfig(configuration,modes,snapshot.game),snapshot);
  const fingerprint=createHash('sha256').update(JSON.stringify([actor.id,snapshot,configuration.revision,configuration.actions.map(actionDefinition),modes,source?.host,source?.generation,source?.epoch])).digest('hex');
  const stableFingerprint=createHash('sha256').update(JSON.stringify([actor.id,{...snapshot,scene:null},configuration.revision,configuration.actions.map(actionDefinition),modes,source?.host,source?.generation,source?.epoch])).digest('hex');
  return {actor,source,snapshot,presentation,fingerprint,stableFingerprint,usable,at};
 };
 return {
  async read(req:Request){
   const v=await view(req);for(const[id,p]of proofs)if(p.until<=v.at)proofs.delete(id);
   const validForMs=v.usable?Math.min(12_000,15_000-(v.at-v.source!.observedAt)):0;
   let proof:string|undefined;
   if(validForMs>0&&proofs.size<256){proof=randomUUID();proofs.set(proof,{actor:v.actor.id,fingerprint:v.fingerprint,until:v.at+validForMs})}
   return {schemaVersion:1,kind:'streamcockpit-master-context',status:proof?'known':'unknown',authority:'FIXE',role:v.actor.role,
    scene:v.snapshot.scene,game:v.snapshot.game,streamState:v.snapshot.streamState,observedAt:v.source?.observedAt??null,
    presentation:v.presentation,validForMs:proof?validForMs:0,...(proof?{proof}:{})};
  },
  /** Private per-request continuation. Only a server-observed completed scene
   * step advances its expected scene. Shared preview proofs are NEVER rewritten. */
  sequence(req:Request,proof:unknown,action:string){
   let admitted:Awaited<ReturnType<typeof view>>|undefined,expectedScene:string|null=null,until=0;
   return async(completed?:DeckAction)=>{
    if(!admitted){
     const p=typeof proof==='string'?proofs.get(proof):undefined;
     if(!p||p.until<=now())throw new ContextFault(409,'CONTEXT_EXPIRED');
     const v=await view(req);
     if(!v.usable||p.actor!==v.actor.id||p.until<=now()||p.fingerprint!==v.fingerprint)throw new ContextFault(409,'CONTEXT_CHANGED');
     if(!v.presentation.actions.some(a=>a.id===action&&a.available))throw new ContextFault(403,'CONTEXT_ACTION_FORBIDDEN');
     admitted=v;expectedScene=v.snapshot.scene;until=p.until;return;
    }
    const wanted=completed?.type==='scene.set'?completed.value:completed?.type==='mode.set'?options.modes()[completed.value]:expectedScene;
    const v=await view(req);
    if(!wanted||!v.usable||now()>=until||v.stableFingerprint!==admitted.stableFingerprint||v.snapshot.scene!==wanted)
     throw new ContextFault(409,'CONTEXT_CHANGED');
    expectedScene=wanted;
   };
  },
  async assert(req:Request,proof:unknown,action:string){
   if(typeof proof!=='string'||!/^[0-9a-f-]{36}$/i.test(proof))throw new ContextFault(409,'CONTEXT_PROOF_INVALID');
   const p=proofs.get(proof);if(!p||p.until<=now())throw new ContextFault(409,'CONTEXT_EXPIRED');
   const v=await view(req);
   if(!v.usable||p.actor!==v.actor.id||p.until<=now()||p.fingerprint!==v.fingerprint)throw new ContextFault(409,'CONTEXT_CHANGED');
   if(!v.presentation.actions.some(a=>a.id===action&&a.available))throw new ContextFault(403,'CONTEXT_ACTION_FORBIDDEN');
  },
 };
}
export function createMasterContextRouter(context:ReturnType<typeof createMasterContext>){
 const router=Router();router.get('/',async(req,res)=>{
  res.set('Cache-Control','private, no-store');
  try{res.json(await context.read(req))}catch(error){const e=error instanceof ContextFault?error:new ContextFault(503,'CONTEXT_UNAVAILABLE');res.status(e.status).json({error:{code:e.code,retryable:false}})}
 });return router;
}
