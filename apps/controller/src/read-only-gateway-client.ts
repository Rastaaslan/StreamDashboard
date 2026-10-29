import {createHash,timingSafeEqual,X509Certificate} from 'node:crypto';
import {request as httpsRequest} from 'node:https';
import {isIP} from 'node:net';
import type {AgentObservation} from '../../../packages/contracts/src/agent-v2.js';
import {observationFreshness} from '../../../packages/contracts/src/agent-v2.js';
import type {ObsHealth} from '../../agent/src/read-only-observer.js';

export interface ReadOnlyAgentPeer {
  url:string;
  expectedDeviceId:string;
  serverCertificate:string|Buffer;
  serverFingerprint:string;
  clientCertificate:string|Buffer;
  clientKey:string|Buffer;
  timeoutMs?:number;
}
const validId=(s:string)=>/^[A-Za-z0-9_-]{1,96}$/.test(s);
const fingerprint=(certificate:Buffer)=>createHash('sha256').update(certificate).digest();
function isPrivateNumericAddress(host:string):boolean {
  const literal=host.replace(/^\[|\]$/g,'');
  if(literal==='::1')return true;
  if(isIP(literal)!==4)return false;
  const a=literal.split('.').map(Number);
  return a[0]===127||a[0]===10||
    (a[0]===172&&a[1]>=16&&a[1]<=31)||
    (a[0]===192&&a[1]===168)||
    (a[0]===100&&a[1]>=64&&a[1]<=127);
}
function checkedEndpoint(input:string):URL {
  let url:URL;
  try{url=new URL(input)}catch{throw Error('INVALID_AGENT_ENDPOINT')}
  if(url.protocol!=='https:'||!isPrivateNumericAddress(url.hostname)||url.username||
     url.password||url.search||url.hash||url.pathname!=='/v2/obs/health')
    throw Error('INVALID_AGENT_ENDPOINT');
  return url;
}
function verifiedObservation(raw:unknown,expected:string,now:number):AgentObservation<ObsHealth> {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('INVALID_AGENT_OBSERVATION');
  const v=raw as AgentObservation<ObsHealth>;
  if(v.sourceDeviceId!==expected||observationFreshness(v,now)!=='fresh'||
    !v.payload||typeof v.payload!=='object'||v.payload.connected!==true||
    typeof v.payload.active!=='boolean')throw Error('INVALID_AGENT_OBSERVATION');
  for(const field of ['outputBytes','skippedFrames','renderedFrames'] as const){
    const n=v.payload[field];
    if(n!==null&&(typeof n!=='number'||!Number.isFinite(n)||n<0))
      throw Error('INVALID_AGENT_OBSERVATION');
  }
  return v;
}
/** A read-only Controller peer. TLS pinning is validated before any HTTP
 * payload is sent. No retries, command routes, secret logging or LAN binding.
 */
export async function readPinnedAgentHealth(peer:ReadOnlyAgentPeer,now=Date.now()):
  Promise<AgentObservation<ObsHealth>> {
  const url=checkedEndpoint(peer.url);
  if(!validId(peer.expectedDeviceId)||!Number.isFinite(now)||
    !peer.clientCertificate||!peer.clientKey||!peer.serverCertificate)
    throw Error('INVALID_PEER_CONFIG');
  const value=peer.serverFingerprint.replaceAll(':','').toLowerCase();
  if(!/^[a-f0-9]{64}$/.test(value))throw Error('INVALID_SERVER_FINGERPRINT');
  const expected=Buffer.from(value,'hex');
  const trustedCert=new X509Certificate(peer.serverCertificate);
  if(!timingSafeEqual(fingerprint(trustedCert.raw),expected))
    throw Error('SERVER_CERTIFICATE_PIN_MISMATCH');
  const timeout=peer.timeoutMs??5000;
  if(!Number.isSafeInteger(timeout)||timeout<500||timeout>10000)
    throw Error('INVALID_PEER_TIMEOUT');

  return new Promise((resolve,reject)=>{
    const req=httpsRequest(url,{
      method:'GET',agent:false,ca:peer.serverCertificate,
      cert:peer.clientCertificate,key:peer.clientKey,rejectUnauthorized:true,
      minVersion:'TLSv1.3',maxVersion:'TLSv1.3',
      checkServerIdentity(_hostname,cert) {
        try{
          const x=new X509Certificate(cert.raw);
          const t=Date.now();
          if(Date.parse(x.validFrom)>t||Date.parse(x.validTo)<=t||
            !timingSafeEqual(fingerprint(cert.raw),expected))
            return Error('SERVER_CERTIFICATE_PIN_MISMATCH');
          return undefined;
        }catch{return Error('INVALID_SERVER_CERTIFICATE')}
      },
    },res=>{
      if(res.statusCode!==200||
        !String(res.headers['content-type']??'').startsWith('application/json')){
        res.resume();reject(Error('AGENT_STATUS_UNAVAILABLE'));return;
      }
      let size=0;const chunks:Buffer[]=[];
      res.on('data',(chunk:Buffer)=>{
        size+=chunk.length;
        if(size>16_384){req.destroy(Error('AGENT_RESPONSE_TOO_LARGE'));return}
        chunks.push(chunk);
      });
      res.on('end',()=>{
        try{
          resolve(verifiedObservation(
            JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown,
            peer.expectedDeviceId,Math.max(now,Date.now())));
        }catch(e){reject(e instanceof Error?e:Error('INVALID_AGENT_OBSERVATION'))}
      });
      res.on('error',reject);
    });
    req.setTimeout(timeout,()=>req.destroy(Error('AGENT_REQUEST_TIMEOUT')));
    req.on('error',reject);req.end();
  });
}
