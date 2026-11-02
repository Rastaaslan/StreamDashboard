import { afterAll,afterEach,beforeAll,describe,expect,it } from 'vitest';
import { mkdtemp,mkdir,readFile,readdir,rm,stat,writeFile,symlink,link,copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn,spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { WindowsOfflineClipForge,windowsClipLabOptIn } from '../apps/server/src/streamcockpit-clipforge-windows.js';

const onlyWindows=process.platform==='win32'?it:it.skip;
const mediaTest=process.platform==='win32'&&process.env.SC3_CLIPFORGE_WINDOWS_LAB_TEST==='1'&&
  Boolean(process.env.SC3_FFMPEG&&process.env.SC3_FFPROBE)?it:it.skip;
const folders:string[]=[];
let compiledRunner='',runnerFolder='';
beforeAll(async()=>{
  if(process.platform!=='win32'||process.env.SC3_CLIPFORGE_WINDOWS_LAB_TEST!=='1')return;
  runnerFolder=await mkdtemp(path.join(tmpdir(),'sc3-native-job-runner-'));
  compiledRunner=path.join(runnerFolder,'StreamCockpitClipJob.exe');
  const csc='C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
  const source=path.join(process.cwd(),'scripts','streamcockpit-windows-clip-job.cs');
  const result=spawnSync(csc,['/nologo','/target:exe','/platform:x64','/optimize+',
    '/out:'+compiledRunner,source],{shell:false,windowsHide:true,timeout:20000,encoding:'utf8'});
  expect(result.error).toBeUndefined();
  expect(result.status,result.stdout+' '+result.stderr).toBe(0);
});
afterAll(async()=>{if(runnerFolder)await rm(runnerFolder,{recursive:true,force:true})});
type Lab={root:string;src:string;out:string;file:string;exe:{ffmpeg:string;ffprobe:string;supervisor:string}};
const sha=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
async function fixture():Promise<Lab>{
  const root=await mkdtemp(path.join(tmpdir(),'sc3-clip-win-'));folders.push(root);
  const src=path.join(root,'input'),out=path.join(root,'output');
  await mkdir(src);await mkdir(out);
  return {root,src,out,file:path.join(src,'source.mp4'),
    exe:{ffmpeg:process.env.SC3_FFMPEG??'C:\\untrusted\\ffmpeg.exe',
      ffprobe:process.env.SC3_FFPROBE??'C:\\untrusted\\ffprobe.exe',
      supervisor:compiledRunner||'C:\\untrusted\\StreamCockpitClipJob.exe'}};
}
afterEach(async()=>{
  for(const folder of folders.splice(0)){
    // Windows can release the terminated Job child directory handle slightly
    // after process liveness reports ESRCH. Retry only our fixture cleanup.
    for(let attempt=0;attempt<25;attempt++){
      try{await rm(folder,{recursive:true,force:true});break}
      catch(error){
        if(!['EBUSY','EPERM'].includes((error as NodeJS.ErrnoException).code??'')||attempt===24)throw error;
        await delay(50);
      }
    }
  }
});
async function generateVideo(lab:Lab){
  const result=spawnSync(lab.exe.ffmpeg,['-nostdin','-hide_banner','-loglevel','error',
    '-f','lavfi','-i','color=c=red:s=320x180:r=15','-t','2',
    '-c:v','libx264','-preset','ultrafast','-threads','1','-pix_fmt','yuv420p',
    '-f','mp4',lab.file],{shell:false,windowsHide:true,timeout:15000,stdio:'ignore'});
  expect(result.error).toBeUndefined();expect(result.status).toBe(0);
  return {relativePath:'source.mp4',sha256:sha(await readFile(lab.file))};
}
const segment={startMs:0,endMs:1000,fit:'pad' as const,captions:[{startMs:0,endMs:1000,text:'Bonjour OBS'}]};

describe('F04 Windows ClipForge offline laboratory, NOT a production API',()=>{
  onlyWindows('refuses non-opted-in execution before any output or FFmpeg',async()=>{
    const lab=await fixture();
    const forge=new WindowsOfflineClipForge(lab.src,lab.out,lab.exe,'WRONG_OPT_IN' as typeof windowsClipLabOptIn);
    const result=await forge.prepare('wrong',{relativePath:'source.mp4',sha256:'1'.repeat(64)},segment);
    expect(result).toEqual({status:'FAILED',code:'WINDOWS_LAB_OPT_IN'});
    expect(await readdir(lab.out)).toEqual([]);
  });
  onlyWindows('rejects invalid paths and wrong grants without a durable intent or provider commands',async()=>{
    const lab=await fixture();await writeFile(lab.file,'not-a-valid-video');
    const forge=new WindowsOfflineClipForge(lab.src,lab.out,lab.exe,windowsClipLabOptIn);
    for(const bad of ['../secret.mp4','/secret.mp4','a/../../bad.mp4','a\\bad.mp4','http:fake.mp4','a//video.mp4']){
      const result=await forge.prepare('invalid',{relativePath:bad,sha256:'0'.repeat(64)},segment);
      expect(result.status).toBe('FAILED');
    }
    expect(await readdir(lab.out)).toEqual([]);
  });
  mediaTest('encodes real vertical MP4 from a private NTFS synthetic video and verifies its manifest',async()=>{
    const lab=await fixture(),grant=await generateVideo(lab);
    const before=await readFile(lab.file);
    const result=await new WindowsOfflineClipForge(lab.src,lab.out,lab.exe,windowsClipLabOptIn)
      .prepare('lab_vertical',grant,segment);
    expect(result).toMatchObject({status:'PREPARED',code:'OFFLINE_WINDOWS_OUTPUT_UNQUALIFIED'});
    expect(JSON.stringify(result)).not.toContain(lab.root);
    const manifest=JSON.parse(result.manifest!);
    expect(manifest).toMatchObject({kind:'streamcockpit-clipforge',sourceSha256:grant.sha256,
      output:{file:'lab_vertical.mp4',width:360,height:640},captions:'lab_vertical.vtt'});
    const clip=await readFile(path.join(lab.out,'lab_vertical.mp4'));
    expect(clip.length).toBeGreaterThan(100);
    expect(manifest.output.sha256).toBe(sha(clip));
    expect((await stat(path.join(lab.out,'lab_vertical.mp4'))).isFile()).toBe(true);
    expect(await readFile(lab.file)).toEqual(before);
    expect(await readFile(path.join(lab.out,'lab_vertical.vtt'),'utf8')).toContain('Bonjour OBS');
    expect((await readdir(lab.out)).some(file=>file.endsWith('.intent'))).toBe(true);
    expect((await readdir(lab.out)).some(file=>file.startsWith('.sc3-stage-'))).toBe(false);
  },45000);
  mediaTest('pins the original grant and clip request despite caller mutations during async filesystem work',async()=>{
    const lab=await fixture(),grant=await generateVideo(lab);
    const outsider=path.join(lab.root,'outside.mp4');
    await writeFile(outsider,'never-authorized-outside-the-source-root');
    const mutableGrant={...grant};
    const mutableSegment={...segment,captions:segment.captions.map(c=>({...c}))};
    const pending=new WindowsOfflineClipForge(lab.src,lab.out,lab.exe,windowsClipLabOptIn)
      .prepare('frozen_inputs',mutableGrant,mutableSegment);
    // This happens after validation, but before the first lstat/realpath await completes.
    // Without a synchronous capture it can redirect a trusted path outside the root.
    mutableGrant.relativePath='../outside.mp4';
    mutableGrant.sha256='0'.repeat(64);
    mutableSegment.endMs=200_000;
    mutableSegment.captions[0].text='MUTATED BY CALLER';
    const result=await pending;
    expect(result.status).toBe('PREPARED');
    const manifest=JSON.parse(result.manifest!);
    expect(manifest.sourceSha256).toBe(grant.sha256);
    expect(manifest.segment).toMatchObject({endMs:1000,fit:'pad',captions:[{text:'Bonjour OBS'}]});
    expect(await readdir(lab.out)).toContain('frozen_inputs.mp4');
  },45000);
  mediaTest('refuses repeat or changed SHA without overwriting a confirmed artifact',async()=>{
    const lab=await fixture(),grant=await generateVideo(lab);
    const forge=new WindowsOfflineClipForge(lab.src,lab.out,lab.exe,windowsClipLabOptIn);
    const first=await forge.prepare('once',grant,segment);
    expect(first.status).toBe('PREPARED');
    const before=await readFile(path.join(lab.out,'once.mp4'));
    const repeat=await new WindowsOfflineClipForge(lab.src,lab.out,lab.exe,windowsClipLabOptIn).prepare('once',grant,segment);
    expect(repeat).toEqual({status:'UNKNOWN',code:'EXISTING_JOB'});
    expect(await readFile(path.join(lab.out,'once.mp4'))).toEqual(before);
    const changed=await forge.prepare('wrong_sha',{...grant,sha256:'f'.repeat(64)},segment);
    expect(changed.status).toBe('FAILED');
    expect(await readdir(lab.out)).not.toContain('wrong_sha.intent');
  },45000);
  mediaTest('keeps a failed encoder reservation UNKNOWN and never retries or deletes forensic staging',async()=>{
    const lab=await fixture(),grant=await generateVideo(lab);
    const fakeEncoder=path.join(lab.root,'ffmpeg.exe');
    // An actual PE binary that exits nonzero on FFmpeg arguments, with no shell involved.
    await copyFile(lab.exe.ffprobe,fakeEncoder);
    const forge=new WindowsOfflineClipForge(lab.src,lab.out,{...lab.exe,ffmpeg:fakeEncoder},windowsClipLabOptIn);
    const first=await forge.prepare('failed_encoder',grant,segment);
    expect(first).toEqual({status:'UNKNOWN',code:'ENCODER_EXIT'});
    const files=await readdir(lab.out);
    expect(files).toContain('failed_encoder.intent');
    expect(files).not.toContain('failed_encoder.mp4');
    expect(files).not.toContain('failed_encoder.json');
    expect(files.some(file=>file.startsWith('.sc3-stage-'))).toBe(true);
    expect(await forge.prepare('failed_encoder',grant,segment))
      .toEqual({status:'UNKNOWN',code:'EXISTING_JOB'});
  },45000);
  mediaTest('rejects a bad clip segment before reserving an output',async()=>{
    const lab=await fixture(),grant=await generateVideo(lab);
    const forge=new WindowsOfflineClipForge(lab.src,lab.out,lab.exe,windowsClipLabOptIn);
    const result=await forge.prepare('invalid_segment',grant,{...segment,endMs:200_000});
    expect(result).toMatchObject({status:'FAILED'});
    expect(await readdir(lab.out)).not.toContain('invalid_segment.intent');
  },30000);
  onlyWindows('rejects NTFS junction ancestors and hardlinked input before encoding',async()=>{
    const lab=await fixture();
    const outside=path.join(lab.root,'outside');await mkdir(outside);
    await writeFile(path.join(outside,'source.mp4'),'same-file');
    const target=path.join(lab.src,'linked');
    await symlink(outside,target,'junction');
    const forge=new WindowsOfflineClipForge(lab.src,lab.out,lab.exe,windowsClipLabOptIn);
    const grant={relativePath:'linked/source.mp4',sha256:sha('same-file')};
    expect((await forge.prepare('junction',grant,segment)).status).toBe('FAILED');
    await writeFile(lab.file,'more-content');
    await link(lab.file,path.join(lab.root,'hardlink.mp4'));
    expect((await forge.prepare('hardlink',{relativePath:'source.mp4',sha256:sha('more-content')},segment)).status).toBe('FAILED');
    expect(await readdir(lab.out)).toEqual([]);
  });
  onlyWindows('rejects overlapping roots and does not overwrite any prior output',async()=>{
    const lab=await fixture();
    const nested=path.join(lab.src,'output');await mkdir(nested);
    const overlap=new WindowsOfflineClipForge(lab.src,nested,lab.exe,windowsClipLabOptIn);
    expect((await overlap.prepare('nested',{relativePath:'source.mp4',sha256:'a'.repeat(64)},segment)).status).toBe('FAILED');
    await writeFile(path.join(lab.out,'existing.mp4'),'existing-output');
    const forge=new WindowsOfflineClipForge(lab.src,lab.out,lab.exe,windowsClipLabOptIn);
    expect(await forge.prepare('existing',{relativePath:'source.mp4',sha256:'a'.repeat(64)},segment))
      .toEqual({status:'UNKNOWN',code:'EXISTING_JOB'});
    expect(await readFile(path.join(lab.out,'existing.mp4'),'utf8')).toBe('existing-output');
  });
  mediaTest('allows exactly one prepared export across simultaneous job contenders',async()=>{
    const lab=await fixture(),grant=await generateVideo(lab);
    const first=new WindowsOfflineClipForge(lab.src,lab.out,lab.exe,windowsClipLabOptIn);
    const second=new WindowsOfflineClipForge(lab.src,lab.out,lab.exe,windowsClipLabOptIn);
    const outcomes=await Promise.all([
      first.prepare('contested',grant,segment),second.prepare('contested',grant,segment)]);
    expect(outcomes.map(v=>v.status).sort()).toEqual(['PREPARED','UNKNOWN']);
    expect(await readdir(lab.out)).toContain('contested.intent');
    expect((await readdir(lab.out)).filter(x=>x==='contested.mp4')).toHaveLength(1);
  },45000);
  mediaTest('native Windows Job Object supervises child timeout and denies an extra child process',async()=>{
    const lab=await fixture();
    const sleep=path.join(lab.root,'sleep.js');
    await writeFile(sleep,'setTimeout(()=>{},10000);');
    const started=Date.now();
    const timed=spawnSync(compiledRunner,[process.execPath,'400','268435456','5',lab.root,
      sleep],{shell:false,windowsHide:true,timeout:5000,encoding:'utf8'});
    expect(timed.error).toBeUndefined();
    expect(timed.status,timed.stdout+' '+timed.stderr).toBe(124);
    expect(Date.now()-started).toBeLessThan(4500);
    const attempt=path.join(lab.root,'spawn-child.js');
    await writeFile(attempt,`const cp=require('node:child_process');
let child;
try{child=cp.spawn(process.execPath,['-e','process.exit(0)'],{stdio:'ignore'});}
catch(error){process.exit(error.code==='UNKNOWN'?0:10);}
child.once('error',()=>process.exit(0));
child.once('exit',()=>process.exit(8));
setTimeout(()=>process.exit(9),3000);`);
    const denied=spawnSync(compiledRunner,[process.execPath,'6000','268435456','10',
      lab.root,attempt],{shell:false,windowsHide:true,timeout:10000,encoding:'utf8'});
    expect(denied.error).toBeUndefined();
    // A single active process is allowed in the job; a second is rejected.
    expect(denied.status,denied.stdout+' '+denied.stderr).toBe(0);
  },18000);
  mediaTest('closing the supervisor kills its running child before the child timer expires',async()=>{
    const lab=await fixture(),script=path.join(lab.root,'child-wait.js');
    const marker=path.join(lab.root,'child-pid.txt');
    await writeFile(script,`const fs=require('node:fs');
fs.writeFileSync(process.argv[2],String(process.pid));
setTimeout(()=>{},7000);`);
    const supervisor=spawn(compiledRunner,[process.execPath,'15000','268435456','10',
      lab.root,script,marker],{shell:false,windowsHide:true,stdio:'ignore'});
    try{
      let pid=0;
      for(let i=0;i<100;i++){
        try{pid=Number(await readFile(marker,'utf8'));break}
        catch{await delay(20)}
      }
      expect(pid).toBeGreaterThan(0);
      supervisor.kill();
      await new Promise<void>(resolve=>supervisor.once('close',()=>resolve()));
      let dead=false;
      for(let i=0;i<100;i++){
        try{process.kill(pid,0)}catch{dead=true;break}
        await delay(20);
      }
      expect(dead).toBe(true);
    }finally{supervisor.kill()}
  },14000);
  mediaTest('refuses invalid supervisor resource limits before spawning its child',async()=>{
    const lab=await fixture(),script=path.join(lab.root,'must-not-run.js');
    const marker=path.join(lab.root,'bad-limit-marker.txt');
    await writeFile(script,"require('node:fs').writeFileSync(process.argv[2],'ran')");
    const rejected=spawnSync(compiledRunner,[process.execPath,'0','1','0',
      lab.root,script,marker],{shell:false,windowsHide:true,timeout:3000});
    expect(rejected.error).toBeUndefined();
    expect(rejected.status).toBe(70);
    expect(await readdir(lab.root)).not.toContain('bad-limit-marker.txt');
  });
  mediaTest('refuses missing native Job Object supervisor without reserving or encoding',async()=>{
    const lab=await fixture(),grant=await generateVideo(lab);
    lab.exe.supervisor=path.join(lab.root,'missing','StreamCockpitClipJob.exe');
    const result=await new WindowsOfflineClipForge(lab.src,lab.out,lab.exe,windowsClipLabOptIn)
      .prepare('no_supervisor',grant,segment);
    expect(result.status).toBe('FAILED');
    expect((await readdir(lab.out)).some(name=>name.endsWith('.intent'))).toBe(false);
  },30000);
  onlyWindows('handles an already-aborted request without FFmpeg or a forged manifest',async()=>{
    const lab=await fixture(),signal=new AbortController();signal.abort();
    const forge=new WindowsOfflineClipForge(lab.src,lab.out,lab.exe,windowsClipLabOptIn);
    const result=await forge.prepare('aborted',{relativePath:'source.mp4',sha256:'0'.repeat(64)},segment,signal.signal);
    expect(result.status).toBe('CANCELLED');
    expect(await readdir(lab.out)).toEqual([]);
  });
});
