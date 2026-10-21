import {normalizeServer} from '../runtime.js';

export function fingerprint(value) {
 const normalized=String(value||'').replace(/[:\s-]/g,'').toLowerCase();
 if(!/^[a-f0-9]{64}$/.test(normalized))throw new Error('Empreinte SHA-256 invalide. Copiez le lien affiché par l’agent.');
 return normalized;
}
export function secureOrigin(value) {
 const url=new URL(value);
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/'||new URL(normalizeServer(url.origin)).origin!==url.origin)throw new Error('Adresse HTTPS locale ou Tailscale attendue.');
 return url.origin;
}
export function createPeerRequest({desktop=globalThis.streamDashboardDesktop,native=globalThis.StreamDashboardPeer,events=globalThis,fetcher=globalThis.fetch}={}) {
 const pending=new Map();
 const uuid=()=>globalThis.crypto?.randomUUID?.()??`peer_${Date.now()}_${Math.random().toString(36).slice(2)}`;
 const failure=value=>Object.assign(new Error(value?.error?.message||'Connexion sécurisée interrompue. Aucune commande ne sera répétée.'),{transportUnavailable:true});
 if(native)events.addEventListener('peer-result',event=>{
  const entry=pending.get(event.detail?.id);if(!entry)return;
  try{entry.resolve(JSON.parse(event.detail.result));}catch{entry.reject(failure());}
 });
 async function nativeCall(operation,value={},timeoutMs=120000) {
  const id=uuid();
  let timer;
  try{return await new Promise((resolve,reject)=>{
   pending.set(id,{resolve,reject});timer=setTimeout(()=>{native.postMessage(JSON.stringify({id:uuid(),operation:'cancel',requestId:id}));reject(failure());},timeoutMs+2000);
   native.postMessage(JSON.stringify({id,operation,...value}));
  });}finally{clearTimeout(timer);pending.delete(id);}
 }
 async function call(operation,value) {
  const result=await nativeCall(operation,value);
  if(!result.ok)throw failure(result);return result.value;
 }
 async function getFingerprint(origin) {
  origin=secureOrigin(origin);
  if(desktop?.getPeerFingerprint)return desktop.getPeerFingerprint(origin);
  if(native)return call('fingerprint',{origin});
  return '';
 }
 async function trust(origin,value,expected) {
  origin=secureOrigin(origin);value=value?fingerprint(value):'';expected=expected?fingerprint(expected):'';
  if(desktop?.trustPeer)return desktop.trustPeer(origin,value,expected);
  if(native)return call('trust',{origin,fingerprint:value,expected});
  throw new Error('L’association par empreinte nécessite l’application Windows ou Android.');
 }
 async function request(url,{method='GET',token='',body,timeoutMs=8000}={}) {
  const address=new URL(url),local=address.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(address.hostname);
  const binary=body instanceof Blob;
  const headers={...(token?{Authorization:'Device '+token}:{}),...(body!==undefined?{'Content-Type':binary?'application/octet-stream':'application/json'}:{})};
  // Old remote addresses remain saved, but cannot receive credentials in cleartext.
  if(address.protocol==='http:'&&!local)throw new Error('Cette association utilise HTTP. Créez un lien HTTPS sur l’agent Next 2.1 pour la renouveler.');
  if(local||(!desktop&&!native))return fetcher(url,{method,headers,body:body===undefined?undefined:binary?body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(timeoutMs)});
  secureOrigin(address.origin);
  let result,uploadId;
  const value={url,method,credential:token,timeoutMs,contentType:binary?'application/octet-stream':'application/json'};
  if(binary&&body.size>100*1024*1024)throw new Error('Fichier audio trop volumineux (100 Mo maximum).');
  try {
   if(desktop?.requestPeer){
    value.id=uuid();value.body=body===undefined?undefined:binary?new Uint8Array(await body.arrayBuffer()):JSON.stringify(body);
    result=await desktop.requestPeer(value);
   }else{
    if(binary){
     uploadId=await call('uploadBegin',{size:body.size});
     for(let offset=0;offset<body.size;offset+=65536){
      const bytes=new Uint8Array(await body.slice(offset,offset+65536).arrayBuffer());
      let encoded='';for(const byte of bytes)encoded+=String.fromCharCode(byte);
      await call('uploadAppend',{uploadId,offset,chunk:btoa(encoded)});
     }
     value.uploadId=uploadId;
    }else if(body!==undefined)value.body=JSON.stringify(body);
    result=await nativeCall('request',value,timeoutMs);
   }
   if(!result.ok)throw failure(result);
   return new Response(result.status===204?null:result.body,{status:result.status,headers:{'Content-Type':'application/json'}});
  }finally{if(uploadId)await call('uploadDiscard',{uploadId}).catch(()=>{});}
 }
 return {request,getFingerprint,trust};
}
