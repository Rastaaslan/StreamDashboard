import {randomUUID} from 'node:crypto';
import {Router,type Request} from 'express';
import {AdvancedTwitchError} from '../../../integrations/twitch/src/streamcockpit-advanced.js';
import {ModerationTwitch,type ModerationTarget} from '../../../integrations/twitch/src/streamcockpit-moderation.js';
import {HeldAutoModActionTwitch,type HeldActionTarget} from '../../../integrations/twitch/src/streamcockpit-automod-action.js';
import type {TwitchActor} from './streamcockpit-twitch-service.js';

const exact=(v:unknown,keys:string[])=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
/** Separate voluntary preview and confirmation; actor/token/host rechecked. */
export function createTwitchModerationRouter(options:{
  api:ModerationTwitch;actionApi?:HeldAutoModActionTwitch;actor(req:Request):TwitchActor|Promise<TwitchActor>;
  host():string|undefined|Promise<string|undefined>;now?:()=>number;
  /** Host-only EventSub observations, not a complete Twitch queue. */
  held?():{schemaVersion:1;kind:'streamcockpit-automod-observed';status:'partial-observation'|'unavailable';
    observedAt:number|null;messages:unknown[]};
  viewerHistory?(userId:string):{schemaVersion:1;kind:'streamcockpit-automod-viewer-observed';
    status:'partial-observation'|'unavailable';observedAt:number|null;
    entries:{status:'held'|'approved'|'denied'|'expired';observedAt:number}[]};
}){
  const now=options.now??Date.now,pending=new Map<string,{actor:string;host:string;until:number;target:ModerationTarget}>();
  let busy=false;
  const actionPending=new Map<string,{actor:string;host:string;until:number;target:HeldActionTarget}>();
  // No eviction of possibly dispatched decisions in this process. After a restart,
  // the EventSub cache starts empty; no old hold can be sent without a new event.
  const attempted=new Set<string>();
  const router=Router();
  router.use((_q,r,next)=>{r.set('Cache-Control','private, no-store');next()});
  const check=async(req:Request,expected?:{actor:string;host:string})=>{
    const a=await options.actor(req),host=await options.host();
    if(!a?.id||!a.canRead||!a.canInteract||expected&&a.id!==expected.actor)throw new AdvancedTwitchError('forbidden');
    if(!host||expected&&host!==expected.host)throw new AdvancedTwitchError('precondition');
    return {actor:a.id,host};
  };
  // Manual GET only. A disconnected/incomplete EventSub stream must never
  // imply that the real Twitch AutoMod queue is empty.
  router.all('/held',async(req,res)=>{
    if(req.method!=='GET'){res.set('Allow','GET').status(405).json({error:{code:'METHOD_NOT_ALLOWED'}});return;}
    try{
      const context=await check(req);
      const value=options.held?.()??{schemaVersion:1 as const,
        kind:'streamcockpit-automod-observed' as const,status:'unavailable' as const,
        observedAt:null,messages:[]};
      await check(req,context);
      res.json(value);
    }catch(error){
      const code=error instanceof AdvancedTwitchError?error.code:'unavailable';
      res.status(code==='unauthorized'?401:code==='forbidden'?403:code==='precondition'?409:503).json({
        error:{code:'MODERATION_'+code.toUpperCase().replaceAll('-','_'),retryable:false},
      });
    }
  });
  // Selected viewer only: witnessed AutoMod holds/updates since this FIXE EventSub session.
  // No provider query and no complete viewer-history claim.
  router.all('/viewer/:userId',async(req,res)=>{
    if(req.method!=='GET'){res.set('Allow','GET').status(405).json({error:{code:'METHOD_NOT_ALLOWED'}});return;}
    try{
      const userId=req.params.userId;
      if(typeof userId!=='string'||!/^\d{1,30}$/.test(userId))throw new AdvancedTwitchError('invalid');
      const context=await check(req);
      const value=options.viewerHistory?.(userId)??{schemaVersion:1 as const,
        kind:'streamcockpit-automod-viewer-observed' as const,status:'unavailable' as const,
        observedAt:null,entries:[]};
      await check(req,context);
      res.json(value);
    }catch(error){
      const code=error instanceof AdvancedTwitchError?error.code:'unavailable';
      res.status(code==='invalid'?400:code==='unauthorized'?401:code==='forbidden'?403:code==='precondition'?409:503).json({
        error:{code:'MODERATION_'+code.toUpperCase().replaceAll('-','_'),retryable:false},
      });
    }
  });
  // Manual, observed-hold-only decisions. A submitted 204 has NO Twitch readback;
  // never call this an approved/denied message until EventSub or Twitch confirms.
  const witnessed=(target:{messageId:string;userId:string;broadcasterId?:string})=>{
    const snapshot=options.held?.();
    if(snapshot?.status!=='partial-observation')throw new AdvancedTwitchError('precondition');
    const row=snapshot.messages.find(v=>{
      const m=v as {id?:unknown;userId?:unknown;broadcasterId?:unknown};
      return m?.id===target.messageId&&m.userId===target.userId&&
        (target.broadcasterId===undefined||m.broadcasterId===target.broadcasterId);
    }) as {broadcasterId?:unknown}|undefined;
    if(typeof row?.broadcasterId!=='string')throw new AdvancedTwitchError('precondition');
    return row.broadcasterId;
  };
  for(const operation of ['preview','confirm'] as const)
    router.all('/held-action/'+operation,async(req,res)=>{
      if(req.method!=='POST'){res.set('Allow','POST').status(405).json({error:{code:'METHOD_NOT_ALLOWED'}});return;}
      let sent=false,ownsBusy=false;
      try{
        if(!options.actionApi)throw new AdvancedTwitchError('unavailable');
        const context=await check(req);
        if(operation==='preview'){
          if(!exact(req.body,['messageId','userId','decision'])||
            typeof req.body.messageId!=='string'||typeof req.body.userId!=='string'||
            !['ALLOW','DENY'].includes(req.body.decision))throw new AdvancedTwitchError('invalid');
          const target=await options.actionApi.preview({
            broadcasterId:witnessed(req.body),userId:req.body.userId,
            messageId:req.body.messageId,decision:req.body.decision,
          });
          await check(req,context);
          witnessed(target);
          if(attempted.has(target.messageId))throw new AdvancedTwitchError('precondition');
          for(const [id,row] of actionPending)if(row.until<=now())actionPending.delete(id);
          if(actionPending.size>=100||attempted.size>=1000)throw new AdvancedTwitchError('unavailable');
          const confirmationId=randomUUID(),expiresAt=now()+30_000;
          actionPending.set(confirmationId,{...context,until:expiresAt,target});
          res.json({schemaVersion:1,kind:'streamcockpit-automod-action-preview',confirmationId,expiresAt,
            messageId:target.messageId,userId:target.userId,decision:target.decision});
        }else{
          if(!exact(req.body,['confirmationId','confirmed'])||req.body.confirmed!==true||
            typeof req.body.confirmationId!=='string')throw new AdvancedTwitchError('invalid');
          const entry=actionPending.get(req.body.confirmationId);
          if(!entry||entry.actor!==context.actor||entry.host!==context.host||
            entry.until<=now()||busy||attempted.has(entry.target.messageId))
            throw new AdvancedTwitchError('precondition');
          actionPending.delete(req.body.confirmationId);busy=true;ownsBusy=true;
          const result=await options.actionApi.confirm(entry.target,async()=>{
            await check(req,context);
            witnessed(entry.target);
            if(attempted.has(entry.target.messageId)||attempted.size>=1000)
              throw new AdvancedTwitchError('precondition');
            attempted.add(entry.target.messageId);sent=true;
          });
          await check(req,context);
          res.json({schemaVersion:1,kind:'streamcockpit-automod-action-receipt',...result});
        }
      }catch(cause){
        const code=sent?'uncertain':cause instanceof AdvancedTwitchError?cause.code:'unavailable';
        const status=code==='invalid'?400:code==='unauthorized'?401:code==='forbidden'?403:
          code==='precondition'?409:code==='rate-limited'?429:503;
        res.status(status).json({error:{code:'MODERATION_'+code.toUpperCase().replaceAll('-','_'),retryable:false}});
      }finally{if(ownsBusy)busy=false}
    });
  for(const operation of ['preview','confirm']as const)router.all('/'+operation,async(req,res)=>{
    if(req.method!=='POST'){res.set('Allow','POST').status(405).json({error:{code:'METHOD_NOT_ALLOWED'}});return}
    let sent=false,ownsBusy=false;
    try{
      const context=await check(req);
      if(operation==='preview'){
        if(!exact(req.body,['change']))throw new AdvancedTwitchError('invalid');
        const target=await options.api.preview(req.body.change);
        await check(req,context);
        for(const [id,p]of pending)if(p.until<=now())pending.delete(id);
        if(pending.size>=100)throw new AdvancedTwitchError('unavailable');
        const confirmationId=randomUUID(),expiresAt=now()+45_000;
        pending.set(confirmationId,{...context,until:expiresAt,target});
        res.json({schemaVersion:1,kind:'streamcockpit-moderation-preview',confirmationId,expiresAt,change:target.change,previous:target.previous});
      }else{
        if(!exact(req.body,['confirmationId','confirmed'])||req.body.confirmed!==true||typeof req.body.confirmationId!=='string')
          throw new AdvancedTwitchError('invalid');
        const entry=pending.get(req.body.confirmationId);
        if(!entry||entry.actor!==context.actor||entry.host!==context.host||entry.until<=now()||busy)
          throw new AdvancedTwitchError('precondition');
        pending.delete(req.body.confirmationId);busy=true;ownsBusy=true;
        const result=await options.api.confirm(entry.target,async()=>{await check(req,context);sent=true});
        await check(req,context);
        res.json({schemaVersion:1,kind:'streamcockpit-moderation-confirmation',...result});
      }
    }catch(cause){
      const code=sent?'uncertain':cause instanceof AdvancedTwitchError?cause.code:'unavailable';
      const status=code==='invalid'?400:code==='unauthorized'?401:code==='forbidden'?403:code==='precondition'?409:code==='rate-limited'?429:503;
      res.status(status).json({error:{code:'MODERATION_'+code.toUpperCase().replaceAll('-','_'),retryable:false}});
    }finally{if(ownsBusy)busy=false}
  });
  return router;
}
