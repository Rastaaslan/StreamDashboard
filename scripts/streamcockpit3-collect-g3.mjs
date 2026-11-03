import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
const arg=name=>{const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:undefined};
const url=new URL(arg('--url')||'http://127.0.0.1:48133');
if(url.username||url.password||url.pathname!=='/'||url.search||url.hash||
  !(url.protocol==='https:'||url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))throw Error('G3_DIAGNOSTIC_ORIGIN_INVALID');
const credential=process.env.SC3_G3_DEVICE_CREDENTIAL;
const diagnostics={schemaVersion:1,kind:'streamcockpit-g3-observation',checkedAt:new Date().toISOString(),
  sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:resolve(import.meta.dirname,'..'),encoding:'utf8',windowsHide:true}).trim(),
  origin:url.origin,hardwareQualification:false,readings:[]};
for(const path of ['/api/v1/health','/api/v2/device','/api/v1/state']){
  const entry={path,status:'unavailable'};
  try{
    const response=await fetch(new URL(path,url),{method:'GET',redirect:'error',signal:AbortSignal.timeout(8000),headers:credential?{Authorization:'Device '+credential}:{}});
    entry.httpStatus=response.status;
    if(response.ok){
      const data=await response.json();entry.status='observed';
      if(path==='/api/v2/device')entry.value={id:data.device?.id,platform:data.device?.platform,roles:data.device?.roles,obsConnected:data.observed?.obsConnected};
      else if(path==='/api/v1/state')entry.value={mode:data.mode,timer:{running:data.timer?.running,duration:data.timer?.duration,remaining:data.timer?.remaining,deadline:data.timer?.deadline},obs:{connected:data.obs?.connected,streaming:data.obs?.streaming,streamingKnown:data.obs?.streamingKnown},twitch:{connected:data.twitch?.connected},planningCount:Array.isArray(data.planning)?data.planning.length:undefined};
      else entry.value={ok:data.ok,version:data.version};
    }
  }catch{entry.status='unavailable'}
  diagnostics.readings.push(entry);
}
const output=resolve(arg('--out')||'out/sc3-g3/observation.json');await mkdir(dirname(output),{recursive:true});
await writeFile(output,JSON.stringify(diagnostics,null,2)+'\n',{flag:'wx'});
console.log('Read-only G3 observations saved: '+output+'; no hardware PASS inferred.');
