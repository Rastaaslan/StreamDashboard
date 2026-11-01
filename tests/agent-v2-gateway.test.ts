import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {execFileSync} from 'node:child_process';
import {createHash,X509Certificate} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {request as httpsRequest} from 'node:https';
import type {AddressInfo} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {listenReadOnlyLoopback,createReadOnlyGateway} from '../apps/agent/src/readonly-gateway.js';

describe('pinned mutual-TLS read-only Agent gateway (isolated loopback LAB)',()=>{
  let temp='',key='',cert='',controllerKey='',controllerCert='',otherKey='',otherCert='';
  let clientFingerprint='';
  const makeCert=(kind:string,extra:string[])=>{
    const keyFile=path.join(temp,kind+'.key'),certFile=path.join(temp,kind+'.pem');
    execFileSync('openssl',['req','-x509','-nodes','-newkey','rsa:2048',
      '-sha256','-days','1','-keyout',keyFile,'-out',certFile,'-subj','/CN=localhost',...extra],
      {stdio:'ignore'});
    return {keyFile,certFile};
  };
  beforeAll(async()=>{
    temp=await mkdtemp(path.join(tmpdir(),'sd-agent-tls-lab-'));
    const server=makeCert('server',['-addext','subjectAltName=DNS:localhost,IP:127.0.0.1',
      '-addext','extendedKeyUsage=serverAuth']);
    const controller=makeCert('controller',['-addext','extendedKeyUsage=clientAuth']);
    const other=makeCert('stranger',['-addext','extendedKeyUsage=clientAuth']);
    [key,cert,controllerKey,controllerCert,otherKey,otherCert]=await Promise.all([
      server.keyFile,server.certFile,controller.keyFile,controller.certFile,
      other.keyFile,other.certFile].map(p=>readFile(p,'utf8')));
    clientFingerprint=createHash('sha256')
      .update(new X509Certificate(controllerCert).raw).digest('hex');
  });
  afterAll(async()=>{if(temp)await rm(temp,{recursive:true,force:true})});

  const fetchFromLab=(port:number,client:'valid'|'none'|'other',route='/v2/obs/health',method='GET',body?:string):
    Promise<{code:number;body:string}>=>new Promise((resolve,reject)=>{
    const req=httpsRequest({
      hostname:'127.0.0.1',port,path:route,method,ca:cert,rejectUnauthorized:true,
      ...(body?{headers:{'Content-Type':'application/json'}}:{}),
      ...(client==='none'?{}:{cert:client==='valid'?controllerCert:otherCert,
        key:client==='valid'?controllerKey:otherKey}),
    },res=>{
      let body='';
      res.on('data',chunk=>{body+=String(chunk)});
      res.on('end',()=>resolve({code:res.statusCode??0,body}));
    });
    req.on('error',reject);req.end(body);
  });

  it('requires exact pinned client certificate; exposes only a fresh observation',async()=>{
    const now=Date.now();
    const server=await listenReadOnlyLoopback({
      serverKey:key,serverCertificate:cert,authorizedClientFingerprint:clientFingerprint,
      now:()=>now,snapshot:()=>({sourceDeviceId:'stream',revision:3,observedAt:now-500,
        staleAt:now+2000,payload:{connected:true,active:false,outputBytes:0,
          skippedFrames:0,renderedFrames:10}}),
    });
    try{
      const address=server.address() as AddressInfo;
      expect(address.address).toBe('127.0.0.1');
      const okay=await fetchFromLab(address.port,'valid');
      expect(okay.code).toBe(200);
      expect(JSON.parse(okay.body).payload.active).toBe(false);
      expect((await fetchFromLab(address.port,'none')).code).toBe(403);
      expect((await fetchFromLab(address.port,'other')).code).toBe(403);
      expect((await fetchFromLab(address.port,'valid','/v2/obs/health','POST')).code).toBe(405);
      expect((await fetchFromLab(address.port,'valid','/v2/unknown')).code).toBe(404);
    }finally{await new Promise<void>(resolve=>server.close(()=>resolve()))}
  });
  it('does not claim healthy OBS status when the observation has expired',async()=>{
    const now=Date.now();
    const server=await listenReadOnlyLoopback({
      serverKey:key,serverCertificate:cert,authorizedClientFingerprint:clientFingerprint,
      now:()=>now,snapshot:()=>({sourceDeviceId:'stream',revision:3,observedAt:now-5000,
        staleAt:now-1,payload:{connected:true,active:true,outputBytes:null,
          skippedFrames:null,renderedFrames:null}}),
    });
    try{expect((await fetchFromLab((server.address() as AddressInfo).port,'valid')).code).toBe(503)}
    finally{await new Promise<void>(resolve=>server.close(()=>resolve()))}
  });
  it('rejects invalid certificate fingerprint before creating a listener',()=>{
    expect(()=>createReadOnlyGateway({
      serverKey:key,serverCertificate:cert,authorizedClientFingerprint:'not-a-hash',
      now:()=>Date.now(),snapshot:()=>null,
    })).toThrow('INVALID_CLIENT_FINGERPRINT');
  });

  it('keeps a managed mTLS link across simulated OBS disconnect/reconnect, then closes every socket',async()=>{
    const {runManagedReadOnlyAgent,waitReadOnly}=await import('../apps/agent/src/managed-readonly-runtime.js');
    const {AgentHealthSnapshotCache}=await import('../apps/agent/src/health-snapshot-cache.js');
    const {ControllerAgentLink}=await import('../apps/controller/src/agent-link.js');
    const {readPinnedAgentHealth}=await import('../apps/controller/src/read-only-gateway-client.js');
    const {listenManagedReadOnlyGateway,stopManagedReadOnlyGateway}=await import('../apps/agent/src/readonly-gateway.js');
    const stop=new AbortController(),firstDisconnect=new AbortController();
    const cache=new AgentHealthSnapshotCache('stream');
    let attempts=0,resume!:(value:import('../apps/agent/src/managed-readonly-runtime.js').ReadOnlyConnection)=>void;
    const secondConnection=new Promise<import('../apps/agent/src/managed-readonly-runtime.js').ReadOnlyConnection>(resolve=>{resume=resolve});
    const makeConnection=(active:boolean)=>({
      call:async(kind:'GetStats'|'GetStreamStatus')=>kind==='GetStats'?{renderTotalFrames:100}:{outputActive:active},
      close:async()=>{},
    });
    const worker=runManagedReadOnlyAgent({deviceId:'stream',signal:stop.signal,pollMs:10,
      sleep:(_milliseconds,signal)=>waitReadOnly(5,signal),unavailable:()=>cache.invalidate(),
      connect:async()=>++attempts===1?{...makeConnection(false),disconnected:firstDisconnect.signal}:secondConnection,
      emit:value=>cache.accept(value,Date.now()),
    });
    const server=await listenManagedReadOnlyGateway({
      serverKey:key,serverCertificate:cert,authorizedClientFingerprint:clientFingerprint,
      now:Date.now,snapshot:()=>cache.read(Date.now()),
    },{interfaceAddress:'127.0.0.1',port:0,optIn:'I_ACCEPT_PRIVATE_MTLS_READ_ONLY'});
    const port=(server.address() as AddressInfo).port;
    const {connect}=await import('node:net');
    const idle=connect(port,'127.0.0.1');idle.on('error',()=>{});
    const idleClosed=new Promise<void>(resolve=>idle.once('close',()=>resolve()));
    await new Promise<void>(resolve=>idle.once('connect',()=>resolve()));
    const serverPin=createHash('sha256').update(new X509Certificate(cert).raw).digest('hex');
    const link=new ControllerAgentLink(async()=>({
      url:'https://127.0.0.1:'+port+'/v2/obs/health',expectedDeviceId:'stream',
      serverCertificate:cert,serverFingerprint:serverPin,clientCertificate:controllerCert,
      clientKey:controllerKey,dispose(){},
    }),readPinnedAgentHealth,(_milliseconds,signal)=>waitReadOnly(5,signal));
    const until=async(check:()=>boolean)=>{
      const end=Date.now()+4000;
      while(!check()){if(Date.now()>=end)throw Error('MANAGED_TLS_CONDITION_TIMEOUT');await new Promise(resolve=>setTimeout(resolve,5))}
    };
    try{
      link.start();await until(()=>link.snapshot().status==='connected');
      const before=link.snapshot().observation!.revision;
      expect(link.snapshot().observation!.payload.active).toBe(false);
      firstDisconnect.abort();await until(()=>link.snapshot().status==='unavailable');
      expect(link.snapshot().observation).toBeNull();
      resume(makeConnection(true));
      await until(()=>link.snapshot().status==='connected'&&link.snapshot().observation!.payload.active);
      expect(link.snapshot().observation!.revision).toBeGreaterThan(before);
      expect(attempts).toBe(2);
      await link.stop();
      expect(server.listening).toBe(true);
      const last=cache.read(Date.now())!.revision;
      await until(()=>Boolean(cache.read(Date.now())&&cache.read(Date.now())!.revision>last));
      expect(cache.read(Date.now())!.payload.active).toBe(true);
    }finally{
      await link.stop();stop.abort();await worker;
      await stopManagedReadOnlyGateway(server);await idleClosed;
    }
    expect(server.listening).toBe(false);expect(link.snapshot().status).toBe('stopped');
  },15000);

  it('gates production OBS command behind pinned mutual TLS and derives actor identity on the server',async()=>{
    const now=Date.now();
    const received:{actor:string;confirmed:boolean;capability:string}[]=[];
    const state={sourceDeviceId:'stream',revision:23,observedAt:now,staleAt:now+2500,payload:{active:false}};
    const server=await listenReadOnlyLoopback({
      serverKey:key,serverCertificate:cert,authorizedClientFingerprint:clientFingerprint,
      now:()=>now,snapshot:()=>null,
      authorizedControllerDeviceId:'controllerX',authorityObservation:()=>state,
      executeObsCommand:async(command,actor,confirmed)=>{
        received.push({actor,confirmed,capability:command.capability});
        return {commandId:command.commandId,result:'confirmed',observedAt:now,reason:'OBS_STATE_VERIFIED'};
      },
    });
    try{
      const port=(server.address() as AddressInfo).port;
      const payload=JSON.stringify({command:{protocol:2,commandId:'safe1',actorDeviceId:'controllerX',
        targetDeviceId:'stream',capability:'obs.stream.start',issuedAt:now,
        preconditionRevision:23,payload:{}},confirmedCriticalAction:true});
      expect((await fetchFromLab(port,'none','/v2/obs/command','POST',payload)).code).toBe(403);
      expect((await fetchFromLab(port,'other','/v2/obs/command','POST',payload)).code).toBe(403);
      expect(received).toEqual([]);
      const status=await fetchFromLab(port,'valid','/v2/obs/authority');
      expect(status.code).toBe(200);
      expect(JSON.parse(status.body)).toMatchObject(state);
      const accepted=await fetchFromLab(port,'valid','/v2/obs/command','POST',payload);
      expect(accepted.code).toBe(200);
      expect(JSON.parse(accepted.body).result).toBe('confirmed');
      expect(received).toEqual([{actor:'controllerX',confirmed:true,capability:'obs.stream.start'}]);
      const large=await fetchFromLab(port,'valid','/v2/obs/command','POST',JSON.stringify({command:payload.repeat(100)}));
      expect(large.code).toBe(413);
      expect(received).toHaveLength(1);
    }finally{await new Promise<void>(resolve=>server.close(()=>resolve()))}
  });
  it('uses pinned Controller SDK to read authority and submit one no-retry command',async()=>{
    const {readPinnedAgentAuthority,sendPinnedAgentCommand}=await import('../apps/controller/src/agent-command-client.js');
    const now=Date.now(),received:string[]=[];
    const server=await listenReadOnlyLoopback({
      serverKey:key,serverCertificate:cert,authorizedClientFingerprint:clientFingerprint,
      now:()=>now,snapshot:()=>null,
      authorizedControllerDeviceId:'controllerX',
      authorityObservation:()=>({sourceDeviceId:'stream',revision:71,observedAt:now,staleAt:now+5000,payload:{active:false}}),
      executeObsCommand:async(command,actor)=>{
        received.push(actor);
        return {commandId:command.commandId,result:'refused',observedAt:now,reason:'CONFIRMATION_REQUIRED'};
      },
    });
    try{
      const port=(server.address() as AddressInfo).port;
      const serverPin=createHash('sha256').update(new X509Certificate(cert).raw).digest('hex');
      const peer={url:'https://127.0.0.1:'+port+'/v2/obs/health',expectedDeviceId:'stream',
        serverCertificate:cert,serverFingerprint:serverPin,clientCertificate:controllerCert,
        clientKey:controllerKey};
      const observation=await readPinnedAgentAuthority(peer);
      expect(observation).toMatchObject({revision:71,payload:{active:false}});
      const command={protocol:2 as const,commandId:'request_1',actorDeviceId:'controllerX',
        targetDeviceId:'stream',capability:'obs.stream.start' as const,issuedAt:now,
        preconditionRevision:71,payload:{}};
      expect(await sendPinnedAgentCommand(peer,command,false)).toMatchObject({result:'refused',reason:'CONFIRMATION_REQUIRED'});
      expect(received).toEqual(['controllerX']);
      await expect(readPinnedAgentAuthority({...peer,serverFingerprint:'f'.repeat(64)}))
        .rejects.toThrow('AGENT_SERVER_PIN_MISMATCH');
      await expect(sendPinnedAgentCommand({...peer,clientCertificate:otherCert,clientKey:otherKey},
        {...command,commandId:'request_2'},true)).rejects.toThrow('AGENT_COMMAND_ENDPOINT_UNAVAILABLE');
      expect(received).toEqual(['controllerX']);
    }finally{await new Promise<void>(resolve=>server.close(()=>resolve()))}
  });
  it('does not expose writable endpoints unless all writer trust parameters exist',async()=>{
    const config={serverKey:key,serverCertificate:cert,authorizedClientFingerprint:clientFingerprint,
      now:Date.now,snapshot:()=>null};
    expect(()=>createReadOnlyGateway({...config,authorizedControllerDeviceId:'controllerX'}))
      .toThrow('AGENT_WRITER_AUTH_CONFIGURATION_REQUIRED');
    const server=await listenReadOnlyLoopback(config);
    try{
      const port=(server.address() as AddressInfo).port;
      expect((await fetchFromLab(port,'valid','/v2/obs/command','POST','{}')).code).toBe(404);
      expect((await fetchFromLab(port,'valid','/v2/obs/authority')).code).toBe(404);
    }finally{await new Promise<void>(resolve=>server.close(()=>resolve()))}
  });

  it('refuses unmanaged, wildcard, public, and nonlocal service bindings before opening a port',async()=>{
    const {listenManagedReadOnlyGateway}=await import('../apps/agent/src/readonly-gateway.js');
    const config={serverKey:key,serverCertificate:cert,authorizedClientFingerprint:clientFingerprint,
      now:Date.now,snapshot:()=>null};
    for(const host of ['0.0.0.0','8.8.8.8','localhost','10.254.254.254'])
      await expect(listenManagedReadOnlyGateway(config,{interfaceAddress:host,port:0,
        optIn:'I_ACCEPT_PRIVATE_MTLS_READ_ONLY'})).rejects.toThrow('MANAGED_AGENT_BINDING_REFUSED');
    await expect(listenManagedReadOnlyGateway(config,{interfaceAddress:'127.0.0.1',port:0,
      optIn:'no' as never})).rejects.toThrow('MANAGED_AGENT_BINDING_REFUSED');
  });

});
