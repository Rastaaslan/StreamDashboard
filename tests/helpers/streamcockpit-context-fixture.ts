import express from 'express';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {withMixerFixture} from './streamcockpit-mixer-fixture.js';
import {ControlService} from '../../apps/server/src/control-service.js';
import {registerControlRoutes} from '../../apps/server/src/control-routes.js';
import {createMasterContext,createMasterContextRouter} from '../../apps/server/src/streamcockpit-master-context.js';
export async function withContextFixture(run:(f:any)=>Promise<void>){
 return withMixerFixture(async f=>{
  let offset=0,game:string|null=null;
  const control=await ControlService.open(join(f.directory,'context-control.json'),{
   live:async()=>false,output:async()=>{throw Error('PUBLIC_OUTPUT_FORBIDDEN')},metadata:async()=>{throw Error('PUBLIC_METADATA_FORBIDDEN')},
   action:async(action,_id,recheck)=>{
    if(action.type==='scene.set')await f.bus.execute({type:'obs.scene',scene:action.value},recheck);
    else if(action.type==='timer.add')await f.bus.execute({type:'timer.add',seconds:Number(action.value)},recheck);
    else throw Error('UNSUPPORTED_TEST_ACTION');
   },
  });
  const configuration=control.snapshot().configuration;
  configuration.actions=[{id:'scene-pause',label:'Pause',type:'scene.set',value:'Pause',color:'amber',shortcut:''},{id:'scene-live',label:'Retour jeu',type:'scene.set',value:'Live',color:'purple',shortcut:''},
   {id:'timer',label:'Ajouter une minute',type:'timer.add',value:'60',color:'green',shortcut:''},{id:'clip',label:'Clip',type:'replay.save',value:'',color:'green',shortcut:''}];
  await control.configure(configuration,configuration.revision);
  const context=createMasterContext({
   actor:req=>{const token=req.headers.authorization?.match(/^Device (\S+)$/)?.[1],id=token?f.auth.authenticate(token):null;
    if(!id||!f.auth.permits(id,['observe']))return undefined;
    return {id,role:'paired-controller',capabilities:['obs','audio','clips','chat','cloud'].filter(c=>f.auth.permits(id,[c]))};
   },
   source:()=>{const sample=f.cache.read(Date.now());if(!sample||!f.obs.state.connected)return undefined;return {host:'FIXE',generation:f.obs.connectionGeneration,epoch:f.obs.streamTransitionEpoch,observedAt:sample.observedAt,scene:f.obs.state.scene,game,streamState:f.obs.state.streamingKnown?f.obs.state.streaming?'live':'offline':null}},
   configuration:()=>control.snapshot().configuration,modes:()=>({live:'Live',pause:'Pause'}),now:()=>Date.now()+offset,
  });
  f.app.use('/api/v1/streamcockpit-context',createMasterContextRouter(context));
  const unused:express.RequestHandler=(_q,r)=>{r.sendStatus(204)};
  type Options=Parameters<typeof registerControlRoutes>[0];
  registerControlRoutes({app:f.app,control,obs:f.obs,wizebotCommands:{}as Options['wizebotCommands'],timerSource:()=>undefined,state:()=>({}),observe:async()=>{},
   settings:unused,planningCreate:unused,planningUpdate:unused,planningDelete:unused,recurrence:unused,isLocal:()=>false,port:()=>0,
   verifyContext:(req,action)=>context.assert(req,req.body.expectedContextToken,action),
  });
  f.app.use((error:Error,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{res.status(400).json({error:{message:error.message}})});
  const read=async(token=f.paired.credential)=>{const r=await fetch(f.origin+'/api/v1/streamcockpit-context',{headers:{authorization:'Device '+token}});return {status:r.status,body:await r.json()}};
  const action=async(action:string,proof?:string,id=randomUUID(),token=f.paired.credential)=>{
   const r=await fetch(f.origin+'/api/v2/actions',{method:'POST',headers:{'Content-Type':'application/json',authorization:'Device '+token},body:JSON.stringify({id,issuedAt:new Date().toISOString(),action,...(proof?{expectedContextToken:proof}:{})})});
   return {status:r.status,body:await r.json()};
  };
  try{await run({...f,control,context,read,action,expire:()=>{offset+=13_000},setGame:(value:string|null)=>{game=value}})}finally{await control.stop()}
 });
}
