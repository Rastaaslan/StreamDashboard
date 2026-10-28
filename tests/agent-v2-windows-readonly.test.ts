import {describe,it,expect} from 'vitest';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
  parseReadOnlyStartup,loadLocalObsCredential,runReadOnlySession,
} from '../apps/agent/src/windows-readonly-service.js';

describe('Windows read-only portable Agent',()=>{
  it('requires explicit opt-in and local OBS config, never a default listener',()=>{
    const env={APPDATA:'C:\\Users\\test\\AppData\\Roaming',
      STREAMDASHBOARD_AGENT_DEVICE_ID:'FIXE_LAB'};
    expect(()=>parseReadOnlyStartup(['--once','--use-local-obs-config'],env))
      .toThrow('EXPLICIT_READ_ONLY_OPT_IN_REQUIRED');
    expect(()=>parseReadOnlyStartup(['--monitor','--use-local-obs-config'],
      {...env,STREAMDASHBOARD_AGENT_READONLY_OPT_IN:'no'}))
      .toThrow('EXPLICIT_READ_ONLY_OPT_IN_REQUIRED');
    expect(()=>parseReadOnlyStartup(['--listen-lan','--use-local-obs-config'],
      {...env,STREAMDASHBOARD_AGENT_READONLY_OPT_IN:'I_ACCEPT_READ_ONLY'}))
      .toThrow('READ_ONLY_MODE_REQUIRED');
    expect(parseReadOnlyStartup(['--once','--use-local-obs-config'],
      {...env,STREAMDASHBOARD_AGENT_READONLY_OPT_IN:'I_ACCEPT_READ_ONLY'}))
      .toMatchObject({mode:'once',deviceId:'FIXE_LAB'});
  });
  it('fails closed without an authenticated OBS WebSocket, no secret ever exposed',async()=>{
    const dir=await mkdtemp(path.join(tmpdir(),'sd-readonly-config-'));
    const file=path.join(dir,'config.json');
    try{
      await writeFile(file,JSON.stringify({
        server_enabled:false,server_port:4555,auth_required:true,
        server_password:'PRIVATE_SHOULD_NOT_APPEAR',
      }));
      await expect(loadLocalObsCredential(file)).rejects.toThrow('OBS_CONFIG_UNQUALIFIED');
      await writeFile(file,JSON.stringify({
        server_enabled:true,server_port:4555,auth_required:false,
        server_password:'PRIVATE_SHOULD_NOT_APPEAR',
      }));
      await expect(loadLocalObsCredential(file)).rejects.toThrow('OBS_CONFIG_UNQUALIFIED');
      await writeFile(file,JSON.stringify({
        server_enabled:true,server_port:4555,auth_required:true,
        server_password:'PRIVATE_SHOULD_NOT_APPEAR',
      }));
      const result=await loadLocalObsCredential(file);
      expect(result.url).toBe('ws://127.0.0.1:4555');
      expect(result.password).toBe('PRIVATE_SHOULD_NOT_APPEAR');
    }finally{await rm(dir,{recursive:true,force:true})}
  });
  it('allows only GetStats and GetStreamStatus for one confirmed read',async()=>{
    const records:unknown[]=[],requests:string[]=[];
    const stop=new AbortController();
    await runReadOnlySession({
      mode:'once',deviceId:'FIXE_LAB',signal:stop.signal,
      call:async kind=>{
        requests.push(kind);
        return kind==='GetStats'?{outputSkippedFrames:1,renderTotalFrames:30}:
          {outputActive:false,outputBytes:4};
      },
      emit:r=>records.push(r),
      diagnostic:code=>{throw Error(code)},
    });
    expect(requests.sort()).toEqual(['GetStats','GetStreamStatus']);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({sourceDeviceId:'FIXE_LAB',
      payload:{active:false,skippedFrames:1,renderedFrames:30}});
  });
  it('exits monitored polling promptly on abort without an OBS command',async()=>{
    const stop=new AbortController(),records:unknown[]=[];
    const job=runReadOnlySession({
      mode:'monitor',deviceId:'FIXE_LAB',signal:stop.signal,
      call:async kind=>kind==='GetStats'?{outputSkippedFrames:0,renderTotalFrames:30}:
        {outputActive:false},
      emit:r=>records.push(r),
      diagnostic:code=>{throw Error(code)},
    });
    setTimeout(()=>stop.abort(),25);
    await Promise.race([job,new Promise<never>((_,reject)=>
      setTimeout(()=>reject(Error('SILENT_SHUTDOWN_STALLED')),650))]);
    expect(records.length).toBeGreaterThanOrEqual(1);
  });
});
