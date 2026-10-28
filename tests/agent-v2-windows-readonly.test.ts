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

  it('enables DPAPI only with both explicit environment options and a local absolute directory',()=>{
    const env={APPDATA:tmpdir(),STREAMDASHBOARD_AGENT_READONLY_OPT_IN:'I_ACCEPT_READ_ONLY'};
    const args=['--once','--use-local-obs-config'];
    expect(parseReadOnlyStartup(args,env).protectedCredentials).toBeUndefined();
    const valid={SD_AGENT_DPAPI_DIR:path.join(tmpdir(),'sd-protected-only'),
      SD_AGENT_DPAPI_OPT_IN:'I_ACCEPT_CURRENT_USER_DPAPI'};
    expect(parseReadOnlyStartup(args,{...env,...valid}).protectedCredentials)
      .toEqual({directory:valid.SD_AGENT_DPAPI_DIR,optIn:valid.SD_AGENT_DPAPI_OPT_IN});
    for(const invalid of [
      {SD_AGENT_DPAPI_DIR:valid.SD_AGENT_DPAPI_DIR},
      {SD_AGENT_DPAPI_OPT_IN:valid.SD_AGENT_DPAPI_OPT_IN},
      {...valid,SD_AGENT_DPAPI_OPT_IN:'yes'},
      {...valid,SD_AGENT_DPAPI_DIR:'relative'},
      {...valid,SD_AGENT_DPAPI_DIR:'\\\\untrusted\\share'},
      {...valid,SD_AGENT_DPAPI_DIR:'//untrusted/share'},
    ])expect(()=>parseReadOnlyStartup(args,{...env,...invalid}))
      .toThrow('WINDOWS_DPAPI_CREDENTIAL_CONFIG_REQUIRED');
  });
  it('uses the provisioned protected password exclusively and clears its plaintext Buffer',async()=>{
    const dir=await mkdtemp(path.join(tmpdir(),'sd-readonly-protected-'));
    const file=path.join(dir,'config.json'),bytes=Buffer.from('FAKE_PROTECTED_OBS_PASSWORD');
    try{
      await writeFile(file,JSON.stringify({server_enabled:true,auth_required:true,
        server_port:4555,server_password:'FAKE_LOCAL_PASSWORD_MUST_NOT_BE_USED'}));
      const requested:string[]=[];
      const result=await loadLocalObsCredential(file,undefined,
        {directory:dir,optIn:'I_ACCEPT_CURRENT_USER_DPAPI'},
        async directory=>{expect(directory).toBe(dir);return {
          get:async id=>{requested.push(id);return bytes},
        }});
      expect(requested).toEqual(['obs_password']);
      expect(result).toEqual({url:'ws://127.0.0.1:4555',password:'FAKE_PROTECTED_OBS_PASSWORD'});
      expect(bytes.equals(Buffer.alloc(bytes.length))).toBe(true);
    }finally{await rm(dir,{recursive:true,force:true})}
  });
  it('never falls back to the configured plaintext password on missing/corrupt DPAPI credentials',async()=>{
    const dir=await mkdtemp(path.join(tmpdir(),'sd-readonly-protected-'));
    const file=path.join(dir,'config.json'),options={
      directory:dir,optIn:'I_ACCEPT_CURRENT_USER_DPAPI' as const};
    try{
      await writeFile(file,JSON.stringify({server_enabled:true,auth_required:true,
        server_port:4555,server_password:'FAKE_LOCAL_PASSWORD_MUST_NOT_BE_USED'}));
      for(const candidate of [null,Buffer.alloc(0),Buffer.from([0xff]),Buffer.alloc(65_537)])
        await expect(loadLocalObsCredential(file,undefined,options,async()=>({
          get:async()=>candidate,
        }))).rejects.toThrow(/^WINDOWS_DPAPI_OBS_CREDENTIAL_UNAVAILABLE$/);
      await expect(loadLocalObsCredential(file,undefined,options,async()=>{
        throw Error('FAKE_ENGINE_ERROR_CONTAINING_SECRET');
      })).rejects.toThrow(/^WINDOWS_DPAPI_OBS_CREDENTIAL_UNAVAILABLE$/);
    }finally{await rm(dir,{recursive:true,force:true})}
  });
  it('validates the actual local OBS authentication and port before reading a protected secret',async()=>{
    const dir=await mkdtemp(path.join(tmpdir(),'sd-readonly-protected-'));
    const file=path.join(dir,'config.json');
    let opened=false;
    try{
      for(const config of [
        {server_enabled:false,auth_required:true,server_port:4555},
        {server_enabled:true,auth_required:false,server_port:4555},
        {server_enabled:true,auth_required:true,server_port:1023},
        {server_enabled:true,auth_required:true,server_port:65536},
        {server_enabled:true,auth_required:true,server_port:4555.5},
        {server_enabled:true,auth_required:true,server_port:'4555'},
      ]){
        await writeFile(file,JSON.stringify(config));
        await expect(loadLocalObsCredential(file,undefined,
          {directory:dir,optIn:'I_ACCEPT_CURRENT_USER_DPAPI'},async()=>{
            opened=true;return {get:async()=>Buffer.from('FAKE')};
          })).rejects.toThrow('OBS_CONFIG_UNQUALIFIED');
      }
      expect(opened).toBe(false);
    }finally{await rm(dir,{recursive:true,force:true})}
  });

});
