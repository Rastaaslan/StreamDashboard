import {request as requestHttps} from 'node:https';
import {createHash,randomUUID} from 'node:crypto';
import type {TLSSocket} from 'node:tls';
import type {MaintenanceOfflineWitness} from './streamcockpit-external-maintenance.js';
export interface PeerMaintenanceObserverConfiguration {
 peer:{origin:string;fingerprint:string;credential:string};
}
const denied=()=>new Error('SC3_PEER_MAINTENANCE_UNAVAILABLE');
export function validatePeerMaintenanceObserver(value:unknown):PeerMaintenanceObserverConfiguration{
 const c=value as PeerMaintenanceObserverConfiguration,p=c?.peer;
 if(!c||Object.keys(c).join()!=='peer'||!p||Object.keys(p).sort().join()!=='credential,fingerprint,origin'||
  typeof p.origin!=='string'||typeof p.credential!=='string'||p.credential.length<16||p.credential.length>256||
  /[\x00-\x20\x7f]/.test(p.credential)||typeof p.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(p.fingerprint))throw denied();
 const u=new URL(p.origin);
 if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/'||u.origin!==p.origin)throw denied();
 return structuredClone(c);
}
/** Independent fixed GET on the paired FIXE, with its independently saved leaf
 * pin. Device credential is sent ONLY after the TLS peer has matched the pin.
 * No redirects, provider token, configuration write, reconnect or command. */
export function createPeerMaintenanceObserver(input:PeerMaintenanceObserverConfiguration){
 const config=validatePeerMaintenanceObserver(input).peer,session=randomUUID();
 let closed=false,active:ReturnType<typeof requestHttps>|undefined;
 const observe=():Promise<MaintenanceOfflineWitness|undefined>=>new Promise(resolve=>{
  if(closed||active){resolve(undefined);return}
  const started=Date.now();let settled=false;
  const finish=(value?:MaintenanceOfflineWitness)=>{if(settled)return;settled=true;
   clearTimeout(timer);active?.destroy();active=undefined;resolve(value)};
  const timer=setTimeout(()=>finish(),4500);
  const req=requestHttps(new URL('/api/v1/maintenance/safety',config.origin),{
   method:'GET',agent:false,rejectUnauthorized:false,headers:{Authorization:'Device '+config.credential,'Cache-Control':'no-store'},
  },response=>{
   if(response.statusCode!==200){finish();return}
   let bytes=0,body='';
   response.setEncoding('utf8');response.on('data',(chunk:string)=>{
    bytes+=Buffer.byteLength(chunk);if(bytes>65536)finish();else body+=chunk;
   });
   response.once('error',()=>finish());response.once('end',()=>{
    try{
     const value=JSON.parse(body),at=Date.now();
     if(closed||at-started>4500||at<started||value.authority!=='fixe'||value.safe!==true||
      !Number.isSafeInteger(value.observedAt)||at-value.observedAt< -1000||at-value.observedAt>4500){finish();return}
     finish({authority:'fixe-independent',session,observedAt:at,obs:'idle',twitch:'offline'});
    }catch{finish()}
   });
  });
  active=req;
  req.once('error',()=>finish());
  req.once('socket',socket=>{
   const tls=socket as TLSSocket;
   tls.once('secureConnect',()=>{
    try{
     const raw=tls.getPeerCertificate().raw;
     if(!raw||createHash('sha256').update(raw).digest('hex')!==config.fingerprint){finish();return}
     if(closed||Date.now()-started>4500){finish();return}
     req.end();
    }catch{finish()}
   });
  });
 });
 return {observe,async close(){closed=true;active?.destroy();active=undefined}};
}
