import {AUDIO_CHUNK,AUDIO_MAX,portableSound,sameSound} from '../shared/sound-library.js';
import {createBinaryHash} from '../shared/device-utils.js';

/** A durable batch of additive file copies. Each file commits atomically at its
 * destination; lost replies replay the same identity. Never deletes the source,
 * starts playback, or reconfigures an existing destination sound. */
export async function runSoundLibraryCopy(initial,{read,upload,save}) {
 let job=structuredClone(initial);
 const persist=async()=>{await save(structuredClone(job));};
 for(let index=0;index<job.items.length;index++) {
  const item=job.items[index];if(item.complete)continue;
  let opened;
  try {
   opened=await read(job.source,{workspace:job.sourceWorkspace,operation:'open',soundId:item.id,settings:portableSound(item)});
   if(opened.soundId!==item.id||!sameSound(opened.settings,item)||!Number.isSafeInteger(opened.size)||opened.size<1||opened.size>AUDIO_MAX||!/^[a-f0-9]{64}$/.test(opened.sha256))throw new Error('Description du fichier invalide.');
   if(item.sha256&&(item.sha256!==opened.sha256||item.size!==opened.size))throw new Error('Le fichier source a changé depuis la première tentative. Créez un nouveau transfert.');
   item.sha256=opened.sha256;item.size=opened.size;await persist();
   const parts=[],hash=createBinaryHash();
   for(let offset=0;offset<opened.size;offset+=AUDIO_CHUNK) {
    const response=await read(job.source,{workspace:job.sourceWorkspace,operation:'read',id:opened.id,offset});
    if(response.id!==opened.id||response.offset!==offset||typeof response.chunk!=='string'||response.chunk.length>87384||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(response.chunk))throw new Error('Bloc audio invalide.');
    const bytes=Uint8Array.from(atob(response.chunk),value=>value.charCodeAt(0));
    if(bytes.length!==Math.min(AUDIO_CHUNK,opened.size-offset))throw new Error('Fichier reçu incomplet.');hash.update(bytes);parts.push(bytes);
   }
   if(hash.digest()!==opened.sha256)throw new Error('Empreinte audio différente. Aucun fichier envoyé à la destination.');
   const receipt=await upload(job.target,{file:new Blob(parts),filename:opened.filename,name:item.name,settings:portableSound(item),soundId:item.id,transferId:job.id+'_'+index,expectedWorkspace:job.targetWorkspace});
   if(receipt?.id!==item.id)throw new Error('Publication audio non confirmée.');
   item.complete=true;await persist();
  } finally {if(opened?.id)await read(job.source,{workspace:job.sourceWorkspace,operation:'close',id:opened.id}).catch(()=>{});}
 }
 job.status='completed';delete job.error;await persist();return job;
}
