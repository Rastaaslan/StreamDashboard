import { constants, createReadStream } from 'node:fs';
import { open, mkdir, lstat, realpath, statfs, copyFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { check, CLIP_LIMITS, metrics, planClip, type ClipSegment, type MediaMetrics } from '../../../packages/core/src/streamcockpit-clipforge-plan.js';
import type { ClipResult, SourceGrant } from './streamcockpit-clipforge-pipeline.js';

/** F04 Windows laboratory pipeline only, NOT mounted in the production API.
 * Windows does not provide the Linux fd-directory + prlimit guarantees here.
 * An explicit opt-in permits OFFLINE synthetic tests, not production readiness.
 * An immutable-by-convention private staging copy is passed to FFmpeg by name.
 * No source or absolute path is ever returned in the manifest.
 */
export const windowsClipLabOptIn = 'I_ACCEPT_WINDOWS_CLIPFORGE_OFFLINE_LAB' as const;
type WinBinaries = { ffmpeg:string; ffprobe:string };
type Probe = { streams?:Array<{width?:unknown;height?:unknown}>; format?:{duration?:unknown} };
const validPart=/^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/;
const safeJob=/^[A-Za-z0-9_-]{1,64}$/;
const sha256=/^[a-f0-9]{64}$/;
const MAX_STDOUT=65_536;
const timeoutMs=Math.min(CLIP_LIMITS.wallMs,60_000);
function localAbsolute(file:string):boolean {
  return typeof file==='string'&&path.win32.isAbsolute(file)&&
    /^[A-Za-z]:[\\/]/.test(file)&&!file.startsWith('\\\\');
}
function safeError(error:unknown):string {
  const code=error instanceof Error?error.message:'';
  return /^CLIPFORGE_[A-Z_]+$/.test(code)?code.slice(10):'IO_OR_ADAPTER';
}
async function strictRoot(root:string):Promise<string>{
  check(localAbsolute(root),'DIRECTORY');
  const original=path.win32.normalize(root);
  let current=path.parse(original).root;
  for(const part of original.slice(current.length).split(/[\\/]/).filter(Boolean)){
    current=path.join(current,part);
    const stats=await lstat(current);
    check(stats.isDirectory()&&!stats.isSymbolicLink(),'DIRECTORY');
  }
  const resolved=await realpath(original);
  check(resolved.toLowerCase()===original.toLowerCase(),'DIRECTORY');
  return resolved;
}
function nonoverlapping(a:string,b:string):boolean {
  const inside=(x:string,y:string)=>{const rel=path.relative(x,y);return rel===''||(!rel.startsWith('..')&&!path.isAbsolute(rel))};
  return !inside(a,b)&&!inside(b,a);
}
async function digestFile(file:string,signal:AbortSignal,cap=CLIP_LIMITS.sourceBytes):Promise<string> {
  const hash=createHash('sha256');let count=0;
  const input=createReadStream(file,{highWaterMark:64*1024});
  const abort=()=>input.destroy(Error('CLIPFORGE_CANCELLED'));
  signal.addEventListener('abort',abort,{once:true});
  try{
    for await(const chunk of input){check(!signal.aborted,'CANCELLED');count+=chunk.length;check(count<=cap,'SOURCE_LIMIT');hash.update(chunk)}
    return hash.digest('hex');
  }finally{signal.removeEventListener('abort',abort)}
}
async function binary(file:string,name:'ffmpeg.exe'|'ffprobe.exe'):Promise<string>{
  check(localAbsolute(file)&&path.win32.basename(file).toLowerCase()===name,'BINARIES');
  const resolved=await realpath(file),stats=await lstat(file);
  check(stats.isFile()&&!stats.isSymbolicLink()&&resolved.toLowerCase()===path.win32.normalize(file).toLowerCase(),'BINARIES');
  return resolved;
}
async function run(binaryPath:string,args:string[],signal:AbortSignal,limit=MAX_STDOUT):Promise<{code:number|null;stdout:string}>{
  check(!signal.aborted,'CANCELLED');
  return new Promise((resolve,reject)=>{
    let text='',overflow=false,error=false,terminated=false;
    const child=spawn(binaryPath,args,{shell:false,windowsHide:true,detached:false,
      env:{SystemRoot:process.env.SystemRoot||'C:\\Windows',WINDIR:process.env.WINDIR||'C:\\Windows'},
      stdio:['ignore','pipe','ignore']});
    const kill=()=>{terminated=true;child.kill()};
    const timer=setTimeout(kill,timeoutMs);
    signal.addEventListener('abort',kill,{once:true});
    if(signal.aborted)kill();
    child.stdout?.on('data',(part:Buffer)=>{
      if(Buffer.byteLength(text)+part.length>limit){overflow=true;kill()}
      else text+=part.toString('utf8');
    });
    child.on('error',()=>{error=true});
    // Wait for close, never report an acknowledged child before its handles close.
    child.on('close',code=>{
      clearTimeout(timer);signal.removeEventListener('abort',kill);
      if(error||overflow)reject(Error('CLIPFORGE_EXECUTOR_UNAVAILABLE'));
      else resolve({code:terminated?null:code,stdout:text});
    });
  });
}
async function probe(ffprobe:string,file:string,signal:AbortSignal):Promise<MediaMetrics> {
  const result=await run(ffprobe,['-v','error','-threads','1','-protocol_whitelist','file,pipe',
    '-format_whitelist','mov,matroska,webm','-select_streams','v:0',
    '-show_entries','stream=width,height:format=duration','-of','json',file],signal);
  check(result.code===0,'PROBE_FAILED');
  let parsed:Probe;
  try{parsed=JSON.parse(result.stdout) as Probe}catch{throw Error('CLIPFORGE_PROBE_FAILED')}
  check(parsed&&parsed.streams?.length===1&&typeof parsed.format?.duration==='string','PROBE_FAILED');
  const stream=parsed.streams[0];
  return metrics({width:Number(stream.width),height:Number(stream.height),
    durationMs:Math.round(Number(parsed.format.duration)*1000)});
}
async function writeDurable(file:string,bytes:string):Promise<void> {
  const handle=await open(file,'wx',0o600);
  try{await handle.writeFile(bytes);await handle.sync()}
  finally{await handle.close()}
}
async function snapshot(source:string,stage:string,expected:string,signal:AbortSignal):Promise<void>{
  const inFd=await open(source,'r');
  let outFd:Awaited<ReturnType<typeof open>>|undefined;
  try{
    const before=await inFd.stat();
    check(before.isFile()&&before.nlink===1&&before.size>0&&before.size<=CLIP_LIMITS.sourceBytes,'SOURCE');
    outFd=await open(stage,'wx',0o600);
    const hash=createHash('sha256'),buffer=Buffer.alloc(65536);let total=0;
    while(true){
      check(!signal.aborted,'CANCELLED');
      const {bytesRead}=await inFd.read(buffer,0,buffer.length,total);
      if(!bytesRead)break;
      total+=bytesRead;check(total<=CLIP_LIMITS.sourceBytes,'SOURCE_LIMIT');
      hash.update(buffer.subarray(0,bytesRead));
      // The write API is allowed to complete fewer bytes than requested.
      // Keep the copied source byte-exact before it is handed to FFmpeg.
      let written=0;
      while(written<bytesRead){
        check(!signal.aborted,'CANCELLED');
        const result=await outFd.write(buffer,written,bytesRead-written,null);
        check(result.bytesWritten>0,'SOURCE_CHANGED');
        written+=result.bytesWritten;
      }
    }
    check(total===before.size&&hash.digest('hex')===expected,'UNAUTHORIZED');
    const after=await inFd.stat();
    check(before.ino===after.ino&&before.nlink===after.nlink&&before.size===after.size&&
      before.mtimeMs===after.mtimeMs&&before.ctimeMs===after.ctimeMs,'SOURCE_CHANGED');
    await outFd.sync();
  }finally{await outFd?.close();await inFd.close()}
}
export class WindowsOfflineClipForge {
  private busy=false;
  constructor(private readonly sourceRoot:string,private readonly outputRoot:string,
    private readonly executables:WinBinaries,private readonly optIn:typeof windowsClipLabOptIn){}

  async prepare(jobId:string,grant:SourceGrant,segment:ClipSegment,
    signal=new AbortController().signal):Promise<ClipResult> {
    if(this.busy)return {status:'FAILED',code:'BUSY'};
    this.busy=true;let reservationAttempted=false,reserved=false,executing=false,prepared=false,stage='';
    const controller=new AbortController(),abort=()=>controller.abort();
    signal.addEventListener('abort',abort,{once:true});
    if(signal.aborted)abort();
    const timer=setTimeout(abort,CLIP_LIMITS.wallMs);
    try{
      check(process.platform==='win32'&&this.optIn===windowsClipLabOptIn,'WINDOWS_LAB_OPT_IN');
      check(safeJob.test(jobId),'JOB');
      check(grant&&sha256.test(grant.sha256)&&typeof grant.relativePath==='string'&&
        grant.relativePath.length<=512&&grant.relativePath.split('/').every(part=>validPart.test(part)),'GRANT');
      // Pin all caller-controlled inputs before the first asynchronous filesystem
      // call: a shared grant/segment object must never change authorization mid-job.
      const authorized:SourceGrant={relativePath:grant.relativePath,sha256:grant.sha256};
      const requested=structuredClone(segment);
      // Never allow URLs, UNC paths, reparse points or an output dir nested in the input.
      const sourceRoot=await strictRoot(this.sourceRoot),outputRoot=await strictRoot(this.outputRoot);
      check(nonoverlapping(sourceRoot,outputRoot),'ROOT_OVERLAP');
      // Job idempotence takes precedence over changed/missing source and
      // binaries: a previous reservation is UNKNOWN, never a fresh attempt.
      const base=path.join(outputRoot,jobId);
      for(const suffix of ['.intent','.mp4','.json','.vtt']){
        try{await lstat(base+suffix);return {status:'UNKNOWN',code:'EXISTING_JOB'}}
        catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
      }
      const parts=authorized.relativePath.split('/');let source=sourceRoot;
      for(const [i,part] of parts.entries()){
        source=path.join(source,part);
        const stat=await lstat(source);
        check(!stat.isSymbolicLink()&&(i===parts.length-1?stat.isFile():stat.isDirectory()),'SOURCE');
      }
      const outputStat=await lstat(outputRoot);
      check(outputStat.isDirectory()&&!outputStat.isSymbolicLink(),'DIRECTORY');
      const space=await statfs(outputRoot);
      const bytes=(await lstat(source)).size;
      check(bytes>0&&bytes<=CLIP_LIMITS.sourceBytes,'SOURCE');
      check(space.bavail*space.bsize>=bytes+CLIP_LIMITS.outputBytes*2+1024*1024,'DISK');
      const ffprobe=await binary(this.executables.ffprobe,'ffprobe.exe');
      const ffmpeg=await binary(this.executables.ffmpeg,'ffmpeg.exe');
      stage=path.join(outputRoot,'.sc3-stage-'+randomUUID());
      await mkdir(stage,{mode:0o700});
      const stagedSource=path.join(stage,'input.mp4'),stagedOutput=path.join(stage,'output.mp4');
      await snapshot(source,stagedSource,authorized.sha256,controller.signal);
      check(await digestFile(stagedSource,controller.signal)===authorized.sha256,'SOURCE_CHANGED');
      const plan=planClip(requested,await probe(ffprobe,stagedSource,controller.signal));
      check(!controller.signal.aborted,'CANCELLED');
      // Even a failed FlushFileBuffers after 'wx' may leave an intent: never
      // advertise FAILED or erase the forensic snapshot after an uncertain write.
      reservationAttempted=true;
      try{await writeDurable(base+'.intent',JSON.stringify({version:1,state:'UNKNOWN',sourceSha256:authorized.sha256})+'\n')}
      catch(error){
        if((error as NodeJS.ErrnoException).code==='EEXIST'){
          reservationAttempted=false;
          return {status:'UNKNOWN',code:'EXISTING_JOB'};
        }
        throw error;
      }
      reserved=true;
      const args=plan.args.map(arg=>arg==='/proc/self/fd/3'?stagedSource:arg==='pipe:4'?stagedOutput:arg);
      args.unshift('-n');
      executing=true;
      const result=await run(ffmpeg,args,controller.signal);
      executing=false;
      if(controller.signal.aborted||result.code===null)return {status:'UNKNOWN',code:'ENCODER_INTERRUPTED'};
      check(result.code===0,'ENCODER_EXIT');
      const outputStats=await lstat(stagedOutput);
      check(outputStats.isFile()&&outputStats.size>0&&outputStats.size<CLIP_LIMITS.outputBytes,'OUTPUT_SIZE');
      const measured=await probe(ffprobe,stagedOutput,controller.signal);
      check(measured.width===plan.width&&measured.height===plan.height&&
        Math.abs(measured.durationMs-(plan.segment.endMs-plan.segment.startMs))<=250,'OUTPUT_METRICS');
      check(await digestFile(stagedSource,controller.signal)===authorized.sha256,'SOURCE_CHANGED');
      check(!controller.signal.aborted,'CANCELLED');
      // File creation is exclusive: no overwrites and no inferred success on retry.
      await copyFile(stagedOutput,base+'.mp4',constants.COPYFILE_EXCL);
      // FlushFileBuffers on NTFS requires a write-enabled file handle; 'r' produces EPERM.
      const fd=await open(base+'.mp4','r+');
      try{await fd.sync()}finally{await fd.close()}
      const outHash=await digestFile(base+'.mp4',controller.signal,CLIP_LIMITS.outputBytes);
      const manifest=JSON.stringify({schemaVersion:1,kind:'streamcockpit-clipforge',
        sourceSha256:authorized.sha256,source:plan.source,segment:plan.segment,
        output:{file:jobId+'.mp4',width:plan.width,height:plan.height,
          bytes:outputStats.size,sha256:outHash},
        captions:plan.vtt?jobId+'.vtt':null,markers:'not-created-or-confirmed'},null,2)+'\n';
      if(plan.vtt)await writeDurable(base+'.vtt',plan.vtt);
      check(!controller.signal.aborted,'CANCELLED');
      await writeDurable(base+'.json',manifest);
      prepared=true;
      return {status:'PREPARED',code:'OFFLINE_WINDOWS_OUTPUT_UNQUALIFIED',manifest};
    }catch(error){
      return {status:executing||reserved||reservationAttempted?'UNKNOWN':controller.signal.aborted?'CANCELLED':'FAILED',
        code:safeError(error)};
    }finally{
      clearTimeout(timer);signal.removeEventListener('abort',abort);
      // Once the verified final files exist, remove only the private staging
      // snapshot created by this invocation. On any post-intent uncertainty,
      // retain staging and intent for explicit operator recovery, never replay.
      if(stage&&(!reservationAttempted||prepared))await rm(stage,{recursive:true,force:true}).catch(()=>{});
      this.busy=false;
    }
  }
}
