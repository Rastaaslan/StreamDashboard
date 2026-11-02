import {Router,type Request,type Response} from 'express';
import {AdvancedTwitchError} from '../../../integrations/twitch/src/streamcockpit-advanced.js';
import type {TwitchActor} from './streamcockpit-twitch-service.js';
import {StreamcockpitRaidService} from './streamcockpit-twitch-raid-service.js';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const exact=(v:unknown,keys:string[])=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&
  Object.keys(v).sort().join(',')===[...keys].sort().join(',');

/** Manual raid preview + one-use confirmation, bound to one FIXE live epoch. */
export function createTwitchRaidRouter(options:{service:StreamcockpitRaidService;
  actor(req:Request):TwitchActor|Promise<TwitchActor>;
  hostLive():string|undefined|Promise<string|undefined>;
}){
  const router=Router();
  router.use((_req,res,next)=>{res.set('Cache-Control','private, no-store');next()});
  const deny=(res:Response,error:unknown,possiblySent:boolean)=>{
    const cause=error instanceof AdvancedTwitchError?error.code:'unavailable';
    res.status(possiblySent?503:cause==='invalid'?400:cause==='unauthorized'?401:cause==='forbidden'?403:
      cause==='precondition'?409:cause==='rate-limited'?429:503).json({error:{
        code:possiblySent?'RAID_OUTCOME_UNCERTAIN':'RAID_'+cause.toUpperCase().replaceAll('-','_'),retryable:false}});
  };
  const check=async(req:Request,expected?:{actor:string;epoch:string})=>{
    const actor=await options.actor(req);
    if(!actor?.id||!actor.canRead||!actor.canInteract||(expected&&actor.id!==expected.actor))
      throw new AdvancedTwitchError('forbidden');
    const epoch=await options.hostLive();
    if(!epoch||(expected&&epoch!==expected.epoch))throw new AdvancedTwitchError('precondition');
    return {actor,epoch};
  };
  router.all('/preview',async(req,res)=>{
    if(req.method!=='POST'){res.set('Allow','POST').status(405).json({error:{code:'METHOD_NOT_ALLOWED'}});return}
    try{
      const context=await check(req);
      if(!exact(req.body,['request']))throw new AdvancedTwitchError('invalid');
      const preview=await options.service.preview(context.actor,req.body.request,context.epoch);
      await check(req,{actor:context.actor.id,epoch:context.epoch});
      res.status(200).json({schemaVersion:1,kind:'streamcockpit-raid-preview',...preview});
    }catch(error){deny(res,error,false)}
  });
  router.all('/confirm',async(req,res)=>{
    if(req.method!=='POST'){res.set('Allow','POST').status(405).json({error:{code:'METHOD_NOT_ALLOWED'}});return}
    let possiblySent=false;
    try{
      const context=await check(req);
      if(!exact(req.body,['confirmationId','confirmed'])||req.body.confirmed!==true||
        typeof req.body.confirmationId!=='string'||!uuid.test(req.body.confirmationId))
        throw new AdvancedTwitchError('invalid');
      const expected={actor:context.actor.id,epoch:context.epoch};
      const receipt=await options.service.confirm(context.actor,req.body.confirmationId,true,context.epoch,async()=>{
        await check(req,expected);possiblySent=true;
      });
      await check(req,expected);
      res.status(200).json({schemaVersion:1,kind:'streamcockpit-raid-confirmation',...receipt});
    }catch(error){deny(res,error,possiblySent)}
  });
  return router;
}
