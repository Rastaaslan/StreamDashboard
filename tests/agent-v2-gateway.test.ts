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

  const fetchFromLab=(port:number,client:'valid'|'none'|'other',route='/v2/obs/health',method='GET'):
    Promise<{code:number;body:string}>=>new Promise((resolve,reject)=>{
    const req=httpsRequest({
      hostname:'127.0.0.1',port,path:route,method,ca:cert,rejectUnauthorized:true,
      ...(client==='none'?{}:{cert:client==='valid'?controllerCert:otherCert,
        key:client==='valid'?controllerKey:otherKey}),
    },res=>{
      let body='';
      res.on('data',chunk=>{body+=String(chunk)});
      res.on('end',()=>resolve({code:res.statusCode??0,body}));
    });
    req.on('error',reject);req.end();
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
});
