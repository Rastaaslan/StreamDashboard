import {createServer, type Server as HttpsServer} from 'node:https';
import {createHash, timingSafeEqual, X509Certificate} from 'node:crypto';
import type {TLSSocket} from 'node:tls';
import {isIP} from 'node:net';
import type {Duplex} from 'node:stream';
import {networkInterfaces} from 'node:os';
import type {AgentObservation} from '../../../packages/contracts/src/agent-v2.js';
import {observationFreshness} from '../../../packages/contracts/src/agent-v2.js';
import type {ObsHealth} from './read-only-observer.js';

/** Certificate-pinned read-only TLS endpoint shared by the explicit service and labs.
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
    minVersion:'TLSv1.3',maxVersion:'TLSv1.3',handshakeTimeout:4000,
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

/**
 * Explicit opt-in experimental binding to exactly one local private IPv4
 * interface. Never called from production code. The host cannot be a wildcard,
 * public address, DNS name, or a different machine's interface.
 *
 * A lifetime cap makes a lost test process stop listening automatically.
 * Do not mistake this for a shipping service or a persistent trust store.
 */
export interface ReadOnlyLabBinding {
  interfaceAddress:string;
  port:number;
  expireAfterMs:number;
  experimentalLabOnly:true;
}
function privateIpv4(address:string):boolean {
  if(isIP(address)!==4)return false;
  const parts=address.split('.').map(Number);
  return parts[0]===10 ||
    (parts[0]===172&&parts[1]>=16&&parts[1]<=31) ||
    (parts[0]===192&&parts[1]===168) ||
    (parts[0]===100&&parts[1]>=64&&parts[1]<=127);
}
/** Start an ephemeral read-only mTLS laboratory server. */
export async function listenReadOnlyOnApprovedInterface(
  config:ReadOnlyGatewayConfig,binding:ReadOnlyLabBinding,
):Promise<HttpsServer> {
  if(binding?.experimentalLabOnly!==true ||
     !Number.isSafeInteger(binding.port)||binding.port<0||binding.port>65535||
     !Number.isSafeInteger(binding.expireAfterMs)||
     binding.expireAfterMs<500||binding.expireAfterMs>90_000 ||
     !privateIpv4(binding.interfaceAddress))
    throw new Error('LAN_LAB_BINDING_REFUSED');
  const assigned=Object.values(networkInterfaces()).flat()
    .some(i=>i?.family==='IPv4'&&i.address===binding.interfaceAddress&&!i.internal);
  if(!assigned)throw new Error('LAN_LAB_BINDING_REFUSED');
  const server=createReadOnlyGateway(config);
  server.headersTimeout=4_000;
  server.requestTimeout=4_000;
  server.keepAliveTimeout=1_000;
  try{
    await new Promise<void>((resolve,reject)=>{
      server.once('error',reject);
      server.listen(binding.port,binding.interfaceAddress,()=>{
        server.removeListener('error',reject);resolve();
      });
    });
    const expire=setTimeout(()=>server.close(),binding.expireAfterMs);
    expire.unref();
    server.once('close',()=>clearTimeout(expire));
    return server;
  }catch(error){server.close();throw error}
}

const managedSockets=new WeakMap<HttpsServer,Set<Duplex>>();
export interface ManagedReadOnlyBinding {
  interfaceAddress:string;
  port:number;
  optIn:'I_ACCEPT_PRIVATE_MTLS_READ_ONLY';
}
/** Explicit service lifetime owned by its process, never started by default. */
export async function listenManagedReadOnlyGateway(
  config:ReadOnlyGatewayConfig,binding:ManagedReadOnlyBinding,
):Promise<HttpsServer>{
  if(binding?.optIn!=='I_ACCEPT_PRIVATE_MTLS_READ_ONLY'||
     !Number.isSafeInteger(binding.port)||binding.port<0||binding.port>65535||
     !(privateIpv4(binding.interfaceAddress)||binding.interfaceAddress==='127.0.0.1'))
    throw Error('MANAGED_AGENT_BINDING_REFUSED');
  const assigned=Object.values(networkInterfaces()).flat()
    .some(value=>value?.family==='IPv4'&&value.address===binding.interfaceAddress);
  if(!assigned)throw Error('MANAGED_AGENT_BINDING_REFUSED');
  const server=createReadOnlyGateway(config);
  const sockets=new Set<Duplex>();managedSockets.set(server,sockets);
  server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket))});
  server.headersTimeout=4000;server.requestTimeout=4000;server.keepAliveTimeout=1000;
  server.maxConnections=16;
  try{
    await new Promise<void>((resolve,reject)=>{
      server.once('error',reject);
      server.listen(binding.port,binding.interfaceAddress,()=>{server.removeListener('error',reject);resolve()});
    });
    return server;
  }catch(error){server.close();throw error}
}

export async function stopManagedReadOnlyGateway(server:HttpsServer):Promise<void>{
  const stopped=new Promise<void>(resolve=>server.close(()=>resolve()));
  for(const socket of managedSockets.get(server)??[])socket.destroy();
  server.closeAllConnections();
  await stopped;managedSockets.delete(server);
}
