import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {resolve} from 'node:path';
import {windowsDistribution} from './streamcockpit-windows-distribution.js';
import {readPreparedMaintenanceRequest,verifyMaintenanceCarrier,type MaintenanceEnvelope,type PreparedMaintenanceRequest} from './streamcockpit-maintenance-cli.js';
import type {DirectoryReleaseTrust} from './streamcockpit-upgrade-signed-preparation.js';
import {validateMaintenanceObserverConfiguration,type MaintenanceObserverInput as MaintenanceObserverConfiguration} from './streamcockpit-maintenance-observer.js';

export interface InstalledMaintenanceContext {applicationData:string;rootUserData:string;packageRoot:string;version:string}
const same=(a:string,b:string)=>resolve(a).toLowerCase()===resolve(b).toLowerCase();
const fail=(code:string)=>new Error('SC3_MAINTENANCE_LAUNCH_'+code);
/** Native UI preparation only: no shutdown, process launch or profile write. */
export async function prepareNativeMaintenanceLaunch(file:string,trust:DirectoryReleaseTrust,current:InstalledMaintenanceContext){
 if(await windowsDistribution(current.packageRoot)!=='directory')throw fail('SQUIRREL_REQUIRES_NATIVE_DISTRIBUTION');
 const request=await readPreparedMaintenanceRequest(file,trust),o=request.options;
 if(!same(request.applicationData,current.applicationData)||!same(request.rootUserData,current.rootUserData)||
  !same(o.packageRoot,current.packageRoot)||
  (request.action==='rollback'?o.manifest.version:o.manifest.fromVersion)!==current.version)throw fail('INSTALLED_TARGET_MISMATCH');
 const carrier=await verifyMaintenanceCarrier(request);
 const {runtimeStopped:_runtimeStopped,attestInstalled:_attestInstalled,trust:policy,now:_now,...options}=o;
 const prepared:PreparedMaintenanceRequest={action:request.action,applicationData:request.applicationData,
  rootUserData:request.rootUserData,options};
 let used=false;
 return {action:request.action,releaseId:o.manifest.id,version:o.manifest.version,fromVersion:o.manifest.fromVersion,
  /** Only call AFTER the native operator has confirmed this exact action. The
   * helper waits for this process to EXIT; ready is NOT an install receipt. */
  async launch(input:MaintenanceObserverConfiguration){
   if(used)throw fail('ALREADY_REQUESTED');
   const observer=validateMaintenanceObserverConfiguration(input);
   // Re-read the signed carrier immediately before creating its process.
   await verifyMaintenanceCarrier(request);if(used)throw fail('ALREADY_REQUESTED');used=true;
   const environment:NodeJS.ProcessEnv={ELECTRON_RUN_AS_NODE:'1',NODE_NO_WARNINGS:'1'};
   for(const key of Object.keys(process.env))if(/^(SystemRoot|windir|TEMP|TMP|PATH|PATHEXT|COMSPEC|PROCESSOR_ARCHITECTURE)$/i.test(key))
    environment[key]=process.env[key];
   const child=spawn(carrier.executable,[carrier.script,'--stdio-v1'],{
    cwd:carrier.directory,env:environment,shell:false,windowsHide:true,detached:true,stdio:['pipe','pipe','pipe'],
   }) as ChildProcessWithoutNullStreams;
   child.stderr.resume(); // Provider and OS diagnostics must never be forwarded.
   const envelope:MaintenanceEnvelope={schemaVersion:1,request:prepared,trust:policy,observer,
    parentPid:process.pid,consent:{action:request.action,releaseId:o.manifest.id},
    ...(!o.profileMigration?{captureStoppedProfile:true as const}:{})};
   let ready=false,settled=false,buffer='';
   const cancel=()=>{if(!settled){settled=true;child.kill();}};
   try{
    await new Promise<void>((resolve,reject)=>{
     const timer=setTimeout(()=>{cancel();reject(fail('HELPER_NOT_READY'))},60000);
     const rejectSafe=()=>{clearTimeout(timer);reject(fail('HELPER_NOT_READY'))};
     child.once('error',rejectSafe);child.once('exit',()=>{if(!ready)rejectSafe()});
     child.stdout.on('data',(chunk:Buffer)=>{
      if(ready)return;buffer+=chunk.toString('utf8');if(buffer.length>8192){cancel();rejectSafe();return}
      const end=buffer.indexOf('\n');if(end<0)return;
      try{const value=JSON.parse(buffer.slice(0,end));
       if(value.kind!=='ready'||value.releaseId!==o.manifest.id){cancel();rejectSafe();return}
       ready=true;clearTimeout(timer);resolve();
      }catch{cancel();rejectSafe()}
     });
     child.stdin.once('error',rejectSafe);
     child.stdin.end(JSON.stringify(envelope));
    });
    return {cancel,
     /** Transfer observation to the already-ready child, then quit normally.
      * No quitAndInstall, forced termination of the old app or OBS command. */
     handoff(){if(settled||!ready||child.exitCode!==null||child.signalCode!==null)throw fail('HELPER_NOT_READY');settled=true;
      child.stdout.resume();child.unref();
     }};
   }catch{cancel();throw fail('HELPER_NOT_READY')}
  }};
}
