import OBSWebSocket from 'obs-websocket-js';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {isAbsolute,join,resolve} from 'node:path';
import {assessRestartSafety,type RestartSafetySource} from '../../server/src/restart-safety.js';
import {AitumSuiteOutputs} from '../../../integrations/obs/src/aitum-suite.js';
import type {MaintenanceOfflineWitness} from './streamcockpit-external-maintenance.js';

/** Native-process-only input. Credentials arrive in memory, never in a release,
 * command line, receipt, renderer, profile copy or diagnostic. No refresh/login. */
export interface MaintenanceObserverConfiguration {
  obs:{url:string;password:string};
  outputs:Record<string,{kind:string;name:string}>;
  twitch:{clientId:string;accessToken:string;broadcasterId:string};
}
const refused=()=>new Error('SC3_MAINTENANCE_OBSERVATION_UNAVAILABLE');
const text=(v:unknown,max:number):v is string=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\x00-\x1f\x7f]/.test(v);
export function validateMaintenanceObserverConfiguration(value:unknown):MaintenanceObserverConfiguration {
  const c=value as MaintenanceObserverConfiguration;
  if(!c||!c.obs||!c.twitch||typeof c.obs.password!=='string'||c.obs.password.length>4096||
    !text(c.obs.url,2048)||!text(c.twitch.clientId,256)||!text(c.twitch.accessToken,4096)||
    !/^\d{1,30}$/.test(c.twitch.broadcasterId)||!c.outputs||typeof c.outputs!=='object'||Array.isArray(c.outputs))throw refused();
  const u=new URL(c.obs.url);
  if(!['ws:','wss:'].includes(u.protocol)||u.username||u.password||u.hash||u.search||u.pathname!=='/')throw refused();
  if(Object.keys(c.outputs).length>32||Object.values(c.outputs).some(o=>!o||
    !['main','unconfigured','output','aitum-suite'].includes(o.kind)||typeof o.name!=='string'||o.name.length>200||
    /[\x00-\x1f\x7f]/.test(o.name)||(['output','aitum-suite'].includes(o.kind)&&!o.name.trim())))throw refused();
  return structuredClone(c);
}

/** Independent read-only connection survives the old Desktop's exit. Reuses
 * the established OBS/Aitum restart assessment, with real Helix GETs. No OBS
 * launch/stop/mutation, no automatic reconnect, no token refresh or disk I/O. */
export async function createIndependentMaintenanceObserver(input:MaintenanceObserverConfiguration,
  io:{fetchApi?:typeof fetch;now?:()=>number}={}) {
  const config=validateMaintenanceObserverConfiguration(input),fetchApi=io.fetchApi??fetch,now=io.now??Date.now;
  const ws=new OBSWebSocket(),session=randomUUID();
  let closed=false,connected=false,generation=0,flight:Promise<MaintenanceOfflineWitness|undefined>|undefined;
  const state={connected:false,streamingKnown:false,streaming:false,recording:false};
  const lost=()=>{connected=false;state.connected=false;state.streamingKnown=false;generation++};
  ws.on('ConnectionClosed',lost);ws.on('ConnectionError',lost);
  // Even a stream which starts and stops during inspection invalidates the sample.
  ws.on('StreamStateChanged',()=>{generation++});ws.on('RecordStateChanged',()=>{generation++});
  ws.on('ExitStarted',lost);
  const within=async<T>(operation:Promise<T>):Promise<T>=>{
    let timer:NodeJS.Timeout|undefined;
    try{return await Promise.race([operation,new Promise<never>((_r,reject)=>{
      timer=setTimeout(()=>{closed=true;lost();void ws.disconnect().catch(()=>undefined);reject(refused())},4500);
    })])}finally{clearTimeout(timer)}
  };
  try{await within(ws.connect(config.obs.url,config.obs.password,{rpcVersion:1,eventSubscriptions:64}));connected=true;state.connected=true}
  catch{closed=true;await ws.disconnect().catch(()=>undefined);throw refused()}
  const suite=new AitumSuiteOutputs(async(type,data)=>
    (await within(ws.call('CallVendorRequest',{vendorName:'aitum-stream-suite',requestType:type,requestData:data}))).responseData,
    async()=>{throw refused()}); // Mutation/hotkey path is deliberately unavailable.
  const source:RestartSafetySource={obsEnabled:true,stopped:()=>closed,pending:()=>false,
    revision:()=>String(generation),configuration:()=>({outputs:config.outputs}),obs:{state,
      get connectionGeneration(){return generation},
      refresh:async()=>{
        const [stream,record]=await Promise.all([within(ws.call('GetStreamStatus')),within(ws.call('GetRecordStatus'))]);
        if(typeof stream.outputActive!=='boolean'||typeof record.outputActive!=='boolean')throw refused();
        state.streaming=stream.outputActive;state.recording=record.outputActive;state.streamingKnown=true;
      },
      outputs:async()=>{
        const result=await within(ws.call('GetOutputList'));
        if(!Array.isArray(result.outputs)||result.outputs.length>256||result.outputs.some(o=>
          !text(o.outputName,200)||typeof o.outputActive!=='boolean'||!o.outputFlags||
          typeof (o.outputFlags as Record<string,unknown>).OBS_OUTPUT_SERVICE!=='boolean'))throw refused();
        return result.outputs;
      },streamSuiteOutputs:()=>suite.inspect(),
    }};
  const get=async(url:string,authorization:string)=>{
    const response=await fetchApi(url,{method:'GET',redirect:'error',cache:'no-store',
      signal:AbortSignal.timeout(4500),headers:{Authorization:authorization,'Client-Id':config.twitch.clientId}});
    if(!response.ok)throw refused();
    const body=await response.text();if(body.length>65536)throw refused();return JSON.parse(body) as Record<string,unknown>;
  };
  const sample=async():Promise<MaintenanceOfflineWitness|undefined>=>{
    if(closed||!connected)return undefined;
    const before=now(),epoch=generation;
    try{
      const [safety,claim]=await Promise.all([assessRestartSafety(source),
        get('https://id.twitch.tv/oauth2/validate','OAuth '+config.twitch.accessToken)]);
      if(!safety.safe||claim.client_id!==config.twitch.clientId||claim.user_id!==config.twitch.broadcasterId||
        typeof claim.expires_in!=='number'||!Number.isFinite(claim.expires_in)||claim.expires_in<=5)throw refused();
      const streams=await get('https://api.twitch.tv/helix/streams?user_id='+config.twitch.broadcasterId+'&first=1',
        'Bearer '+config.twitch.accessToken);
      // Missing/malformed data is never inferred to mean offline.
      if(!Array.isArray(streams.data)||streams.data.length!==0)throw refused();
      const at=now();
      if(closed||!connected||epoch!==generation||!Number.isSafeInteger(at)||at<before||at-before>5000)throw refused();
      return {authority:'fixe-independent',session,observedAt:at,obs:'idle',twitch:'offline'};
    }catch{return undefined}
  };
  return {
    observe:()=>flight??=(sample().finally(()=>{flight=undefined})),
    async close(){closed=true;lost();await ws.disconnect().catch(()=>undefined)},
  };
}

/** The result contains only an admission boolean, never process command lines.
 * Checks known native runtimes and services in addition to the shared SQLite
 * ownership. Cannot certify arbitrary third-party/admin filesystem writers. */
export async function inspectWindowsMaintenanceWriters(packageRoot:string,profileRoot:string):Promise<boolean>{
  const local=(p:string)=>typeof p==='string'&&isAbsolute(p)&&/^[A-Za-z]:[\\/]/.test(p)&&
    !p.slice(2).includes(':')&&!/[\x00-\x1f]/.test(p);
  if(process.platform!=='win32'||!local(packageRoot)||!local(profileRoot))return false;
  const system=process.env.SystemRoot??'C:\\Windows';if(!local(system))return false;
  const encoded=Buffer.from(JSON.stringify([resolve(packageRoot),resolve(profileRoot)]),'utf8').toString('base64');
  const script=`$ErrorActionPreference='Stop';$roots=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))|ConvertFrom-Json;$busy=$false;foreach($p in @(Get-CimInstance Win32_Process)){if($p.ProcessId -eq ${process.pid}){continue};$native=$p.ExecutablePath;$cmd=$p.CommandLine;foreach($r in $roots){if(($native -and ($native.Equals($r,[StringComparison]::OrdinalIgnoreCase) -or $native.StartsWith($r+'\\',[StringComparison]::OrdinalIgnoreCase))) -or ($cmd -and $cmd.IndexOf($r,[StringComparison]::OrdinalIgnoreCase) -ge 0)){$busy=$true}};if($p.Name -match '^(StreamDashboard|StreamCockpit|electron|node)\\.exe$' -and !$native -and !$cmd){$busy=$true}};foreach($s in @(Get-CimInstance Win32_Service)){if($s.State -eq 'Stopped'){continue};foreach($r in $roots){if($s.PathName -and $s.PathName.IndexOf($r,[StringComparison]::OrdinalIgnoreCase) -ge 0){$busy=$true}};if($s.Name -match 'StreamCockpit|StreamDashboard' -and !$s.PathName){$busy=$true}};if($busy){'BUSY'}else{'CLEAR'}`;
  try{
    const result=await promisify(execFile)(join(system,'System32','WindowsPowerShell','v1.0','powershell.exe'),
      ['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],
      {shell:false,windowsHide:true,encoding:'utf8',timeout:10000,maxBuffer:4096});
    return result.stdout.trim()==='CLEAR';
  }catch{return false}
}
