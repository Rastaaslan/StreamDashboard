import OBSWebSocket from 'obs-websocket-js';
import { pathToFileURL } from 'node:url';
import { runReadOnlyAgent } from './read-only-runner.js';
import { requireLoopbackObsUrl } from './read-only-observer.js';
/** Developer-only observer executable. No Electron, no remote listener and no OBS mutation. */
export interface AgentReadOnlyCliConfig { deviceId: string; obsUrl: string; password: string }
export function readOnlyCliConfig(env: NodeJS.ProcessEnv): AgentReadOnlyCliConfig {
  const deviceId=env.STREAMDASHBOARD_AGENT_DEVICE_ID||'';
  if(!/^[A-Za-z0-9_-]{1,96}$/.test(deviceId)) throw new Error('AGENT_DEVICE_ID_REQUIRED');
  const password=env.STREAMDASHBOARD_AGENT_OBS_PASSWORD;
  if(typeof password!=='string'||!password.length)throw new Error('OBS_PASSWORD_REQUIRED');
  return {deviceId,obsUrl:requireLoopbackObsUrl(env.STREAMDASHBOARD_AGENT_OBS_URL||'ws://127.0.0.1:4455'),password};
}
async function main() {
  const config=readOnlyCliConfig(process.env);
  const client=new OBSWebSocket();
  const stop=new AbortController();
  const halt=()=>stop.abort();
  process.once('SIGINT',halt);process.once('SIGTERM',halt);
  try{
    await client.connect(config.obsUrl,config.password,{eventSubscriptions:0});
    client.on('ConnectionClosed',halt);
    await runReadOnlyAgent({
      client:{call:kind=>client.call(kind)},
      deviceId:config.deviceId,signal:stop.signal,now:Date.now,
      sleep:(ms,signal)=>new Promise<void>(resolve=>{
        if(signal.aborted)return resolve();
        const timer=setTimeout(()=>{signal.removeEventListener('abort',onAbort);resolve()},ms);
        function onAbort(){clearTimeout(timer);resolve()}
        signal.addEventListener('abort',onAbort,{once:true});
      }),
      emit:observation=>{process.stdout.write(JSON.stringify(observation)+'\n')},
      reportUnreachable:reason=>{process.stderr.write(reason+'\n')},
    });
  }finally{
    process.off('SIGINT',halt);process.off('SIGTERM',halt);
    try{await client.disconnect()}catch{}
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  main().catch(()=>{process.stderr.write('OBS_AGENT_CONNECT_OR_RUNTIME_FAILURE\n');process.exitCode=1});
}

[executed on device: dam-server (ee881f3f-7909-4993-a915-04a1d994f366)]