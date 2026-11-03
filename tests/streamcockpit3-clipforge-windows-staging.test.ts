import {createHash,createHmac} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,readFile,readdir,rename,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {describe,expect,it} from 'vitest';
import {inspectWindowsClipPrivateRoot} from '../apps/server/src/streamcockpit-clipforge-windows-acl.js';
import {stageWindowsObsReplay} from '../apps/server/src/streamcockpit-clipforge-windows-staging.js';

const run=process.platform==='win32'?it:it.skip;
const secret=Buffer.alloc(32,14);
const id=(file:string)=>'obs_replay_'+createHmac('sha256',secret).update(file).digest('hex');
const sha=(s:Buffer)=>createHash('sha256').update(s).digest('hex');
function isolatePrivateFixture(dir:string){
  const path64=Buffer.from(dir,'utf8').toString('base64');
  const ps=`$ErrorActionPreference='Stop';$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${path64}'));$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User;$acl=New-Object Security.AccessControl.DirectorySecurity;$acl.SetAccessRuleProtection($true,$false);$acl.SetOwner($sid);$rule=New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow');$acl.AddAccessRule($rule);Set-Acl -LiteralPath $p -AclObject $acl`;
  const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',
    Buffer.from(ps,'utf16le').toString('base64')],{shell:false,timeout:12000,windowsHide:true,encoding:'utf8'});
  if(r.error||r.status!==0)throw Error('Fixture failed to establish protected NTFS DACL: '+r.stderr?.slice(0,500));
}
async function fixture(privateAcl=true){
  const root=await mkdtemp(path.join(tmpdir(),'sc3-f04-stage-fixture-'));
  const sourceRoot=path.join(root,'captures'),privateRoot=path.join(root,'private');
  await mkdir(sourceRoot);await mkdir(privateRoot);
  if(privateAcl)isolatePrivateFixture(privateRoot);
  const savedReplayPath=path.join(sourceRoot,'OBS_001.mkv');
  const bytes=Buffer.from('synthetic local source only, not a real OBS recording');
  await writeFile(savedReplayPath,bytes);
  const state={connected:true,streamingKnown:true,streaming:true,connectionGeneration:7,streamEpoch:22};
  const options={
    sourceRoot,privateRoot,savedReplayPath,jobId:'clip_test_1',
    witness:{sourceEventId:id(savedReplayPath),observedAt:Date.now(),connectionGeneration:7,streamEpoch:22},
    verifyObsEventId:(file:string,key:string)=>id(file)===key,
    snapshot:()=>({...state}),hostEligible:async()=>true,
  };
  return {root,sourceRoot,privateRoot,savedReplayPath,bytes,state,options,cleanup:()=>rm(root,{recursive:true,force:true})};
}
describe('F04 Windows host-only staged OBS snapshot, no codec or production route',()=>{
  run('stages exact SHA-256 bytes under a private root and reserves an UNKNOWN receipt before copying',async()=>{
    const f=await fixture();
    try{
      expect(inspectWindowsClipPrivateRoot(f.privateRoot).qualified).toBe(true);
      const result=await stageWindowsObsReplay(f.options);
      expect(result).toEqual({status:'STAGED_HOST_ONLY',grant:{relativePath:'clip_test_1.mkv',sha256:sha(f.bytes)}});
      expect(await readFile(path.join(f.privateRoot,'clip_test_1.mkv'))).toEqual(f.bytes);
      const intent=JSON.parse(await readFile(path.join(f.privateRoot,'clip_test_1.intent'),'utf8')) as Record<string,unknown>;
      expect(intent).toEqual({schemaVersion:1,state:'UNKNOWN',stageFile:'clip_test_1.mkv',sourceSha256:sha(f.bytes)});
      expect(JSON.stringify(intent)).not.toContain(f.sourceRoot);
      expect(JSON.stringify(result)).not.toContain(f.root);
    }finally{await f.cleanup();}
  });
  run('normalizes spaces and Unicode OBS filenames into a restricted host-only clip alias',async()=>{
    const f=await fixture();
    try{
      const actual=path.join(f.sourceRoot,'Replay été 20h.mkv');
      await rename(f.savedReplayPath,actual);
      const options={...f.options,savedReplayPath:actual,
        witness:{...f.options.witness,sourceEventId:id(actual)}};
      expect(await stageWindowsObsReplay(options)).toEqual({status:'STAGED_HOST_ONLY',
        grant:{relativePath:'clip_test_1.mkv',sha256:sha(f.bytes)}});
      expect(await readFile(path.join(f.privateRoot,'clip_test_1.mkv'))).toEqual(f.bytes);
      expect(await readFile(path.join(f.privateRoot,'clip_test_1.intent'),'utf8')).not.toContain('Replay été');
    }finally{await f.cleanup();}
  });
  run('never overwrites an existing job nor returns false success on replay',async()=>{
    const f=await fixture();
    try{
      expect((await stageWindowsObsReplay(f.options)).status).toBe('STAGED_HOST_ONLY');
      expect(await stageWindowsObsReplay(f.options)).toEqual({status:'UNKNOWN',code:'EXISTING_JOB'});
      expect(await readFile(path.join(f.privateRoot,'clip_test_1.mkv'))).toEqual(f.bytes);
    }finally{await f.cleanup();}
  });
  run('rejects a shared unprotected NTFS directory before creating any intent',async()=>{
    const f=await fixture(false);
    try{
      expect(inspectWindowsClipPrivateRoot(f.privateRoot).qualified).toBe(false);
      expect(await stageWindowsObsReplay(f.options)).toEqual({status:'DENIED',code:'ROOT_NOT_PRIVATE'});
      expect(await readdir(f.privateRoot)).toEqual([]);
    }finally{await f.cleanup();}
  });
  run('stopped OBS/revoked witness and abort before reservation cannot write a staging intent',async()=>{
    const f=await fixture();
    try{
      f.state.streamEpoch++;
      expect(await stageWindowsObsReplay(f.options)).toEqual({status:'DENIED',code:'WITNESS'});
      f.state.streamEpoch--;
      const abort=new AbortController();abort.abort();
      expect(await stageWindowsObsReplay({...f.options,signal:abort.signal}))
        .toEqual({status:'DENIED',code:'CANCELLED'});
      expect(await readdir(f.privateRoot)).toEqual([]);
    }finally{await f.cleanup();}
  });
  run('an OBS authority revocation after the intent is committed remains UNKNOWN, never replayable',async()=>{
    const f=await fixture();
    try{
      let eligibleCalls=0;
      const options={...f.options,hostEligible:async()=>{
        eligibleCalls++;
        if(eligibleCalls===4)f.state.streamEpoch++;
        return true;
      }};
      expect(await stageWindowsObsReplay(options)).toEqual({status:'UNKNOWN',code:'OBS_AUTHORITY'});
      expect(eligibleCalls).toBe(4);
      expect(await readdir(f.privateRoot)).toContain('clip_test_1.intent');
      expect((await stageWindowsObsReplay(f.options)).status).toBe('DENIED'); // stale witness always fails closed
      f.state.streamEpoch--;
      expect(await stageWindowsObsReplay(f.options)).toEqual({status:'UNKNOWN',code:'EXISTING_JOB'});
    }finally{await f.cleanup();}
  });
  run('rejects an edited reservation after copying, never returns a staged grant',async()=>{
    const f=await fixture();
    try{
      let calls=0;
      const options={...f.options,hostEligible:async()=>{
        calls++;
        if(calls===4)await writeFile(path.join(f.privateRoot,'clip_test_1.intent'),'corrupted intent');
        return true;
      }};
      expect(await stageWindowsObsReplay(options)).toEqual({status:'UNKNOWN',code:'INTENT_CHANGED'});
      expect(calls).toBe(5);
      expect(await stageWindowsObsReplay(f.options)).toEqual({status:'UNKNOWN',code:'EXISTING_JOB'});
    }finally{await f.cleanup();}
  });
  run('rejects a staged-file mutation of the same size before returning its SHA grant',async()=>{
    const f=await fixture();
    try{
      let calls=0;
      const edited=Buffer.from(f.bytes);
      edited[0]^=1;
      const options={...f.options,hostEligible:async()=>{
        calls++;
        if(calls===5)await writeFile(path.join(f.privateRoot,'clip_test_1.mkv'),edited);
        return true;
      }};
      expect(await stageWindowsObsReplay(options)).toEqual({status:'UNKNOWN',code:'DEST_CHANGED'});
      expect(await readdir(f.privateRoot)).toContain('clip_test_1.intent');
      expect(await stageWindowsObsReplay(f.options)).toEqual({status:'UNKNOWN',code:'EXISTING_JOB'});
    }finally{await f.cleanup();}
  });
  run('rejects replacing the staged NTFS file with identical bytes but a new file identity',async()=>{
    const f=await fixture();
    try{
      let calls=0;
      const options={...f.options,hostEligible:async()=>{
        calls++;
        if(calls===5){
          const staged=path.join(f.privateRoot,'clip_test_1.mkv');
          await rename(staged,path.join(f.privateRoot,'orphan.mkv'));
          await writeFile(staged,f.bytes);
        }
        return true;
      }};
      expect(await stageWindowsObsReplay(options)).toEqual({status:'UNKNOWN',code:'DEST_CHANGED'});
      expect(await stageWindowsObsReplay(f.options)).toEqual({status:'UNKNOWN',code:'EXISTING_JOB'});
    }finally{await f.cleanup();}
  });
  run('detects a source replacement after reservation; persists UNKNOWN and no valid staged grant',async()=>{
    const f=await fixture();
    try{
      let calls=0;
      const options={...f.options,hostEligible:async()=>{
        calls++;
        if(calls===4)await writeFile(f.savedReplayPath,'tampered after reservation');
        return true;
      }};
      expect(await stageWindowsObsReplay(options)).toEqual({status:'UNKNOWN',code:'SOURCE_CHANGED'});
      expect(await readdir(f.privateRoot)).toContain('clip_test_1.intent');
      expect(await stageWindowsObsReplay(f.options)).toEqual({status:'UNKNOWN',code:'EXISTING_JOB'});
    }finally{await f.cleanup();}
  });
  run('refuses nested source/staging roots to avoid self-ingestion and uncontrolled writers',async()=>{
    const f=await fixture();
    try{
      expect(await stageWindowsObsReplay({...f.options,sourceRoot:f.root}))
        .toEqual({status:'DENIED',code:'ROOT_OVERLAP'});
      expect(await readdir(f.privateRoot)).toEqual([]);
    }finally{await f.cleanup();}
  });
});
