import {session, type Session} from 'electron';
import {randomUUID} from 'node:crypto';
import {normalizeServer} from '../../mobile/runtime.js';
import {certificateFingerprint} from './agent-certificate.js';
import {ElectronSecretStore} from './secrets.js';

export function normalizeFingerprint(value:string) {
 if(typeof value!=='string'||value.length>200)throw new Error('Empreinte SHA-256 invalide.');
 const normalized=value.replace(/[:\s-]/g,'').toLowerCase();
 if(!/^[a-f0-9]{64}$/.test(normalized))throw new Error('Empreinte SHA-256 invalide.');
 return normalized;
}
export function peerOrigin(value:string) {
 const url=new URL(value);
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new Error('Adresse HTTPS d’agent invalide.');
 const normalized=new URL(normalizeServer(url.origin));
 if(normalized.origin!==url.origin)throw new Error('Adresse HTTPS d’agent invalide.');
 return url.origin;
}

/** Each peer owns an isolated network session. Changing one pin cannot loosen
 * trust for a provider page or another agent, including cached TLS decisions. */
export class PeerTransport {
 private revisions=new Map<string,number>();
 private peers=new Map<string,{fingerprint:string;scope:Session}>();
 constructor(private secrets:ElectronSecretStore){}
 async fingerprint(origin:string){return (await this.secrets.getPeerFingerprints())[peerOrigin(origin)]||'';}
 async trust(origin:string,fingerprint:string,expected:string) {
  origin=peerOrigin(origin);fingerprint=fingerprint?normalizeFingerprint(fingerprint):'';expected=expected?normalizeFingerprint(expected):'';
  this.revisions.set(origin,(this.revisions.get(origin)||0)+1);
  const previous=this.peers.get(origin);this.peers.delete(origin);
  try {await this.secrets.setPeerFingerprint(origin,fingerprint,expected);}
  finally{await previous?.scope.closeAllConnections();}
 }
 private async scope(origin:string) {
  const fingerprint=await this.fingerprint(origin);
  if(!fingerprint)throw new Error('Identité TLS non vérifiée. Collez le lien d’association affiché par cet agent.');
  const existing=this.peers.get(origin);if(existing?.fingerprint===fingerprint)return existing.scope;
  const scope=session.fromPartition('sd-peer-'+randomUUID());
  scope.setCertificateVerifyProc((request,done)=>{
   try {done(request.hostname===new URL(origin).hostname&&certificateFingerprint(request.certificate.data)===fingerprint?0:-2);}
   catch {done(-2);}
  });
  this.peers.set(origin,{fingerprint,scope});return scope;
 }
 readonly fetch:typeof fetch=async(input,init={})=>{
  const address=typeof input==='string'?input:input instanceof URL?input.href:input.url;
  const url=new URL(address);
  if(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname))return fetch(input,init);
  const origin=peerOrigin(url.origin);
  if(!/^\/api\/v[12]\//.test(url.pathname)||url.hash||!['GET','POST','PUT','DELETE'].includes(init.method||'GET'))throw new Error('Requête d’agent invalide.');
  const revision=this.revisions.get(origin)||0;
  const scope=await this.scope(origin);
  if(revision!==(this.revisions.get(origin)||0))throw new Error('L’identité de l’agent vient de changer.');
  return scope.fetch(address,{...init,redirect:'error',credentials:'omit'});
 };
 async close(){const peers=[...this.peers.values()];this.peers.clear();await Promise.all(peers.map(peer=>peer.scope.closeAllConnections()));}
}
