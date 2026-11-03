import {createHash} from 'node:crypto';
import {lstat,open,realpath} from 'node:fs/promises';
import path from 'node:path';
import {CLIP_LIMITS} from '../../../packages/core/src/streamcockpit-clipforge-plan.js';
import type {SourceGrant} from './streamcockpit-clipforge-pipeline.js';

export interface TrustedObsReplayWitness {
  sourceEventId:string;
  observedAt:number;
  connectionGeneration:number;
  streamEpoch:number;
}
export interface ReplaySourceAuthority {
  connected:boolean; streamingKnown:boolean; streaming:boolean;
  connectionGeneration:number; streamEpoch:number;
}
export type ReplaySourceAttestation =
  | {status:'VERIFIED_HOST_ONLY';grant:SourceGrant}
  | {status:'DENIED';code:string};
const eventId=/^obs_replay_[a-f0-9]{64}$/;
// OBS uses user-facing replay filenames (often spaces/accented characters).
// Keep their literal HMAC-bound spelling host-only; the staging step maps
// them to a restricted ASCII alias before any ClipForge SourceGrant is used.
const invalidNameChars=new Set(['<','>','\"','/','|','?','*',':',String.fromCharCode(92)]);
const reservedNames=new Set(['CON','PRN','AUX','NUL',...Array.from({length:9},(_,i)=>'COM'+(i+1)),
  ...Array.from({length:9},(_,i)=>'LPT'+(i+1))]);
const safePart=(p:string)=>p.length>0&&p.length<=255&&
  !Array.from(p).some(c=>c.charCodeAt(0)<32||invalidNameChars.has(c))&&
  !p.endsWith('.')&&!p.endsWith(' ')&&!reservedNames.has(p.split('.')[0].toUpperCase());
const deny=(code:string):never=>{throw Error('F04_SOURCE_'+code);};
const fixedDrive=(p:string)=>typeof p==='string'&&/^[A-Za-z]:[\\/]/.test(p)&&
  path.win32.isAbsolute(p)&&!p.startsWith('\\\\')&&!p.includes('\0');
const equal=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();

/** Host-only, read-only witness verification; NEVER a production encode permission.
 * The caller MUST be the FIXE OBS adapter, with an HMAC event-id verifier
 * bound to its private per-runtime salt. Neither path nor grant goes to Android.
 * File/path metadata is rechecked after awaits, but NTFS has no descriptor-
 * relative open chain here: the eventual staging adapter MUST pin and hash again.
 */
export async function attestWindowsObsReplaySource(options:{
  sourceRoot:string; savedReplayPath:string; witness:TrustedObsReplayWitness;
  verifyObsEventId:(path:string,id:string)=>boolean;
  snapshot:()=>ReplaySourceAuthority;
  hostEligible:()=>Promise<boolean>;
  signal?:AbortSignal;
}):Promise<ReplaySourceAttestation>{
  try {
    if(process.platform!=='win32')deny('WINDOWS_ONLY');
    const w=options?.witness;
    if(!w||!eventId.test(w.sourceEventId)||
      !Number.isSafeInteger(w.observedAt)||w.observedAt<0||
      !Number.isSafeInteger(w.connectionGeneration)||w.connectionGeneration<0||
      !Number.isSafeInteger(w.streamEpoch)||w.streamEpoch<0)deny('WITNESS');
    const authoritative=()=>{
      const s=options.snapshot();
      return Boolean(s&&s.connected&&s.streamingKnown&&s.streaming&&
        s.connectionGeneration===w.connectionGeneration&&s.streamEpoch===w.streamEpoch);
    };
    if(!authoritative())deny('OBS_AUTHORITY');
    if(!fixedDrive(options.sourceRoot)||!fixedDrive(options.savedReplayPath))deny('SOURCE_PATH');
    const root=path.win32.normalize(options.sourceRoot);
    const source=path.win32.normalize(options.savedReplayPath);
    const relative=path.win32.relative(root,source);
    if(!relative||path.win32.isAbsolute(relative)||relative.startsWith('..')||
      relative.length>512||!relative.split(/[\\/]/).every(p=>safePart(p)))
      deny('SOURCE_PATH');
    // A host-local HMAC check is essential: a valid-looking event id alone
    // never authorizes arbitrary filenames or paths supplied by a client.
    if(typeof options.verifyObsEventId!=='function'||
      !options.verifyObsEventId(options.savedReplayPath,w.sourceEventId))deny('EVENT_BINDING');
    if(!(await options.hostEligible())||!authoritative())deny('OBS_AUTHORITY');
    const walk=async(file:string,expectFile:boolean)=>{
      let current=path.win32.parse(file).root;
      const parts=file.slice(current.length).split(/[\\/]/).filter(Boolean);
      for(const [i,part] of parts.entries()){
        current=path.win32.join(current,part);
        const s=await lstat(current);
        if(s.isSymbolicLink()||
          (i===parts.length-1&&expectFile?!s.isFile():!s.isDirectory()))
          deny('SOURCE_PATH');
      }
      if(!equal(await realpath(file),file))deny('SOURCE_PATH');
    };
    await walk(root,false);
    await walk(source,true);
    const fd=await open(source,'r');
    let initial:Awaited<ReturnType<typeof fd.stat>>;
    let digest:string;
    try {
      initial=await fd.stat();
      if(!initial.isFile()||initial.nlink!==1||initial.size<=0||
        initial.size>CLIP_LIMITS.sourceBytes)deny('SOURCE_LIMIT');
      const hash=createHash('sha256'),buffer=Buffer.alloc(65536);
      let bytes=0;
      while(bytes<initial.size){
        if(options.signal?.aborted)deny('CANCELLED');
        const {bytesRead}=await fd.read(buffer,0,Math.min(buffer.length,initial.size-bytes),bytes);
        if(bytesRead===0)deny('SOURCE_CHANGED');
        hash.update(buffer.subarray(0,bytesRead));bytes+=bytesRead;
      }
      digest=hash.digest('hex');
      const after=await fd.stat();
      if(initial.ino!==after.ino||initial.size!==after.size||initial.mtimeMs!==after.mtimeMs||
        initial.ctimeMs!==after.ctimeMs||after.nlink!==1)deny('SOURCE_CHANGED');
    } finally {await fd.close();}
    if(!(await options.hostEligible())||!authoritative())deny('OBS_AUTHORITY');
    await walk(root,false);await walk(source,true);
    const last=await lstat(source);
    if(last.ino!==initial.ino||last.size!==initial.size||last.mtimeMs!==initial.mtimeMs||
      last.ctimeMs!==initial.ctimeMs||last.nlink!==1)deny('SOURCE_CHANGED');
    if(options.signal?.aborted)deny('CANCELLED');
    return {status:'VERIFIED_HOST_ONLY',grant:{relativePath:relative.replace(/\\/g,'/'),sha256:digest}};
  } catch(error) {
    const text=error instanceof Error?error.message:'';
    return {status:'DENIED',code:/^F04_SOURCE_[A-Z_]+$/.test(text)?text.slice(11):'INSPECTION_UNAVAILABLE'};
  }
}
