import {createInterface} from 'node:readline';
import {basename,dirname,join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {startWithRuntimeUpgradeOwnership} from '../../apps/desktop/src/streamcockpit-runtime-ownership.js';
import {SqliteUpgradeJournal} from '../../apps/desktop/src/streamcockpit-upgrade-journal.js';

const [mode,argument]=process.argv.slice(2),root=resolve(argument??'');
if(dirname(root)!==resolve(tmpdir())||!basename(root).startsWith('sc3-runtime-ownership-'))
  throw Error('TEST_WORKSPACE_REQUIRED');
const directory=join(root,'journal');
// No real profile, OBS transport, account or external HTTP can be used here.
process.env.DATA_FILE=join(root,'data','dashboard.json');
globalThis.fetch=async()=>{throw Error('EXTERNAL_NETWORK_FORBIDDEN')};
const lines=createInterface({input:process.stdin});
let release!:()=>void;
const done=new Promise<void>(resolve=>{release=resolve});
let closeRuntime:()=>Promise<void>=async()=>undefined;
if(mode==='maintenance'){
  await new SqliteUpgradeJournal(directory).exclusive(async()=>{
    console.log('READY');
    for await(const line of lines){if(line==='crash')process.exit(71);break}
  });
}else if(mode==='fail-start'||mode==='fail-stop'){
  try{
    const runtime=await startWithRuntimeUpgradeOwnership(directory,'2.1.0',async()=>{
      if(mode==='fail-start')throw Error('SYNTHETIC_START_FAILURE');
      return {stop:async()=>{throw Error('SYNTHETIC_STOP_FAILURE')}};
    });
    await runtime.stop();
  }catch{console.log('FAILED_HELD')}
  for await(const _line of lines)break;
}else{
  const {startDashboardServer}=await import('../../apps/server/src/index.js');
  const {MemorySecretStore}=await import('../../apps/server/src/storage.js');
  const runtime=await startWithRuntimeUpgradeOwnership(directory,'2.1.0',async()=>{
    const server=await startDashboardServer({dataDir:join(root,'data'),port:0,host:'127.0.0.1',
      obsEnabled:false,timerAuthority:false,remoteEnabled:false,secretStore:new MemorySecretStore(),
      twitchClientId:'',googleClientId:'',logger:{info(){},warn(){},error(){}}});
    await server.providersReady;
    return {url:server.url,stop:async()=>{await server.stop();console.log('DRAINED');await done}};
  });
  closeRuntime=()=>runtime.stop();
  console.log('READY '+runtime.url);
  let stopping:Promise<void>|undefined;
  for await(const line of lines){
    if(line==='crash')process.exit(71);
    if(line==='stop'){stopping=runtime.stop();continue}
    if(line==='release'){release();await(stopping??runtime.stop());console.log('RELEASED');break}
  }
  release();await closeRuntime();
}
lines.close();process.stdin.destroy();
