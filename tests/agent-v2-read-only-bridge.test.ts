import {it,expect} from 'vitest';
import {execFileSync} from 'node:child_process';
import {createHash,X509Certificate} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {networkInterfaces,tmpdir} from 'node:os';
import type {AddressInfo} from 'node:net';
import path from 'node:path';
import {startReadOnlyBridgeLab} from '../apps/agent/src/read-only-bridge-lab.js';
import {readPinnedAgentHealth} from '../apps/controller/src/read-only-gateway-client.js';

const address=Object.values(networkInterfaces()).flat()
  .filter((n):n is NonNullable<typeof n>=>n!==undefined)
  .filter(n=>n.family==='IPv4'&&!n.internal)
  .map(n=>n.address)
  .find(a=>a.startsWith('192.168.')||a.startsWith('100.'));
it.skipIf(process.env.SD_AGENT_LAN_LAB_TEST!=='1'||!address)(
 'keeps Controller current only while real read-only polling succeeds (mock OBS lab)',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'sd-bridge-cert-'));
 const make=(name:string,add:string[])=>{
  const key=path.join(dir,name+'.key'),cert=path.join(dir,name+'.pem');
  execFileSync('openssl',['req','-x509','-nodes','-newkey','rsa:2048',
   '-sha256','-days','1','-subj','/CN=localhost','-out',cert,'-keyout',key,...add],
   {stdio:'ignore'});
  return [key,cert];
 };
 const [serverKeyPath,serverCertPath]=make('server',
   ['-addext','subjectAltName=IP:'+address,'-addext','extendedKeyUsage=serverAuth']);
 const [clientKeyPath,clientCertPath]=make('controller',['-addext','extendedKeyUsage=clientAuth']);
 const [serverKey,serverCertificate,clientKey,clientCertificate]=await Promise.all(
   [serverKeyPath,serverCertPath,clientKeyPath,clientCertPath].map(f=>readFile(f,'utf8')));
 const sha=(pem:string)=>createHash('sha256').update(new X509Certificate(pem).raw).digest('hex');
 let fail=false;const callKinds:string[]=[];
 const worker=await startReadOnlyBridgeLab({
  serverKey,serverCertificate,authorizedClientFingerprint:sha(clientCertificate),
  binding:{interfaceAddress:address!,port:0,expireAfterMs:3000,experimentalLabOnly:true},
  deviceId:'stream',pollMs:100,
  client:{async call(kind){callKinds.push(kind);if(fail)throw Error('MOCK_READ_FAILED');
   return kind==='GetStats'?{outputSkippedFrames:0,renderTotalFrames:8}:
     {outputActive:false,outputBytes:123};}},
 });
 const port=(worker.server.address() as AddressInfo).port;
 const peer={url:'https://'+address+':'+port+'/v2/obs/health',
   expectedDeviceId:'stream',serverCertificate,serverFingerprint:sha(serverCertificate),
   clientCertificate,clientKey,timeoutMs:800};
 const delay=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));
 try {
  let healthy=false;
  for(let i=0;i<20&&!healthy;i++){
   try{
    const snap=await readPinnedAgentHealth(peer);
    healthy=snap.payload.connected && snap.payload.renderedFrames===8;
   }catch{await delay(30)}
  }
  expect(healthy).toBe(true);
  expect(new Set(callKinds)).toEqual(new Set(['GetStats','GetStreamStatus']));
  fail=true;
  await delay(180);
  await expect(readPinnedAgentHealth(peer)).rejects.toThrow('AGENT_STATUS_UNAVAILABLE');
 }finally {
  await worker.stop();
  await rm(dir,{recursive:true,force:true});
 }
});
