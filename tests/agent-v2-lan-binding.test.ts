import {it,expect} from 'vitest';
import {execFileSync} from 'node:child_process';
import {createHash,X509Certificate} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {networkInterfaces,tmpdir} from 'node:os';
import path from 'node:path';
import type {AddressInfo} from 'node:net';
import {listenReadOnlyOnApprovedInterface, type ReadOnlyGatewayConfig} from '../apps/agent/src/readonly-gateway.js';
import {readPinnedAgentHealth} from '../apps/controller/src/read-only-gateway-client.js';

const addresses=Object.values(networkInterfaces()).flat()
  .filter((n):n is NonNullable<typeof n>=>n!==undefined)
  .filter(n=>n.family==='IPv4'&&!n.internal)
  .map(n=>n.address);
const privateAddress=addresses.find(a=>a.startsWith('192.168.')||a.startsWith('100.'))??null;
const config:ReadOnlyGatewayConfig={
  serverCertificate:'lab certificate not a service',
  serverKey:'lab key not a service',
  authorizedClientFingerprint:'ab'.repeat(32),
  now:()=>Date.now(),snapshot:()=>null,
};
const baseline=(addr:string)=>({interfaceAddress:addr,port:0,expireAfterMs:1000,
  experimentalLabOnly:true as const});
it('rejects opt-out, wildcard, public, loopback and unmatched local interfaces',async()=>{
  for(const addr of ['0.0.0.0','8.8.8.8','127.0.0.1','169.254.10.2','192.168.240.254']){
    await expect(listenReadOnlyOnApprovedInterface(config,baseline(addr)))
      .rejects.toThrow('LAN_LAB_BINDING_REFUSED');
  }
  const valid=baseline(privateAddress??'192.168.1.10');
  await expect(listenReadOnlyOnApprovedInterface(config,{
    ...valid,experimentalLabOnly:false as true})).rejects.toThrow('LAN_LAB_BINDING_REFUSED');
  await expect(listenReadOnlyOnApprovedInterface(config,{
    ...valid,expireAfterMs:24*3600*1000})).rejects.toThrow('LAN_LAB_BINDING_REFUSED');
});
it.skipIf(process.env.SD_AGENT_LAN_LAB_TEST!=='1'||!privateAddress)(
  'permits only the pinned mTLS Controller over one local interface, then expires',async()=>{
  const address=privateAddress!;
  const temp=await mkdtemp(path.join(tmpdir(),'sd-lan-tls-fixture-'));
  const make=(name:string,additions:string[])=>{
    const key=path.join(temp,name+'.key'),certificate=path.join(temp,name+'.pem');
    execFileSync('openssl',['req','-x509','-nodes','-newkey','rsa:2048','-days','1',
      '-sha256','-subj','/CN=localhost','-keyout',key,'-out',certificate,
      ...additions],{stdio:'ignore'});
    return {key,certificate};
  };
  let server:Awaited<ReturnType<typeof listenReadOnlyOnApprovedInterface>>|undefined;
  try {
    const host=make('host',['-addext','subjectAltName=IP:'+address,
      '-addext','extendedKeyUsage=serverAuth']);
    const client=make('client',['-addext','extendedKeyUsage=clientAuth']);
    const bad=make('intruder',['-addext','extendedKeyUsage=clientAuth']);
    const [serverKey,serverCertificate,clientKey,clientCertificate,badKey,badCertificate]=
      await Promise.all([host.key,host.certificate,client.key,client.certificate,
        bad.key,bad.certificate].map(p=>readFile(p,'utf8')));
    const sha=(pem:string)=>createHash('sha256').update(new X509Certificate(pem).raw).digest('hex');
    const now=Date.now();let reads=0;
    server=await listenReadOnlyOnApprovedInterface({
      serverKey,serverCertificate,authorizedClientFingerprint:sha(clientCertificate),
      now:()=>Date.now(),snapshot:()=>{reads++;
        return {sourceDeviceId:'stream',revision:7,observedAt:Date.now()-10,
          staleAt:Date.now()+500,payload:{connected:true,active:false,
          outputBytes:0,renderedFrames:11,skippedFrames:0}};},
    },{...baseline(address),expireAfterMs:2500});
    const port=(server.address() as AddressInfo).port;
    const peer={url:'https://'+address+':'+port+'/v2/obs/health',expectedDeviceId:'stream',
      serverFingerprint:sha(serverCertificate),serverCertificate,
      clientCertificate,clientKey,timeoutMs:1200};
    expect((await readPinnedAgentHealth(peer,now)).payload.active).toBe(false);
    expect(reads).toBe(1);
    await expect(readPinnedAgentHealth({...peer,
      clientCertificate:badCertificate,clientKey:badKey})).rejects.toThrow('AGENT_STATUS_UNAVAILABLE');
    expect(reads).toBe(1);
  }finally{
    if(server?.listening)await new Promise<void>(resolve=>server!.close(()=>resolve()));
    await rm(temp,{recursive:true,force:true});
  }
});
