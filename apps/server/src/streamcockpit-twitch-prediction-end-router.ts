import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { AdvancedTwitchError } from '../../../integrations/twitch/src/streamcockpit-advanced.js';
import { PredictionEndTwitch, normalizePredictionEnd,
  type PredictionEndDraft } from '../../../integrations/twitch/src/streamcockpit-prediction-end.js';
import type { TwitchActor } from './streamcockpit-twitch-service.js';

type EndFence = {
  readConfirmedId(owner:string):string|null|undefined;
  readEndAttempted(owner:string,id:string):boolean;
  readLockAttempted(owner:string,id:string):boolean;
  markEndAttempted(owner:string,id:string,action:'RESOLVED'|'CANCELED',winnerId?:string):void;
};
/** F08: voluntary exact-ID prediction terminal mutation, never OBS commands.
 * Must be paired on FIXE, with one-use preview and SQLite COMMIT before PATCH. */
export function createTwitchPredictionEndRouter(options:{
  api:PredictionEndTwitch;
  actor(req:Request):TwitchActor|Promise<TwitchActor>;
  hostLive():string|undefined|Promise<string|undefined>;
  broadcasterId():string;
  fence:EndFence;
}){
  const router=Router();
  const pending=new Map<string,{actor:string;epoch:string;owner:string;id:string;
    draft:PredictionEndDraft;fingerprint:string;expiresAt:number}>();
  const inFlight=new Set<string>();
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const check=async(req:Request,expected?:{actor:string;epoch:string})=>{
    const a=await options.actor(req);
    if(!a?.id||!a.canRead||!a.canInteract||(expected&&expected.actor!==a.id))
      throw new AdvancedTwitchError('forbidden');
    const epoch=await options.hostLive();
    if(!epoch||!/^[0-9]{1,16}:[0-9]{1,16}$/.test(epoch)||
        (expected&&expected.epoch!==epoch))
      throw new AdvancedTwitchError('precondition');
    return {actor:a.id,epoch};
  };
  const readExact=(owner:string)=>{
    if(!/^[0-9]{1,30}$/.test(owner)) throw new AdvancedTwitchError('unauthorized');
    const id=options.fence.readConfirmedId(owner);
    if(typeof id!=='string'||options.fence.readEndAttempted(owner,id))
      throw new AdvancedTwitchError('precondition');
    return id;
  };
  const deny=(res:Response,error:unknown,dispatched:boolean)=>{
    const code=dispatched?'uncertain':error instanceof AdvancedTwitchError?error.code:'unavailable';
    res.status(code==='invalid'?400:code==='unauthorized'?401:code==='forbidden'?403:
      code==='precondition'?409:code==='rate-limited'?429:503).json({error:{
      code:code==='uncertain'?'PREDICTION_END_OUTCOME_UNCERTAIN':
        'PREDICTION_END_'+code.toUpperCase().replaceAll('-','_'),
      retryable:false,
    }});
  };
  const only=(req:Request,res:Response,verb:'GET'|'POST')=>{
    if(req.method===verb)return false;
    res.set('Allow',verb).status(405).json({error:{code:'METHOD_NOT_ALLOWED'}});
    return true;
  };
  router.use((_req,res,next)=>{res.set('Cache-Control','private, no-store');next();});
  router.all('/inspect',async(req,res)=>{
    if(only(req,res,'GET'))return;
    try{
      const expected=await check(req),owner=options.broadcasterId();
      if(inFlight.has(owner))throw new AdvancedTwitchError('precondition');
      const id=readExact(owner);
      const state=await options.api.inspect(id,owner);
      // An attempted LOCK with a provider still ACTIVE can be in flight or
      // uncertain. Do not race a cancellation against that public PATCH.
      if(state.status==='ACTIVE'&&options.fence.readLockAttempted(owner,id))
        throw new AdvancedTwitchError('precondition');
      await check(req,expected);
      if(options.broadcasterId()!==owner||readExact(owner)!==id)
        throw new AdvancedTwitchError('precondition');
      res.json({schemaVersion:1,kind:'streamcockpit-prediction-end-inspection',
        providerStatus:state.status.toLowerCase(),outcomes:state.outcomes,
        canResolve:state.status==='LOCKED',canCancel:true,
        mutationPerformed:false});
    }catch(error){deny(res,error,false);}
  });
  router.all('/preview',async(req,res)=>{
    if(only(req,res,'POST'))return;
    try{
      const draft=normalizePredictionEnd(req.body);
      const expected=await check(req),owner=options.broadcasterId();
      if(inFlight.has(owner))throw new AdvancedTwitchError('precondition');
      const id=readExact(owner);
      const state=await options.api.inspect(id,owner);
      if(state.status==='ACTIVE'&&options.fence.readLockAttempted(owner,id))
        throw new AdvancedTwitchError('precondition');
      options.api.validateChoice(state,draft);
      await check(req,expected);
      if(options.broadcasterId()!==owner||readExact(owner)!==id)
        throw new AdvancedTwitchError('precondition');
      for(const [key,value] of pending)if(value.expiresAt<=Date.now())pending.delete(key);
      if(pending.size>=100)throw new AdvancedTwitchError('unavailable');
      const expiresAt=Math.min(Date.now()+30_000,state.until),confirmationId=randomUUID();
      if(expiresAt<=Date.now())throw new AdvancedTwitchError('precondition');
      pending.set(confirmationId,{...expected,owner,id,draft,
        fingerprint:state.fingerprint,expiresAt});
      res.json({schemaVersion:1,kind:'streamcockpit-prediction-end-preview',
        confirmationId,expiresAt,action:draft.action.toLowerCase(),
        ...(draft.winnerId?{winnerId:draft.winnerId}:{}),
        warning:'Cette opération met fin publiquement à la prédiction Twitch ; aucun réessai automatique.'});
    }catch(error){deny(res,error,false);}
  });
  router.all('/confirm',async(req,res)=>{
    if(only(req,res,'POST'))return;
    let dispatched=false;
    try{
      const context=await check(req),body=req.body;
      if(!body||typeof body!=='object'||Array.isArray(body)||
          Object.keys(body).sort().join(',')!=='confirmationId,confirmed'||
          body.confirmed!==true||typeof body.confirmationId!=='string'||!uuid.test(body.confirmationId))
        throw new AdvancedTwitchError('invalid');
      const entry=pending.get(body.confirmationId);
      pending.delete(body.confirmationId); // Before ANY async provider IO.
      if(!entry||entry.actor!==context.actor||entry.epoch!==context.epoch||
          entry.expiresAt<=Date.now()||inFlight.has(entry.owner))
        throw new AdvancedTwitchError('precondition');
      inFlight.add(entry.owner);
      try{
        if(options.broadcasterId()!==entry.owner||readExact(entry.owner)!==entry.id)
          throw new AdvancedTwitchError('precondition');
        const receipt=await options.api.endConfirmed(entry.id,entry.owner,
          entry.fingerprint,entry.draft,async(observedStatus)=>{
            await check(req,{actor:entry.actor,epoch:entry.epoch});
            if(observedStatus==='ACTIVE'&&options.fence.readLockAttempted(entry.owner,entry.id))
              throw new AdvancedTwitchError('precondition');
            if(options.broadcasterId()!==entry.owner||readExact(entry.owner)!==entry.id)
              throw new AdvancedTwitchError('precondition');
            try{options.fence.markEndAttempted(entry.owner,entry.id,
              entry.draft.action,entry.draft.winnerId);}
            catch{throw new AdvancedTwitchError('unavailable');}
            dispatched=true; // PATCH may reach Twitch after this point.
          });
        await check(req,{actor:entry.actor,epoch:entry.epoch});
        if(options.broadcasterId()!==entry.owner||
            options.fence.readConfirmedId(entry.owner)!==entry.id)
          throw new AdvancedTwitchError('uncertain');
        res.json({schemaVersion:1,kind:'streamcockpit-prediction-end-confirmation',
          status:receipt.status,predictionId:receipt.predictionId});
      }finally{inFlight.delete(entry.owner);}
    }catch(error){deny(res,error,dispatched);}
  });
  return router;
}
