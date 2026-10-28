import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {execFileSync} from 'node:child_process';
import {createHash,X509Certificate} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import type {AddressInfo} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {listenReadOnlyLoopback} from '../apps/agent/src/readonly-gateway.js';
import {readPinnedAgentHealth,type ReadOnlyAgentPeer} from '../apps/controller/src/read-only-gateway-client.js';

describe('pinned Controller -> Agent read-only transport (127.0.0.1 LAB)',()=>{
  let temp='',serverKey='',serverCert='',clientKey='',clientCert='',strangerKey='',strangerCert='';
  const sha=(pem:string)=>createHash('sha256').update(new X509Certificate(pem).raw).digest('hex');
  function pair(id:string,extra:string[]){
    const key=path.join(temp,id+'.key'),cert=path.join(temp,id+'.pem');
    execFileSync('openssl',['req','-x509','-nodes','-newkey','rsa:2048',
      '-sha256','-days','2','-keyout',key,'-out',cert,'-subj','/CN=localhost',...extra],
      {stdio:'ignore'});
    return {key,cert};
  }
  beforeAll(async()=>{
    temp=await mkdtemp(path.join(tmpdir(),'sd-controller-transport-'));
    const server=pair('server',['-addext','subjectAltName=DNS:localhost,IP:127.0.0.1',
      '-addext','extendedKeyUsage=serverAuth']);
    const client=pair('controller',['-addext','extendedKeyUsage=clientAuth']);
    const stranger=pair('stranger',['-addext','extendedKeyUsage=clientAuth']);
    [serverKey,serverCert,clientKey,clientCert,strangerKey,strangerCert]=await Promise.all(
      [server.key,server.cert,client.key,client.cert,stranger.key,stranger.cert]
        .map(p=>readFile(p,'utf8')));
  });
  afterAll(async()=>{if(temp)await rm(temp,{recursive:true,force:true})});
  const base=(port:number):ReadOnlyAgentPeer=>({
    url:'https://127.0.0.1:'+port+'/v2/obs/health',expectedDeviceId:'stream',
    serverCertificate:serverCert,serverFingerprint:sha(serverCert),
    clientKey,clientCertificate:clientCert,timeoutMs:1500,
  });

  it('reads a fresh authenticated observation without providing a write channel',async()=>{
    const now=Date.now();let reads=0;
    const server=await listenReadOnlyLoopback({
      serverKey,serverCertificate:serverCert,authorizedClientFingerprint:sha(clientCert),
      now:()=>now,snapshot:()=>{reads++;return {sourceDeviceId:'stream',revision:5,
        observedAt:now-1000,staleAt:now+4000,
        payload:{connected:true,active:false,outputBytes:100,skippedFrames:0,renderedFrames:42}};},
    });
    try{
      const port=(server.address() as AddressInfo).port;
      const result=await readPinnedAgentHealth(base(port),now);
      expect(result.payload.active).toBe(false);
      expect(result.revision).toBe(5);
      expect(reads).toBe(1);
      await expect(readPinnedAgentHealth({
        ...base(port),clientCertificate:strangerCert,clientKey:strangerKey,
      },now)).rejects.toThrow('AGENT_STATUS_UNAVAILABLE');
      expect(reads).toBe(1);
      await expect(readPinnedAgentHealth({...base(port),serverFingerprint:'00'.repeat(32)},now))
        .rejects.toThrow('SERVER_CERTIFICATE_PIN_MISMATCH');
      expect(reads).toBe(1);
      await expect(readPinnedAgentHealth({...base(port),expectedDeviceId:'other'},now))
        .rejects.toThrow('INVALID_AGENT_OBSERVATION');
    }finally{await new Promise<void>(resolve=>server.close(()=>resolve()))}
  });

  it('refuses expired observations, without inventing healthy state',async()=>{
    const now=Date.now();
    const server=await listenReadOnlyLoopback({
      serverKey,serverCertificate:serverCert,authorizedClientFingerprint:sha(clientCert),
      now:()=>now,snapshot:()=>({sourceDeviceId:'stream',revision:6,observedAt:now-9000,
        staleAt:now-100,payload:{connected:true,active:true,outputBytes:null,
          skippedFrames:null,renderedFrames:null}}),
    });
    try{await expect(readPinnedAgentHealth(base((server.address() as AddressInfo).port),now))
      .rejects.toThrow('AGENT_STATUS_UNAVAILABLE')}
    finally{await new Promise<void>(resolve=>server.close(()=>resolve()))}
  });

  it('rejects public, DNS, insecure, credential-bearing and writable endpoints',async()=>{
    for(const url of [
      'http://127.0.0.1:1234/v2/obs/health',
      'https://example.com/v2/obs/health',
      'https://8.8.8.8/v2/obs/health',
      'https://100.128.1.1/v2/obs/health',
      'https://172.15.1.1/v2/obs/health',
      'https://user:secret@127.0.0.1/v2/obs/health',
      'https://127.0.0.1/v2/obs/health?token=secret',
      'https://127.0.0.1/v2/obs/control',
    ])await expect(readPinnedAgentHealth({...base(1234),url})).rejects.toThrow('INVALID_AGENT_ENDPOINT');
  });
  it('recognizes explicit RFC1918 and Tailscale IP literals but still requires a valid pin',async()=>{
    for(const url of ['https://192.168.1.15:49100/v2/obs/health',
      'https://100.103.202.2:49100/v2/obs/health'])
      await expect(readPinnedAgentHealth({...base(1234),url,serverFingerprint:'00'.repeat(32)}))
        .rejects.toThrow('SERVER_CERTIFICATE_PIN_MISMATCH');
  });
});
