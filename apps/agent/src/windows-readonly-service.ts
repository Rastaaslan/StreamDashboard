import OBSWebSocket from 'obs-websocket-js';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {observeObsHealth} from './read-only-observer.js';
import {runReadOnlyAgent} from './read-only-runner.js';
import {WindowsAgentSecretStore} from './windows-secret-store.js';

export type ReadOnlyMode='once'|'monitor';
export interface ProtectedObsCredentials {
  directory:string;
  optIn:'I_ACCEPT_CURRENT_USER_DPAPI';
}
function validateProtectedCredentials(options:ProtectedObsCredentials):void {
  if(options.optIn!=='I_ACCEPT_CURRENT_USER_DPAPI'||
     typeof options.directory!=='string'||!path.isAbsolute(options.directory)||
     options.directory.startsWith('\\')||options.directory.startsWith('//')||
     (process.platform==='win32'&&!/^[A-Za-z]:[\\/]/.test(options.directory)))
    throw Error('WINDOWS_DPAPI_CREDENTIAL_CONFIG_REQUIRED');
}
export interface ReadOnlyStartup {
  mode:ReadOnlyMode;
  deviceId:string;
  obsConfigPath:string;
  protectedCredentials?:ProtectedObsCredentials;
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
  let protectedCredentials:ProtectedObsCredentials|undefined;
  if(env.SD_AGENT_DPAPI_DIR!==undefined||env.SD_AGENT_DPAPI_OPT_IN!==undefined){
    protectedCredentials={directory:env.SD_AGENT_DPAPI_DIR??'',
      optIn:env.SD_AGENT_DPAPI_OPT_IN as ProtectedObsCredentials['optIn']};
    validateProtectedCredentials(protectedCredentials);
  }
  const mode=argv.includes('--monitor')?'monitor':'once';
  return {mode,deviceId,obsConfigPath:path.join(env.APPDATA,
    'obs-studio','plugin_config','obs-websocket','config.json'),
    ...(protectedCredentials?{protectedCredentials}:{})};
}
export interface LocalObsCredential {url:string;password:string}
/** Existing local OBS configuration supplies authentication state and port.
 * Explicit DPAPI mode uses only the provisioned obs_password credential, with
 * no plaintext fallback or automatic migration. Otherwise existing behavior
 * reads OBS's local password in memory only. No secret is printed/persisted.
 */
export async function loadLocalObsCredential(
  configFile:string,
  reader:typeof readFile=readFile,
  protectedCredentials?:ProtectedObsCredentials,
  openProtectedStore:(directory:string)=>Promise<{get(id:string):Promise<Buffer|null>}>=
    directory=>WindowsAgentSecretStore.open(directory,{optIn:'I_ACCEPT_CURRENT_USER_DPAPI'}),
):Promise<LocalObsCredential> {
  if(protectedCredentials)validateProtectedCredentials(protectedCredentials);
  let config:unknown;
  try{config=JSON.parse(await reader(configFile,'utf8'))}
  catch{throw Error('OBS_LOCAL_SETTINGS_UNAVAILABLE')}
  if(!config||typeof config!=='object'||Array.isArray(config))
    throw Error('OBS_CONFIG_UNQUALIFIED');
  const v=config as Record<string,unknown>;
  if(v.server_enabled!==true||v.auth_required!==true||
    typeof v.server_port!=='number'||!Number.isSafeInteger(v.server_port)||
    v.server_port<1024||v.server_port>65535)
    throw Error('OBS_CONFIG_UNQUALIFIED');
  const url='ws://127.0.0.1:'+v.server_port;
  if(protectedCredentials){
    let bytes:Buffer|null=null;
    try{
      const store=await openProtectedStore(protectedCredentials.directory);
      bytes=await store.get('obs_password');
      if(!Buffer.isBuffer(bytes)||bytes.length<1||bytes.length>65_536)
        throw Error('INVALID_PROTECTED_OBS_PASSWORD');
      const password=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
      if(!password.length)throw Error('INVALID_PROTECTED_OBS_PASSWORD');
      return {url,password};
    }catch{throw Error('WINDOWS_DPAPI_OBS_CREDENTIAL_UNAVAILABLE')}
    finally{if(Buffer.isBuffer(bytes))bytes.fill(0)}
  }
  if(typeof v.server_password!=='string'||v.server_password.length===0)
    throw Error('OBS_CONFIG_UNQUALIFIED');
  return {url,password:v.server_password};
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
  const obs=await loadLocalObsCredential(options.obsConfigPath,readFile,options.protectedCredentials);
  const client=new OBSWebSocket(),signal=new AbortController();
  const stop=()=>signal.abort();
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{
    try{await boundedConnect(client.connect(obs.url,obs.password,{eventSubscriptions:0}),6000)}
    finally{obs.password=''} // The OBS API needs a string; drop our reference promptly.
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
