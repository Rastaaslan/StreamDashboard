import {createHmac,createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,rm,link} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {describe,expect,it} from 'vitest';
import {attestWindowsObsReplaySource} from '../apps/server/src/streamcockpit-clipforge-windows-replay-grant.js';

const run=process.platform==='win32'?it:it.skip;
const secret=Buffer.alloc(32,7);
const id=(file:string)=>'obs_replay_'+createHmac('sha256',secret).update(file).digest('hex');
async function fixture(){
  const root=await mkdtemp(path.join(tmpdir(),'sc3-f04-source-'));
  const folder=path.join(root,'OBS');
  await mkdir(folder);
  const file=path.join(folder,'recorded_replay.mkv');
  const bytes=Buffer.from('fixture-video-bytes-not-real-media');
  await writeFile(file,bytes);
  const state={connected:true,streamingKnown:true,streaming:true,connectionGeneration:9,streamEpoch:11};
  const witness={sourceEventId:id(file),observedAt:Date.now(),connectionGeneration:9,streamEpoch:11};
  let eligible=true;
  const options={sourceRoot:root,savedReplayPath:file,witness,
    verifyObsEventId:(name:string,key:string)=>id(name)===key,
    snapshot:()=>({...state}),hostEligible:async()=>eligible};
  return {root,folder,file,bytes,state,options,setEligible:(v:boolean)=>{eligible=v}};
}
describe('F04 host-only OBS replay file witness (not Windows production encoding)',()=>{
  run('binds HMAC-witnessed OBS file to a SHA-256/relative grant, without returning absolute path',async()=>{
    const f=await fixture();
    try{
      const r=await attestWindowsObsReplaySource(f.options);
      expect(r).toEqual({status:'VERIFIED_HOST_ONLY',grant:{
        relativePath:'OBS/recorded_replay.mkv',
        sha256:createHash('sha256').update(f.bytes).digest('hex'),
      }});
      expect(JSON.stringify(r)).not.toContain(f.root);
      expect(JSON.stringify(r)).not.toContain(f.options.witness.sourceEventId);
    }finally{await rm(f.root,{recursive:true,force:true});}
  });
  run('binds the literal OBS path spelling rather than its normalized Windows spelling',async()=>{
    const f=await fixture();
    try {
      const obsPath=f.file.replace(/\\/g,'/');
      const actual=await attestWindowsObsReplaySource({
        ...f.options,savedReplayPath:obsPath,
        witness:{...f.options.witness,sourceEventId:id(obsPath)},
      });
      expect(actual.status).toBe('VERIFIED_HOST_ONLY');
    }finally{await rm(f.root,{recursive:true,force:true});}
  });
  run('refuses wrong HMAC binding and an untrusted absolute location',async()=>{
    const f=await fixture();
    try {
      expect(await attestWindowsObsReplaySource({...f.options,witness:{...f.options.witness,sourceEventId:'obs_replay_'+'0'.repeat(64)}}))
        .toEqual({status:'DENIED',code:'EVENT_BINDING'});
      expect(await attestWindowsObsReplaySource({...f.options,savedReplayPath:path.join(f.root,'..','outside.mkv')}))
        .toEqual({status:'DENIED',code:'SOURCE_PATH'});
      expect(await attestWindowsObsReplaySource({...f.options,savedReplayPath:'\\\\server\\share\\replay.mkv'}))
        .toEqual({status:'DENIED',code:'SOURCE_PATH'});
    }finally{await rm(f.root,{recursive:true,force:true});}
  });
  run('refuses stale OBS epoch, stopped stream, and unavailable FIXE authority',async()=>{
    const f=await fixture();
    try{
      f.state.streamEpoch++;
      expect(await attestWindowsObsReplaySource(f.options)).toEqual({status:'DENIED',code:'OBS_AUTHORITY'});
      f.state.streamEpoch--;f.state.streaming=false;
      expect(await attestWindowsObsReplaySource(f.options)).toEqual({status:'DENIED',code:'OBS_AUTHORITY'});
      f.state.streaming=true;f.setEligible(false);
      expect(await attestWindowsObsReplaySource(f.options)).toEqual({status:'DENIED',code:'OBS_AUTHORITY'});
    }finally{await rm(f.root,{recursive:true,force:true});}
  });
  run('refuses a changed source after a host await and never exposes its content',async()=>{
    const f=await fixture();
    try{
      let calls=0;
      const options={...f.options,hostEligible:async()=>{calls++;if(calls===2)await writeFile(f.file,'source replaced after digest');return true;}};
      expect(await attestWindowsObsReplaySource(options)).toEqual({status:'DENIED',code:'SOURCE_CHANGED'});
      expect(calls).toBe(2);
    }finally{await rm(f.root,{recursive:true,force:true});}
  });
  run('refuses a Windows NTFS source file with a second hardlink',async()=>{
    const f=await fixture();
    try {
      await link(f.file,path.join(f.root,'copy-of-replay.mkv'));
      expect(await attestWindowsObsReplaySource(f.options))
        .toEqual({status:'DENIED',code:'SOURCE_LIMIT'});
    }finally{await rm(f.root,{recursive:true,force:true});}
  });
  run('denies directory masquerading as replay, invalid witness and cancelled inspection',async()=>{
    const f=await fixture();
    try{
      expect((await attestWindowsObsReplaySource({...f.options,savedReplayPath:f.folder,witness:{...f.options.witness,sourceEventId:id(f.folder)}})).status).toBe('DENIED');
      expect(await attestWindowsObsReplaySource({...f.options,witness:{...f.options.witness,streamEpoch:NaN}}))
        .toEqual({status:'DENIED',code:'WITNESS'});
      const abort=new AbortController();abort.abort();
      expect(await attestWindowsObsReplaySource({...f.options,signal:abort.signal}))
        .toEqual({status:'DENIED',code:'CANCELLED'});
    }finally{await rm(f.root,{recursive:true,force:true});}
  });
});
