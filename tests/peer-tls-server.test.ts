import {afterEach,expect,it} from 'vitest';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {request as httpsRequest} from 'node:https';
import {X509Certificate} from 'node:crypto';
import {startDashboardServer,type DashboardServerHandle} from '../apps/server/src/index.js';
import {certificateFingerprint} from '../apps/desktop/src/agent-certificate.js';

let server:DashboardServerHandle|undefined,directory='';
afterEach(async()=>{await server?.stop();if(directory)await rm(directory,{recursive:true,force:true});});
const certificate=await readFile(new URL('./fixtures/tls/agent.pem',import.meta.url),'utf8');
const pfx=await readFile(new URL('./fixtures/tls/agent.p12',import.meta.url));
function request(url:string,expected=certificateFingerprint(certificate),body?:unknown,credential='') {
 return new Promise<{status:number;body:any}>((resolve,reject)=>{
  const req=httpsRequest(url,{method:body===undefined?'GET':'POST',ca:certificate,checkServerIdentity:(_host,cert)=>new X509Certificate(cert.raw).fingerprint256.replaceAll(':','').toLowerCase()===expected?undefined:new Error('Wrong pinned certificate'),headers:{'content-type':'application/json',...(credential?{Authorization:'Device '+credential}:{})}},response=>{
   let raw='';response.on('data',chunk=>{raw+=chunk;});response.on('end',()=>{resolve({status:response.statusCode!,body:raw?JSON.parse(raw):null});});
  });req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
 });
}
it('keeps local administration separate from authenticated HTTPS, rejects wrong pins before consuming a code, and reconnects after restart',async()=>{
 directory=await mkdtemp(path.join(tmpdir(),'sd-tls-test-'));
 const boot=()=>startDashboardServer({port:0,remoteEnabled:true,remoteTls:{pfx,passphrase:'test-only',certificate,port:0},dataDir:directory,logger:{info(){},warn(){},error(){}}});
 server=await boot();let origin=`https://127.0.0.1:${server.remotePort}`;
 expect(new URL(server.url).hostname).toBe('127.0.0.1');
 expect((await request(origin+'/api/v2/autonomy')).status).toBe(401);
 const pairing=await fetch(server.url+'/api/v1/remote/pairing',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({management:true})}).then(r=>r.json());
 expect(pairing.fingerprint).toBe(certificateFingerprint(certificate));
 expect(pairing.links.every((link:string)=>link.startsWith('https:')&&link.includes('fingerprint='))).toBe(true);
 expect(pairing.androidLinks.every((link:string)=>link.startsWith('streamdashboard-next://pair?v=2'))).toBe(true);
 await expect(request(origin+'/api/v1/remote/pair','ff'.repeat(32),pairing)).rejects.toThrow('Wrong pinned');
 const paired=await request(origin+'/api/v1/remote/pair',pairing.fingerprint,pairing);expect(paired.status).toBe(201);
 expect((await request(origin+'/api/v2/autonomy',pairing.fingerprint,undefined,paired.body.credential)).status).toBe(200);
 await server.stop();server=await boot();origin=`https://127.0.0.1:${server.remotePort}`;
 expect((await request(origin+'/api/v2/autonomy',pairing.fingerprint,undefined,paired.body.credential)).status).toBe(200);
 expect((await request(origin+'/api/v1/remote/pair',pairing.fingerprint,pairing)).status).toBe(400);
},20000);
it('rejects certificates outside their validity interval',()=>{
 const cert=new X509Certificate(certificate);
 expect(()=>certificateFingerprint(certificate,Date.parse(cert.validFrom)-1)).toThrow(/expiré/);
 expect(()=>certificateFingerprint(certificate,Date.parse(cert.validTo))).toThrow(/expiré/);
});

it('keeps local services available when another process occupies the HTTPS port',async()=>{
 const {createServer}=await import('node:net');const occupied=createServer();
 await new Promise<void>(resolve=>occupied.listen(0,'0.0.0.0',resolve));
 try {
  directory=await mkdtemp(path.join(tmpdir(),'sd-tls-test-'));
  server=await startDashboardServer({port:0,remoteEnabled:true,remoteTls:{pfx,passphrase:'test-only',certificate,port:(occupied.address() as {port:number}).port},dataDir:directory,logger:{info(){},warn(){},error(){}}});
  expect((await fetch(server.url+'/api/v2/autonomy')).status).toBe(200);
  const info=await fetch(server.url+'/api/v1/remote/info').then(r=>r.json());expect(info.enabled).toBe(false);expect(info.error).toMatch(/port HTTPS/);expect(info.urls).toEqual([]);
 }finally{await new Promise<void>(resolve=>occupied.close(()=>resolve()));}
});
