import { Router, type Request, type Response } from 'express';
import { AdvancedTwitchError } from '../../../integrations/twitch/src/streamcockpit-advanced.js';
import type { TwitchActor } from './streamcockpit-twitch-service.js';
import { StreamcockpitShoutoutService } from './streamcockpit-twitch-shoutout-service.js';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const exact=(v:unknown,keys:string[]):boolean=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&
  Object.keys(v).sort().join(',')===[...keys].sort().join(',');

/** F08: ONLY manually confirmed Twitch shoutouts on the authorized FIXE host.
 * Never infer live from a calendar, retry an ambiguous POST, or leak Twitch tokens.
 */
export function createTwitchShoutoutRouter(options:{
  service:StreamcockpitShoutoutService;
  actor(req:Request):TwitchActor|Promise<TwitchActor>;
  /** Stable opaque FIXE stream epoch; undefined means unavailable. */
  hostLive():string|undefined|Promise<string|undefined>;
}) {
  const router=Router();
  router.use((_req,res,next)=>{res.set('Cache-Control','private, no-store');next()});
  const deny=(res:Response,cause:unknown,possiblySent:boolean)=>{
    const error=cause instanceof AdvancedTwitchError?cause.code:'unavailable';
    const code=possiblySent?'SHOUTOUT_OUTCOME_UNCERTAIN':'SHOUTOUT_'+error.toUpperCase().replaceAll('-','_');
    const status=possiblySent?503:error==='invalid'?400:error==='unauthorized'?401:
      error==='forbidden'?403:error==='precondition'?409:error==='rate-limited'?429:503;
    res.status(status).json({error:{code,retryable:false}});
  };
  const check=async(req:Request,original?:{actor:string;hostEpoch:string})=>{
    const actor=await options.actor(req);
    if(!actor?.id||!actor.canRead||!actor.canInteract||
        (original&&original.actor!==actor.id))throw new AdvancedTwitchError('forbidden');
    const hostEpoch=await options.hostLive();
    if(!hostEpoch || (original&&hostEpoch!==original.hostEpoch))
      throw new AdvancedTwitchError('precondition');
    return {actor,hostEpoch};
  };
  router.all('/preview',async(req,res)=>{
    if(req.method!=='POST'){res.set('Allow','POST').status(405).json({error:{code:'METHOD_NOT_ALLOWED'}});return}
    try{
      const context=await check(req);
      if(!exact(req.body,['target']))throw new AdvancedTwitchError('invalid');
      const result=await options.service.preview(context.actor,req.body.target,context.hostEpoch);
      await check(req,{actor:context.actor.id,hostEpoch:context.hostEpoch});
      res.status(200).json({schemaVersion:1,kind:'streamcockpit-shoutout-preview',
        confirmationId:result.confirmationId,expiresAt:result.expiresAt,
        targetLogin:result.targetLogin,warning:result.warning});
    }catch(cause){deny(res,cause,false)}
  });
  router.all('/confirm',async(req,res)=>{
    if(req.method!=='POST'){res.set('Allow','POST').status(405).json({error:{code:'METHOD_NOT_ALLOWED'}});return}
    let possiblySent=false;
    try{
      const context=await check(req);
      if(!exact(req.body,['confirmationId','confirmed'])||req.body.confirmed!==true||
          typeof req.body.confirmationId!=='string'||!uuid.test(req.body.confirmationId))
        throw new AdvancedTwitchError('invalid');
      const expected={actor:context.actor.id,hostEpoch:context.hostEpoch};
      const receipt=await options.service.confirm(context.actor,req.body.confirmationId,true,context.hostEpoch,async()=>{
        await check(req,expected);
        possiblySent=true;
      });
      await check(req,expected);
      res.status(200).json({schemaVersion:1,kind:'streamcockpit-shoutout-confirmation',
        status:'accepted',targetLogin:receipt.targetLogin});
    }catch(cause){deny(res,cause,possiblySent)}
  });
  return router;
}
