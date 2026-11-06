import express from 'express';
import {encode,decode} from '@msgpack/msgpack';
import {WebSocketServer,WebSocket} from 'ws';
import type {AddressInfo} from 'node:net';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ObsClient} from '../../integrations/obs/src/client.js';
import {DashboardCommandService} from '../../apps/server/src/command-service.js';
import {RemoteAuth} from '../../apps/server/src/remote-auth.js';
import {ObsMixerObservation} from '../../apps/server/src/streamcockpit-mixer-observation.js';
import {createMixerRouter} from '../../apps/server/src/streamcockpit-mixer-router.js';
import {createMixerControlRouter} from '../../apps/server/src/streamcockpit-mixer-control-router.js';
import {AudioReceiptSqlite} from '../../apps/server/src/streamcockpit-audio-receipts-sqlite.js';
import {isRemoteApiAllowed,requiredDevicePermissions} from '../../apps/server/src/remote-api-policy.js';

/** Loopback-only fake OBS protocol; the actual ObsClient, authority bus and HTTP router run unchanged. */
export async function withMixerFixture(run:(fixture:any)=>Promise<void>,durable=false){
 const directory=await mkdtemp(join(tmpdir(),'streamcockpit-mixer-qa-'));
 let gain=.75,mute=false,uuid='b7ddf425-b16d-4d53-b213-b607dc853c9f',mode='ok',host:string|undefined='FIXE',writes=0,scene='Live',streaming=false;
 const rpc:Array<{type:string;args:any}>=[],intents:Record<string,string>={};let listReads=0;
 const obsServer=new WebSocketServer({port:0,host:'127.0.0.1'});
 await new Promise<void>(resolve=>obsServer.once('listening',resolve));
 const auth=new RemoteAuth(),invitation=auth.createPairing(undefined,false,['observe','obs','audio']);
 const paired=auth.pair(invitation.id,invitation.code,'Android QA');
 obsServer.on('connection',socket=>{
  const send=(value:unknown)=>socket.send(encode(value));
  send({op:0,d:{obsWebSocketVersion:'5.6.0',rpcVersion:1}});
  socket.on('message',data=>{
   const message=decode(data as Buffer) as any,d=message.d;
   if(process.env.SC3_MIXER_DEBUG==='1')console.error('QA OBS',message.op,d?.requestType??'handshake');
   if(message.op===1||message.op===3){send({op:2,d:{negotiatedRpcVersion:1}});return}
   if(message.op!==6)return;
   const type=d.requestType,args=d.requestData??{};rpc.push({type,args});
   let response:any={},code=100;
   switch(type){
    case 'GetVersion':response={obsVersion:'32.0.0',obsWebSocketVersion:'5.6.0',rpcVersion:1};break;
    case 'GetCurrentProgramScene':response={currentProgramSceneName:scene};break;
    case 'GetSceneList':response={scenes:[{sceneName:'Live'},{sceneName:'Pause'}]};break;
    case 'SetCurrentProgramScene':scene=args.sceneName;writes++;send({op:5,d:{eventType:'CurrentProgramSceneChanged',eventIntent:4,eventData:{sceneName:scene}}});break;
    case 'GetStreamStatus':response={outputActive:streaming};break;
    case 'GetRecordStatus':response={outputActive:false};break;
    case 'GetInputList':if(mode==='revoke-during-final-read'&&++listReads===4)auth.revoke(paired.deviceId);response={inputs:[{inputName:'Micro QA',inputUuid:mode==='no-uuid'?undefined:uuid,inputKind:'wasapi_input_capture'}]};break;
    case 'GetInputMute':response={inputMuted:mute};break;
    case 'GetInputVolume':response={inputVolumeMul:gain,inputVolumeDb:20*Math.log10(gain)};break;
    case 'GetSceneItemList':response={sceneItems:[{sourceName:'Micro QA',sceneItemEnabled:true}]};break;
    case 'GetSpecialInputs':response={mic1:'Micro QA'};break;
    case 'SetInputVolume':case 'SetInputMute':{
     if(args.inputUuid!==uuid||args.inputName!==undefined){code=600;break}
     if(mode==='reject'){code=601;break}
     writes++;
     if(mode!=='no-effect'){if(type==='SetInputVolume')gain=args.inputVolumeMul;else mute=args.inputMuted}
     if(mode==='lost'){socket.terminate();return}
     if(mode==='revoke-after')auth.revoke(paired.deviceId);
     send({op:5,d:{eventType:type==='SetInputVolume'?'InputVolumeChanged':'InputMuteStateChanged',eventIntent:8,eventData:{inputName:'Micro QA',inputUuid:uuid,inputVolumeMul:gain,inputVolumeDb:20*Math.log10(gain),inputMuted:mute}}});break;
    }
   }
   if(args.inputUuid!==undefined&&args.inputUuid!==uuid)code=600;
   if(socket.readyState===WebSocket.OPEN)send({op:7,d:{requestType:type,requestId:d.requestId,requestStatus:{result:code===100,code},responseData:response}});
  });
 });
 const obs=new ObsClient('ws://127.0.0.1:'+(obsServer.address()as AddressInfo).port,'',{logger:{warn(){},error(){}}});
 const cache=new ObsMixerObservation();obs.onStateChanged(()=>cache.observe(obs.state,obs.connectionGeneration));
 const domain={mode:'idle' as const,timer:{running:false,duration:300,remaining:300,deadline:null},checklist:[]};
 const bus=new DashboardCommandService(domain,obs,async()=>({})as never);
 const actor=(req:express.Request)=>{const token=req.headers.authorization?.match(/^Device (\S+)$/)?.[1];const id=token?auth.authenticate(token):null;return id&&auth.permits(id,['observe','obs','audio'])?id:''};
 let journal=durable?new AudioReceiptSqlite(join(directory,'streamcockpit-mixer-receipts.sqlite')):undefined;
 const makeRouter=()=>createMixerControlRouter({actor,authority:()=>host,journal,host:()=>host&&obs.state.connected?host+':'+obs.connectionGeneration:undefined,
  read:id=>obs.readMixerSource(id),write:(before,change)=>obs.writeMixerSource(before,change),serialize:operation=>bus.observedObs(operation),
  reservation:id=>intents[id],reserve:async(id,fingerprint)=>{
   if(intents[id])throw Error('ALREADY_RESERVED');if(mode==='disk-failure')throw Error('PRIVATE_DISK_PATH');
   intents[id]=fingerprint;await writeFile(join(directory,'intents.json'),JSON.stringify(intents));
   if(mode==='changed-during-save')gain=.42;
  },
 });
 let controls=makeRouter();
 const app=express();app.use(express.json());
 app.get('/',(_q,r)=>r.send('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><main id="root"></main>'));
 app.use('/api',(req,res,next)=>{
  if(!isRemoteApiAllowed(req.method,req.path)){res.sendStatus(403);return}
  const token=req.headers.authorization?.match(/^Device (\S+)$/)?.[1],id=token?auth.authenticate(token):null;
  if(!id||!auth.permits(id,requiredDevicePermissions(req.method,req.path,req.body))){res.sendStatus(403);return}next();
 });
 app.use('/api/v1/streamcockpit-mixer',createMixerRouter({canRead:req=>Boolean(actor(req)),readSnapshot:()=>cache.read(Date.now())}));
 app.use('/api/v1/streamcockpit-mixer/control',(req,res,next)=>controls(req,res,next));
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
 const origin='http://127.0.0.1:'+(server.address()as AddressInfo).port;
 try{
  if(process.env.SC3_MIXER_DEBUG==='1')console.error('QA connecting');
  await obs.connect();if(process.env.SC3_MIXER_DEBUG==='1')console.error('QA connected',obs.state.connected,obs.state.error);if(!obs.state.connected)throw Error('FAKE_OBS_STARTUP_FAILED');
  const call=async(path:string,body?:unknown,token=paired.credential,method=body===undefined?'GET':'POST')=>{
   const response=await fetch(origin+'/api/v1/streamcockpit-mixer/control/'+path,{method,headers:{'Content-Type':'application/json',authorization:'Device '+token},...(body===undefined?{}:{body:JSON.stringify(body)})});
   const text=await response.text();let payload;try{payload=JSON.parse(text)}catch{payload={error:text}}return {status:response.status,body:payload};
  };
  await run({origin,call,auth,paired,obs,bus,rpc,domain,intents,directory,app,cache,journal:()=>journal,obsUrl:'ws://127.0.0.1:'+(obsServer.address()as AddressInfo).port,
   state:()=>({gain,mute,uuid,writes,scene}),setScene:(value:string)=>{scene=value;for(const socket of obsServer.clients)if(socket.readyState===WebSocket.OPEN)socket.send(encode({op:5,d:{eventType:'CurrentProgramSceneChanged',eventIntent:4,eventData:{sceneName:scene}}}))},setMode:(value:string)=>{mode=value},setHost:(value:string|undefined)=>{host=value},
   setStreaming:(value:boolean)=>{streaming=value;for(const socket of obsServer.clients)if(socket.readyState===WebSocket.OPEN)socket.send(encode({op:5,d:{eventType:'StreamStateChanged',eventIntent:64,eventData:{outputActive:streaming}}}))},
   changeSource:()=>{uuid='ea7cd229-38a9-46dc-aa94-e746eb37622d'},changeGain:(value:number)=>{gain=value},
   restartRouter:async()=>{const stored=JSON.parse(await readFile(join(directory,'intents.json'),'utf8'));Object.assign(intents,stored);if(durable)journal=new AudioReceiptSqlite(join(directory,'streamcockpit-mixer-receipts.sqlite'));controls=makeRouter()},
  });
 }finally{
  await bus.stop();await obs.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));
  for(const socket of obsServer.clients)socket.terminate();await new Promise<void>(resolve=>obsServer.close(()=>resolve()));await rm(directory,{recursive:true,force:true});
 }
}
