import OBSWebSocket from 'obs-websocket-js';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {observeObsHealth} from './read-only-observer.js';
import {runReadOnlyAgent} from './read-only-runner.js';

export type ReadOnlyMode='once'|'monitor';
export interface ReadOnlyStartup {
  mode:ReadOnlyMode;
  deviceId:string;
  obsConfigPath:string;
}
export function parseReadOnlyStartup(
  argv:readonly string[],env:NodeJS.ProcessEnv,
):ReadOnlyStartup {
  if(env.STREAMDASHBOARD_AGENT_READONLY_OPT_IN!=='I_ACCEPT_READ_ONLY')
    throw Error('EXPLICIT_READ_ONLY_OPT_IN_REQUIRED');
  if(argv.length!==2||!argv.includes('--use-local-obs-config')||
    !(argv.includes('--once')||argv.includes('--monitor')))
    throw Error('READ_ONLY_MODE_REQUIRED');
  const deviceId=env.STREAMDASHBOARD_AGENT_DEVICE_ID??'StreamAgentLocal';
  if(!/^[A-Za-z0-9_-]{1,96}$/.test(deviceId))
    throw Error('INVALID_AGENT_DEVICE_ID');
  if(!env.APPDATA)throw Error('WINDOWS_APPDATA_REQUIRED');
  const mode=argv.includes('--monitor')?'monitor':'once';
  return {mode,deviceId,obsConfigPath:path.join(env.APPDATA,
    'obs-studio','plugin_config','obs-websocket','config.json')};
}
export interface LocalObsCredential {url:string;password:string}
/** Reads OBS's already-configured local password in-process; never copies,
 * persists, prints or sends it anywhere except OBS loopback authentication.
 */
export async function loadLocalObsCredential(
  configFile:string,
  reader:typeof readFile=readFile,
):Promise<LocalObsCredential> {
  let config:unknown;
  try{config=JSON.parse(await reader(configFile,'utf8'))}
  catch{throw Error('OBS_LOCAL_SETTINGS_UNAVAILABLE')}
  if(!config||typeof config!=='object'||Array.isArray(config))
    throw Error('OBS_CONFIG_UNQUALIFIED');
  const v=config as Record<string,unknown>;
  if(v.server_enabled!==true||v.auth_required!==true||
    typeof v.server_port!=='number'||!Number.isSafeInteger(v.server_port)||
    v.server_port<1024||v.server_port>65535||
    typeof v.server_password!=='string'||v.server_password.length===0)
    throw Error('OBS_CONFIG_UNQUALIFIED');
  return {url:'ws://127.0.0.1:'+v.server_port,password:v.server_password};
}
function boundedConnect<T>(work:Promise<T>,timeoutMs=6000):Promise<T> {
  let timer:ReturnType<typeof setTimeout>;
  return Promise.race([
    work,
    new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(
      Error('OBS_CONNECTION_TIMEOUT')),timeoutMs)}),
  ]).finally(()=>clearTimeout(timer!));
}
async function sleep(ms:number,signal:AbortSignal):Promise<void> {
  if(signal.aborted)return;
  await new Promise<void>(resolve=>{
    const finish=()=>{clearTimeout(timer);signal.removeEventListener('abort',finish);resolve()};
    const timer=setTimeout(finish,ms);
    signal.addEventListener('abort',finish,{once:true});
  });
}
/** No API write methods exist on the injected client. */
export async function runReadOnlySession(
  options:{mode:ReadOnlyMode;deviceId:string;signal:AbortSignal;
    call(kind:'GetStats'|'GetStreamStatus'):Promise<unknown>;
    emit(data:unknown):void;diagnostic(code:string):void},
):Promise<void> {
  if(options.mode==='once') {
    const snapshot=await boundedConnect(
      observeObsHealth({call:options.call},options.deviceId,1,Date.now()),4000);
    if(options.signal.aborted)throw Error('OBS_READ_ABORTED');
    options.emit(snapshot);
    return;
  }
  await runReadOnlyAgent({
    client:{call:options.call},
    deviceId:options.deviceId,signal:options.signal,now:Date.now,
    sleep,
    emit:options.emit,reportUnreachable:options.diagnostic,
    readTimeoutMs:3000,
  });
}
export async function main(
  argv:readonly string[]=process.argv.slice(2),
  env:NodeJS.ProcessEnv=process.env,
):Promise<void> {
  const options=parseReadOnlyStartup(argv,env);
  const obs=await loadLocalObsCredential(options.obsConfigPath);
  const client=new OBSWebSocket(),signal=new AbortController();
  const stop=()=>signal.abort();
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{
    await boundedConnect(client.connect(obs.url,obs.password,{eventSubscriptions:0}),6000);
    client.on('ConnectionClosed',stop);
    await runReadOnlySession({
      mode:options.mode,deviceId:options.deviceId,signal:signal.signal,
      call:kind=>client.call(kind),
      emit:data=>process.stdout.write(JSON.stringify(data)+'\n'),
      diagnostic:code=>process.stderr.write(code+'\n'),
    });
  }catch{
    // Do not include library errors: they may echo the credential or URL.
    process.stderr.write('READ_ONLY_AGENT_OBS_UNAVAILABLE\n');
    process.exitCode=1;
  }finally{
    signal.abort();
    process.off('SIGINT',stop);process.off('SIGTERM',stop);
    try{await client.disconnect()}catch{}
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  main().catch(()=>{process.stderr.write('READ_ONLY_AGENT_START_FAILED\n');process.exitCode=1});
}
