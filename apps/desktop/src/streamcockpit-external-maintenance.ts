import {isAbsolute,resolve,join} from 'node:path';
import {inspectWindowsAuthenticode,windowsApplicationEntry,windowsVersionMatches} from './streamcockpit-windows-authenticode.js';
import {runtimeUpgradeDirectory} from './streamcockpit-runtime-ownership.js';
import type {SignedDirectoryUpgradeOptions} from './streamcockpit-upgrade-signed-preparation.js';
import {createSignedWindowsUpgradePlanner} from './streamcockpit-upgrade-squirrel.js';
import {verifyUpgradeReadbackFiles} from './streamcockpit-upgrade-readback.js';
import type {RestartSafety} from './restart-safety.js';
import type {UpgradePhase} from '../../../packages/core/src/streamcockpit-upgrade.js';

/** External (non-Electron) preparation/maintenance integration. No CLI, updater,
 * process killer, account lookup, OBS command or automatic installation. The
 * caller MUST be a separately trusted installer, outside the replaced image.
 * This module is intentionally not reachable from an IPC, HTTP or autoUpdater.
 */
export interface MaintenanceOfflineWitness {
  authority:'fixe-independent'; session:string; observedAt:number;
  obs:'idle'|'live'|'unknown'; twitch:'offline'|'live'|'unknown';
}
export interface MaintenanceSignerWitness {
  status:'valid'|'invalid'|'unknown'; signer:string; path:string; observedAt:number;
  /** Present on the native adapter: hash of the bytes held during verification. */
  sha256?:string;version?:string;
}
export interface ExternalMaintenanceDependencies {
  /** Independent observer, NOT a disconnected DashboardServer false/live flag. */
  observeOffline():Promise<MaintenanceOfflineWitness|undefined>;
  /** Actual OS trust adapter must verify Authenticode and its certificate chain. */
  verifyNativeSigner?(path:string):Promise<MaintenanceSignerWitness|undefined>;
  /** Explicit authorization, bound to THIS exact release and action. */
  authorize(action:'install'|'rollback',releaseId:string):Promise<boolean>;
  /** OS process/service check, in addition to the shared SQLite mutex. */
  noOtherWriters():Promise<boolean>;
  assessRestartSafety():Promise<RestartSafety>;
  now?():number;
}
export interface ExternalMaintenanceRequest {
  action:'prepare'|'install'|'rollback';
  applicationData:string;
  rootUserData:string;
  options:SignedDirectoryUpgradeOptions;
}
export interface ExternalMaintenanceResult {
  phase:UpgradePhase;pending:boolean;installed:boolean;rolledBack:boolean;
}
const fail=(code:string):never=>{throw new Error('SC3_EXTERNAL_MAINTENANCE_'+code)};
const canonical=(s:string)=>resolve(s).toLowerCase();
const goodRoot=(s:string)=>typeof s==='string'&&isAbsolute(s)&&
  /^[a-zA-Z]:[\\/]/.test(s)&&!s.slice(2).includes(':')&&!s.includes('\0');
/** Validate exact root bindings before any journal initialization or copy. */
function validateRoots(request:ExternalMaintenanceRequest):string{
  if(process.platform!=='win32'||!request||!['prepare','install','rollback'].includes(request.action))
    fail('WINDOWS_ONLY');
  if(!goodRoot(request.applicationData)||!goodRoot(request.rootUserData))fail('PATH_INVALID');
  const o=request.options;
  if(!o||!goodRoot(o.journalDirectory)||!goodRoot(o.profileRoot)||!goodRoot(o.sourcePackage))
    fail('PATH_INVALID');
  const expected=runtimeUpgradeDirectory(request.applicationData,request.rootUserData);
  if(canonical(expected)!==canonical(o.journalDirectory)||canonical(o.profileRoot)!==canonical(request.rootUserData))
    fail('COORDINATOR_OR_PROFILE_MISMATCH');
  if(canonical(o.sourcePackage)===canonical(o.packageRoot)||canonical(o.sourcePackage)===canonical(o.profileRoot))
    fail('SOURCE_IS_INSTALLED');
  return expected;
}
const validWitness=(w:MaintenanceOfflineWitness|undefined,now:number)=>
  w?.authority==='fixe-independent'&&typeof w.session==='string'&&w.session.length>0&&
  w.session.length<=128&&Number.isSafeInteger(w.observedAt)&&w.observedAt<=now&&
  now-w.observedAt<=5000&&w.obs==='idle'&&w.twitch==='offline';
const validSigner=(w:MaintenanceSignerWitness|undefined,source:string,signer:string,now:number)=>
  w?.status==='valid'&&typeof w.path==='string'&&typeof w.signer==='string'&&
  /^[a-f0-9]{40}$/i.test(w.signer)&&canonical(w.path)===canonical(source)&&
  w.signer.toUpperCase()===signer.toUpperCase()&&
  Number.isSafeInteger(w.observedAt)&&w.observedAt<=now&&now-w.observedAt<=5000;

/** One explicit external maintenance request. The SQLite planner commits every
 * intent and excludes cooperating Desktop processes. Any lost acknowledgement
 * remains pending; no callback, provider action or rename is ever retried here.
 * Publisher Ed25519 validation is additionally performed inside the planner.
 */
export async function runExternalWindowsMaintenance(
  request:ExternalMaintenanceRequest,deps:ExternalMaintenanceDependencies,
):Promise<ExternalMaintenanceResult>{
  validateRoots(request);
  if(!deps||!['observeOffline','authorize','noOtherWriters','assessRestartSafety']
    .every(key=>typeof deps[key as keyof ExternalMaintenanceDependencies]==='function'))
    fail('PROOF_ADAPTER_MISSING');
  // Detach data contracts but preserve executable proof callbacks (functions
  // cannot be structured-cloned, and are never taken from a signed manifest).
  const o={...request.options,
    manifest:structuredClone(request.options.manifest),
    target:structuredClone(request.options.target),rollback:structuredClone(request.options.rollback),
    image:structuredClone(request.options.image),trust:structuredClone(request.options.trust)};
  const now=deps.now??Date.now;
  const observe=async()=>{
    const sample=await deps.observeOffline();
    if(!validWitness(sample,now()))fail('LIVE_OR_UNKNOWN');
    return sample!;
  };
  const noWriters=async()=>{
    if(await deps.noOtherWriters()!==true)fail('WRITERS_NOT_QUIESCED');
    await observe();
    return true;
  };
  // Fail before writing the first SQLite intent when any witness is unavailable.
  const first=await observe();
  await noWriters();
  // A rollback must remain possible after the NEW release download/source has
  // disappeared. Prove the immutable OLD backup instead; never waive signer or
  // byte evidence merely because recovery was requested.
  const sourceRoot=request.action==='rollback'?o.backupPackage:o.sourcePackage;
  const sourceFiles=request.action==='rollback'?o.rollback.packageFiles:o.image.packageFiles;
  const sourceSigner=request.action==='rollback'?o.rollback.identity.signer:o.trust.windowsSigner;
  const application=windowsApplicationEntry(sourceFiles);
  const binary=join(sourceRoot,application.path);
  const native=await (deps.verifyNativeSigner??inspectWindowsAuthenticode)(binary);
  if(!validSigner(native,binary,sourceSigner,now()))fail('NATIVE_SIGNER_UNVERIFIED');
  if(native?.sha256!==undefined&&native.sha256!==application.sha256)fail('SIGNED_SOURCE_CHANGED');
  const sourceVersion=request.action==='rollback'?o.rollback.identity.version:o.image.identity.version;
  if(native?.version!==undefined&&!windowsVersionMatches(native.version,sourceVersion))fail('NATIVE_VERSION_MISMATCH');
  if(!await verifyUpgradeReadbackFiles(sourceRoot,sourceFiles))fail('SIGNED_SOURCE_CHANGED');
  if(!await deps.assessRestartSafety().then(x=>x.safe===true,()=>false))
    fail('RESTART_NOT_SAFE');
  // Authenticate the complete publisher manifest BEFORE asking the operator
  // for any install/rollback consent: a forged release must never get a prompt.
  // The planner reads only this prevalidated snapshot; retaining runtimeStopped
  // rechecks closes admission before each file swap, not just at preflight.
  o.runtimeStopped=noWriters;
  const planner=createSignedWindowsUpgradePlanner(o,{
    assessRestartSafety:async()=>{
      await noWriters();
      const safety=await deps.assessRestartSafety();
      if(safety.safe!==true)fail('RESTART_NOT_SAFE');
      return safety;
    },
  });
  if(request.action!=='prepare' && await deps.authorize(request.action,o.manifest.id)!==true)
    fail('OPERATOR_CONSENT_MISSING');
  // Explicit action only: preparation does not install, install never follows
  // a prior uncertain intent blindly, rollback must have a committed backup.
  await planner.register(o.manifest,o.sourcePackage);
  const result=request.action==='prepare'?await planner.prepare():
    request.action==='install'?await planner.install():await planner.rollback();
  const last=await observe();
  if(first.session!==last.session||last.observedAt<first.observedAt)fail('AUTHORITY_CHANGED');
  return {phase:result.phase,pending:Boolean(result.pending),installed:result.installed,rolledBack:result.rolledBack};
}
