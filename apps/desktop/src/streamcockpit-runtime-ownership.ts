import {createHash} from 'node:crypto';
import {isAbsolute,join,resolve,sep} from 'node:path';
import {SqliteUpgradeJournal} from './streamcockpit-upgrade-journal.js';

const failure=(code:string)=>new Error('SC3_RUNTIME_UPGRADE_'+code);
const canonical=(value:string)=>process.platform==='win32'?resolve(value).toLowerCase():resolve(value);
function localRoot(value:string){
  if(typeof value!=='string'||!isAbsolute(value)||value.includes('\0')||
    (process.platform==='win32'&&(!/^[A-Za-z]:[\\/]/.test(value)||value.slice(2).includes(':'))))
    throw failure('PATH_INVALID');
  return resolve(value);
}
/** Stable for the root profile, NOT the controller sub-profile or app version.
 * Outside both rollback data and versioned application files. An external
 * maintenance caller must use this same directory, never an independent mutex.
 */
export function runtimeUpgradeDirectory(applicationData:string,profileRoot:string):string{
  const base=localRoot(applicationData),profile=localRoot(profileRoot);
  const result=join(base,'StreamCockpit-maintenance',
    createHash('sha256').update(canonical(profile)).digest('hex'));
  const a=canonical(result),b=canonical(profile);
  if(a===b||a.startsWith(b+sep)||b.startsWith(a+sep))throw failure('ROOTS_OVERLAP');
  return result;
}

/** Hold the EXISTING cross-process upgrade mutex for the entire runtime life.
 * No polling, PID inference, stale-lock deletion or updater activation. Opening
 * the runtime and every accepted writer precede neither admission nor journal
 * inspection. The lease is released only after the full stop promise succeeds.
 *
 * A failed acquisition after entering start(), or a failed stop(), keeps the
 * lease until process exit: cleanup was not proven. OS process exit releases
 * the SQLite mutex, but never removes any pending upgrade intent. Callers must
 * still independently establish live safety, signer trust and readback.
 */
export function startWithRuntimeUpgradeOwnership<T extends {stop():Promise<void>}>(
  directory:string,version:string,start:()=>Promise<T>,
):Promise<T>{
  if(!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version))
    return Promise.reject(failure('VERSION_INVALID'));
  const store=new SqliteUpgradeJournal(directory);
  let release!:()=>void;
  const lifetime=new Promise<void>(resolve=>{release=resolve});
  let acquired!:(runtime:T)=>void,refused!:(reason:unknown)=>void;
  const ready=new Promise<T>((resolve,reject)=>{acquired=resolve;refused=reject});
  const holding=store.exclusive(async()=>{
    const journal=await store.read();
    if(journal){
      if(journal.pending)throw failure('RECOVERY_REQUIRED');
      const expected=journal.installed&&!journal.rolledBack?journal.manifest.version:journal.manifest.fromVersion;
      if(version!==expected)throw failure('VERSION_MISMATCH');
    }
    let runtime:T;
    try{runtime=await start()}
    catch{
      // No clean shutdown capability was returned. Do not advertise an idle
      // installation if partially acquired writers might still be alive.
      refused(failure('START_UNCERTAIN'));
      await lifetime;
      return;
    }
    const stopRuntime=runtime.stop.bind(runtime);
    let stopping:Promise<void>|undefined;
    acquired({...runtime,stop:()=>stopping??=(async()=>{
      await stopRuntime();
      release();
      await holding;
    })()});
    await lifetime;
  });
  void holding.catch(refused);
  return ready;
}
