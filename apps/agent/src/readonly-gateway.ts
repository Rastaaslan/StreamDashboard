import {createServer, type Server as HttpsServer} from 'node:https';
import {createHash, timingSafeEqual, X509Certificate} from 'node:crypto';
import type {TLSSocket} from 'node:tls';
import type {AgentObservation} from '../../../packages/contracts/src/agent-v2.js';
import {observationFreshness} from '../../../packages/contracts/src/agent-v2.js';
import type {ObsHealth} from './read-only-observer.js';

/** Experimental read-only TLS endpoint: not started by any production entrypoint.
 * The Controller certificate fingerprint must be provisioned out of band.
 * Mutual TLS proves key possession; app-layer pinning verifies the exact
 * client certificate even when that certificate is self-signed.
 */
export interface ReadOnlyGatewayConfig {
  serverKey:string|Buffer;
  serverCertificate:string|Buffer;
  authorizedClientFingerprint:string;
  now():number;
  snapshot():AgentObservation<ObsHealth>|null;
}
export function createReadOnlyGateway(config:ReadOnlyGatewayConfig):HttpsServer {
  const fingerprint=config.authorizedClientFingerprint.replace(/:/g,'').toLowerCase();
  if(!/^[a-f0-9]{64}$/.test(fingerprint))throw new Error('INVALID_CLIENT_FINGERPRINT');
  const trusted=Buffer.from(fingerprint,'hex');
  if(!config.serverKey||!config.serverCertificate)throw new Error('TLS_CERT_REQUIRED');
  return createServer({
    key:config.serverKey,cert:config.serverCertificate,requestCert:true,
    rejectUnauthorized:false, // Exact pinned client cert is checked before ANY response data.
    minVersion:'TLSv1.3',maxVersion:'TLSv1.3',
  },(request,response)=>{
    const reject=(status:number,reason:string)=>{
      response.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store',
        'X-Content-Type-Options':'nosniff'});
      response.end(JSON.stringify({status:reason}));
    };
    const socket=request.socket as TLSSocket;
    let certificate:X509Certificate;
    try{
      const peer=socket.getPeerCertificate(true);
      if(!peer.raw) {reject(403,'FORBIDDEN');return}
      certificate=new X509Certificate(peer.raw);
      const now=config.now();
      if(!Number.isFinite(now)||Date.parse(certificate.validFrom)>now||
        Date.parse(certificate.validTo)<=now) {reject(403,'FORBIDDEN');return}
      const actual=createHash('sha256').update(peer.raw).digest();
      if(actual.length!==trusted.length||!timingSafeEqual(actual,trusted)) {
        reject(403,'FORBIDDEN');return;
      }
    }catch {reject(403,'FORBIDDEN');return}
    if(request.method!=='GET') {reject(405,'METHOD_NOT_ALLOWED');return}
    if(request.url!=='/v2/obs/health') {reject(404,'NOT_FOUND');return}
    try{
      const data=config.snapshot();
      if(!data||observationFreshness(data,config.now())!=='fresh') {
        reject(503,'UNAVAILABLE');return;
      }
      const body=JSON.stringify(data);
      if(body.length>16_384){reject(503,'UNAVAILABLE');return}
      response.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store',
        'X-Content-Type-Options':'nosniff','Content-Length':Buffer.byteLength(body)});
      response.end(body);
    }catch {reject(503,'UNAVAILABLE')}
  });
}

/** Lab-only binding. Never expose this test implementation directly on LAN. */
export async function listenReadOnlyLoopback(config:ReadOnlyGatewayConfig):Promise<HttpsServer>{
  const server=createReadOnlyGateway(config);
  server.headersTimeout=4_000;
  server.requestTimeout=4_000;
  server.keepAliveTimeout=1_000;
  try {
    await new Promise<void>((resolve,reject)=>{
      server.once('error',reject);
      server.listen(0,'127.0.0.1',()=>{server.removeListener('error',reject);resolve()});
    });
    return server;
  }catch(error){server.close();throw error}
}
