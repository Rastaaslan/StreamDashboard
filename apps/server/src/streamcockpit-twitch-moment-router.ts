import {randomUUID} from 'node:crypto';
import {Router,type Request} from 'express';
import {AdvancedTwitchError} from '../../../integrations/twitch/src/streamcockpit-advanced.js';
import {SimpleMomentsTwitch,type SimpleMomentTarget} from '../../../integrations/twitch/src/streamcockpit-simple-moments.js';
import type {TwitchActor} from './streamcockpit-twitch-service.js';
import type {RemoteAuth} from './remote-auth.js';
import {twitchPollActor} from './streamcockpit-twitch-poll-router.js';
export function twitchMomentActor(req:Request,auth:RemoteAuth,local:boolean,remoteEnabled:boolean){
  const actor=twitchPollActor(req,auth,local,remoteEnabled);
  if(!auth.permits(actor.id,['clips']))throw new AdvancedTwitchError('forbidden');
  return actor;
}
export function createTwitchMomentRouter(options:{
  api:SimpleMomentsTwitch;actor(req:Request):TwitchActor|Promise<TwitchActor>;
  hostLive():string|undefined|Promise<string|undefined>;
  record?(moment:{kind:'marker'|'clip';id:string;instant:number;correlationId:string;title:string}):Promise<'recorded'|'unbound'>;
}){
  const pending=new Map<string,{actor:string;host:string;until:number;target:SimpleMomentTarget}>(),router=Router();
  const exact=(v:unknown,keys:string[])=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
  router.use((_q,r,next)=>{r.set('Cache-Control','private, no-store');next()});
  const check=async(req:Request,expected?:{actor:string;host:string})=>{
    const actor=await options.actor(req),host=await options.hostLive();
    if(!actor?.id||!actor.canRead||!actor.canInteract||expected&&actor.id!==expected.actor)throw new AdvancedTwitchError('forbidden');
    if(!host||expected&&host!==expected.host)throw new AdvancedTwitchError('precondition');
    return {actor:actor.id,host};
  };
  for(const op of ['preview','confirm']as const)router.all('/'+op,async(req,res)=>{
    if(req.method!=='POST'){res.set('Allow','POST').status(405).json({error:{code:'METHOD_NOT_ALLOWED'}});return}
    let sent=false;
    try{
      const context=await check(req);
      if(op==='preview'){
        if(!exact(req.body,['draft']))throw new AdvancedTwitchError('invalid');
        const target=await options.api.preview(req.body.draft);await check(req,context);
        for(const[id,p]of pending)if(p.until<=Date.now())pending.delete(id);
        if(pending.size>=100)throw new AdvancedTwitchError('unavailable');
        const confirmationId=randomUUID(),expiresAt=Date.now()+45_000;
        pending.set(confirmationId,{...context,until:expiresAt,target});
        res.json({schemaVersion:1,kind:'streamcockpit-moment-preview',confirmationId,expiresAt,draft:target.draft});
      }else{
        if(!exact(req.body,['confirmationId','confirmed'])||req.body.confirmed!==true||typeof req.body.confirmationId!=='string')throw new AdvancedTwitchError('invalid');
        const p=pending.get(req.body.confirmationId);
        if(!p||p.actor!==context.actor||p.host!==context.host||p.until<=Date.now())throw new AdvancedTwitchError('precondition');
        pending.delete(req.body.confirmationId);
        const result=await options.api.confirm(p.target,async()=>{await check(req,context);sent=true});
        await check(req,context);
        let journal:'recorded'|'unbound'|'uncertain'='unbound';
        try{journal=await options.record?.({kind:result.kind,id:result.id,instant:result.instant,correlationId:req.body.confirmationId,
          title:p.target.draft.description||(result.kind==='marker'?'Marqueur Twitch':'Clip Twitch demandé')})??'unbound'}catch{journal='uncertain'}
        await check(req,context);
        const {kind:momentKind,...receipt}=result;
        res.json({schemaVersion:1,kind:'streamcockpit-moment-confirmation',momentKind,...receipt,journal});
      }
    }catch(error){
      const code=sent?'uncertain':error instanceof AdvancedTwitchError?error.code:'unavailable';
      res.status(code==='invalid'?400:code==='unauthorized'?401:code==='forbidden'?403:code==='precondition'?409:code==='rate-limited'?429:503)
        .json({error:{code:'MOMENT_'+code.toUpperCase().replaceAll('-','_'),retryable:false}});
    }
  });
  return router;
}
