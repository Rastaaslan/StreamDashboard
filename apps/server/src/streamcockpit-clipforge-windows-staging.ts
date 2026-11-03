import {createHash} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {lstat,open,readFile,realpath,statfs} from 'node:fs/promises';
import path from 'node:path';
import {CLIP_LIMITS} from '../../../packages/core/src/streamcockpit-clipforge-plan.js';
import type {SourceGrant} from './streamcockpit-clipforge-pipeline.js';
import {inspectWindowsClipPrivateRoot} from './streamcockpit-clipforge-windows-acl.js';
import {attestWindowsObsReplaySource} from './streamcockpit-clipforge-windows-replay-grant.js';

/** Host-only, inert source staging. No API, encoder or live command is exposed.
 * The caller owns the OBS witness and provisions a separate, trusted, already-
 * private NTFS root. A reserved job is NEVER retried, even after an error.
 * File fsync is NOT proof of directory-entry durability across power loss on NTFS.
 */
export type WindowsReplayStageResult =
  | {status:'STAGED_HOST_ONLY'; grant:SourceGrant}
  | {status:'DENIED'|'UNKNOWN';code:string};
type WitnessOptions=Parameters<typeof attestWindowsObsReplaySource>[0];
export type WindowsReplayStageOptions=WitnessOptions&{privateRoot:string;jobId:string};
const safeJob=/^[A-Za-z0-9_-]{1,64}$/;
const safeExtension=new Set(['.mp4','.mkv','.mov','.webm']);
const localDrive=(p:string)=>typeof p==='string'&&/^[A-Za-z]:[\\/]/.test(p)&&
  path.win32.isAbsolute(p)&&!p.startsWith('\\\\')&&!p.includes('\0');
const isWithin=(root:string,other:string)=>{
  const rel=path.win32.relative(root,other);
  return rel===''||(!rel.startsWith('..')&&!path.win32.isAbsolute(rel));
};
const errorCode=(e:unknown)=>{
  const message=e instanceof Error?e.message:'';
  return /^F04_STAGE_[A-Z_]+$/.test(message)?message.slice(10):'IO_UNAVAILABLE';
};
const deny=(code:string):never=>{throw Error('F04_STAGE_'+code);};
const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();

async function strictRoot(root:string):Promise<string>{
  if(!localDrive(root))deny('ROOT');
  const normalized=path.win32.normalize(root);
  let part=path.win32.parse(normalized).root;
  for(const segment of normalized.slice(part.length).split(/[\\/]/).filter(Boolean)){
    part=path.win32.join(part,segment);
    const stat=await lstat(part);
    if(!stat.isDirectory()||stat.isSymbolicLink())deny('ROOT');
  }
  if(!same(await realpath(normalized),normalized))deny('ROOT');
  return normalized;
}
function isAuthoritative(options:WitnessOptions):boolean{
  const s=options.snapshot(),w=options.witness;
  return Boolean(s?.connected&&s.streamingKnown&&s.streaming&&
    s.streamEpoch===w.streamEpoch&&s.connectionGeneration===w.connectionGeneration);
}

/** No grant, filename or path leaves this host-only method except a safe staged
 * relative alias and SHA-256. This is NOT an encode/export consent receipt.
 */
export async function stageWindowsObsReplay(options:WindowsReplayStageOptions):Promise<WindowsReplayStageResult>{
  let reservationAttempted=false;
  try{
    if(process.platform!=='win32')deny('WINDOWS_ONLY');
    if(!options||!safeJob.test(options.jobId))deny('JOB');
    if(options.signal?.aborted)deny('CANCELLED');
    if(!localDrive(options.sourceRoot)||!localDrive(options.savedReplayPath)||
      !localDrive(options.privateRoot))deny('ROOT');
    const sourceRoot=await strictRoot(options.sourceRoot);
    const privateRoot=await strictRoot(options.privateRoot);
    if(isWithin(sourceRoot,privateRoot)||isWithin(privateRoot,sourceRoot))
      deny('ROOT_OVERLAP');
    if(!inspectWindowsClipPrivateRoot(privateRoot).qualified)deny('ROOT_NOT_PRIVATE');
    const ext=path.win32.extname(options.savedReplayPath).toLowerCase();
    if(!safeExtension.has(ext))deny('SOURCE_FORMAT');
    // The witness is checked before reservation; its original absolute path is
    // deliberately neither serialized to intent nor returned to Android.
    const attestation=await attestWindowsObsReplaySource(options);
    if(attestation.status!=='VERIFIED_HOST_ONLY')throw Error('F04_STAGE_WITNESS');
    if(!(await options.hostEligible())||!isAuthoritative(options))deny('OBS_AUTHORITY');
    const relative=attestation.grant.relativePath;
    const source=path.win32.join(sourceRoot,...relative.split('/'));
    if(!same(path.win32.normalize(source),path.win32.normalize(options.savedReplayPath)))
      deny('SOURCE_CHANGED');
    const existing=await lstat(source);
    if(!existing.isFile()||existing.isSymbolicLink()||existing.nlink!==1||
      existing.size<=0||existing.size>CLIP_LIMITS.sourceBytes)deny('SOURCE_CHANGED');
    const destName=options.jobId+ext;
    const dest=path.win32.join(privateRoot,destName);
    const intent=path.win32.join(privateRoot,options.jobId+'.intent');
    for(const candidate of [intent,...Array.from(safeExtension,ext=>path.win32.join(privateRoot,options.jobId+ext))]){
      try{await lstat(candidate);return {status:'UNKNOWN',code:'EXISTING_JOB'};}
      catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')deny('INSPECTION_UNAVAILABLE');}
    }
    const space=await statfs(privateRoot);
    if(space.bavail*space.bsize<existing.size+1024*1024)deny('DISK');
    if(options.signal?.aborted)deny('CANCELLED');
    // Reserve BEFORE any destination snapshot write. Failed/partial fsync
    // after O_EXCL still leaves an uncertain intent and forbids retry.
    reservationAttempted=true;
    const intentBytes=JSON.stringify({schemaVersion:1,state:'UNKNOWN',
      stageFile:destName,sourceSha256:attestation.grant.sha256})+'\n';
    const intentFd=await open(intent,'wx',0o600);
    try{
      await intentFd.writeFile(intentBytes);
      await intentFd.sync();
    }finally{await intentFd.close();}
    // An intent is an immutable fail-closed reservation, not permission to
    // encode. Reject replacements, hardlinks or edits before and after copy.
    const verifyIntent=async()=>{
      const current=await lstat(intent);
      if(!current.isFile()||current.isSymbolicLink()||current.nlink!==1||
        current.size!==Buffer.byteLength(intentBytes)||
        await readFile(intent,'utf8')!==intentBytes)deny('INTENT_CHANGED');
    };
    await verifyIntent();
    if(!(await options.hostEligible())||!isAuthoritative(options))deny('OBS_AUTHORITY');
    const sourceFd=await open(source,'r');
    let destFd:Awaited<ReturnType<typeof open>>|undefined;
    try{
      const before=await sourceFd.stat();
      if(before.ino!==existing.ino||before.size!==existing.size||
        before.mtimeMs!==existing.mtimeMs||before.ctimeMs!==existing.ctimeMs||
        before.nlink!==1)deny('SOURCE_CHANGED');
      destFd=await open(dest,'wx',0o600);
      const hash=createHash('sha256'),buffer=Buffer.alloc(65536);
      // Bound host I/O to 8 MiB/s so even a large replay cannot saturate
      // the stream disk during an OBS session. No codec process is started.
      const started=performance.now(),bytesPerSecond=8*1024*1024;
      let total=0;
      while(total<before.size){
        if(options.signal?.aborted)deny('CANCELLED');
        const {bytesRead}=await sourceFd.read(buffer,0,Math.min(buffer.length,before.size-total),total);
        if(bytesRead===0)deny('SOURCE_CHANGED');
        hash.update(buffer.subarray(0,bytesRead));
        let written=0;
        while(written<bytesRead){
          if(options.signal?.aborted)deny('CANCELLED');
          const result=await destFd.write(buffer,written,bytesRead-written,null);
          if(result.bytesWritten<=0)deny('SOURCE_CHANGED');
          written+=result.bytesWritten;
        }
        total+=bytesRead;
        const pause=Math.ceil(total*1000/bytesPerSecond-(performance.now()-started));
        if(pause>0){
          try{await sleep(Math.min(pause,250),undefined,{signal:options.signal});}
          catch{deny('CANCELLED');}
        }
      }
      if(hash.digest('hex')!==attestation.grant.sha256)deny('SOURCE_CHANGED');
      const after=await sourceFd.stat();
      if(before.ino!==after.ino||before.size!==after.size||
        before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs||
        after.nlink!==1)deny('SOURCE_CHANGED');
      await destFd.sync();
    }finally{await destFd?.close();await sourceFd.close();}
    // A source swap during copying or ACL/OBS revocation cannot become success.
    const last=await lstat(source);
    if(last.ino!==existing.ino||last.size!==existing.size||
      last.mtimeMs!==existing.mtimeMs||last.ctimeMs!==existing.ctimeMs||
      last.nlink!==1)deny('SOURCE_CHANGED');
    if(!(await options.hostEligible())||!isAuthoritative(options))
      deny('OBS_AUTHORITY');
    if(!inspectWindowsClipPrivateRoot(privateRoot).qualified)deny('ROOT_NOT_PRIVATE');
    if(options.signal?.aborted)deny('CANCELLED');
    const staged=await lstat(dest);
    if(!staged.isFile()||staged.nlink!==1||staged.size!==existing.size)deny('SOURCE_CHANGED');
    if(!isAuthoritative(options))deny('OBS_AUTHORITY');
    await verifyIntent();
    return {status:'STAGED_HOST_ONLY',grant:{relativePath:destName,sha256:attestation.grant.sha256}};
  }catch(e){
    const code=errorCode(e);
    if(reservationAttempted)return {status:'UNKNOWN',code};
    return {status:'DENIED',code};
  }
}
