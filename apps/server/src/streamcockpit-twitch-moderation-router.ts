import {randomUUID} from 'node:crypto';
import {Router,type Request} from 'express';
import {AdvancedTwitchError} from '../../../integrations/twitch/src/streamcockpit-advanced.js';
import {ModerationTwitch,type ModerationTarget} from '../../../integrations/twitch/src/streamcockpit-moderation.js';
import type {TwitchActor} from './streamcockpit-twitch-service.js';

const exact=(v:unknown,keys:string[])=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
/** Separate voluntary preview and confirmation; actor/token/host rechecked. */
export function createTwitchModerationRouter(options:{
  api:ModerationTwitch;actor(req:Request):TwitchActor|Promise<TwitchActor>;
  host():string|undefined|Promise<string|undefined>;now?:()=>number;
}){
  const now=options.now??Date.now,pending=new Map<string,{actor:string;host:string;until:number;target:ModerationTarget}>();
  let busy=false;
  const router=Router();
  router.use((_q,r,next)=>{r.set('Cache-Control','private, no-store');next()});
  const check=async(req:Request,expected?:{actor:string;host:string})=>{
    const a=await options.actor(req),host=await options.host();
    if(!a?.id||!a.canRead||!a.canInteract||expected&&a.id!==expected.actor)throw new AdvancedTwitchError('forbidden');
    if(!host||expected&&host!==expected.host)throw new AdvancedTwitchError('precondition');
    return {actor:a.id,host};
  };
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
