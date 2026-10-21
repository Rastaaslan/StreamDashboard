import {randomUuid,createBinaryHash} from '../shared/planning-engine.js';
import {portableSound} from '../shared/sound-library.js';

const MAX=100*1024*1024,CHUNK=65536;
/** File transfer has its own idempotent protocol. It never sends a playback
 * command, credentials to another origin, or a partially published sound. */
export async function uploadSound({peers,origin,token='',transport,file,filename=file?.name,name,soundId=randomUuid(),transferId=soundId,settings,expectedWorkspace,expectedDeviceId}){
 if(!file?.size||file.size>MAX||!name?.trim()||typeof filename!=='string'||!/\.(wav|mp3|ogg|aac|m4a|flac)$/i.test(filename))throw new Error('Nom et fichier audio requis (100 Mo maximum).');
 const send=transport||(async(path,body,method=body===undefined?'GET':'POST')=>{
  const response=await peers.request(origin+path,{method,token,body,timeoutMs:120000});
  const value=await response.json();if(!response.ok)throw Object.assign(new Error(value.error?.message||'Transfert audio refusé.'),{status:response.status});return value;
 });
 let descriptor;
 try{descriptor=await send('/api/v2/device');}catch(error){if(error.status!==404)throw error;}
 if(expectedDeviceId&&descriptor?.device?.id!==expectedDeviceId)throw new Error('Identité de destination différente. Aucun fichier envoyé.');
 if((settings||expectedWorkspace)&&descriptor?.observed?.soundLibrary?.version!==1)throw new Error('Mettez à jour l’agent de destination pour copier la bibliothèque et ses réglages.');
 if(settings)settings=portableSound(settings);
 if(!descriptor?.observed?.soundTransfer&&descriptor?.device?.platform!=='android')return send('/api/v2/sounds/upload?id='+encodeURIComponent(soundId)+'&name='+encodeURIComponent(name)+'&extension='+encodeURIComponent(filename.split('.').pop())+(settings?'&settings='+encodeURIComponent(JSON.stringify(settings))+'&transfer='+encodeURIComponent(transferId):'')+(expectedWorkspace?'&workspace='+encodeURIComponent(expectedWorkspace):''),file);
 const protocol=descriptor.observed?.soundTransfer;
 if(protocol?.version!==1||protocol.chunkBytes!==CHUNK||protocol.maxBytes<file.size)throw new Error('Mettez à jour l’agent Android pour recevoir ce fichier.');
 const hash=createBinaryHash();for(let offset=0;offset<file.size;offset+=CHUNK)hash.update(new Uint8Array(await file.slice(offset,offset+CHUNK).arrayBuffer()));
 const spec={id:transferId,soundId,name,filename,size:file.size,sha256:hash.digest(),...(settings?{settings}:{}),...(expectedWorkspace?{expectedWorkspace}:{})};
 const started=await send('/api/v2/sounds/transfer/begin',spec);
 if(started.id!==spec.id||started.soundId!==soundId||!Number.isSafeInteger(started.offset)||started.offset<0||started.offset>file.size||started.offset!==file.size&&started.offset%CHUNK)throw new Error('Réponse de transfert Android invalide.');
 if(started.status==='complete')return {id:soundId,name};
 for(let offset=started.offset;offset<file.size;offset+=CHUNK){
  const bytes=new Uint8Array(await file.slice(offset,offset+CHUNK).arrayBuffer());let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
  const receipt=await send('/api/v2/sounds/transfer/chunk',{id:spec.id,offset,chunk:btoa(binary)});
  if(receipt.id!==spec.id||receipt.offset!==offset+bytes.length)throw new Error('Bloc audio non confirmé. Réessayez le même fichier pour reprendre.');
 }
 const receipt=await send('/api/v2/sounds/transfer/finish',{id:spec.id});
 if(receipt.status!=='complete'||receipt.soundId!==soundId)throw new Error('Publication du fichier non confirmée. Réessayez le même fichier pour vérifier.');
 return {id:soundId,name};
}
