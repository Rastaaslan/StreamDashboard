import {createSoundLibraryExport} from '../shared/sound-library.js';
import {hashSound,openSoundTransferStore,SOUND_TRANSFER} from './sound-transfer-store.js';
import {uploadSound} from './sound-transfer.js';
import {randomUuid} from '../shared/planning-engine.js';

export function createLocalSoundLibrary(store) {
 return createSoundLibraryExport({uuid:randomUuid,hash:hashSound,
  list:async()=>{await store.reload();return store.view().sounds.sounds;},
  load:async id=>{await store.reload();const asset=store.record.localAssets?.[id];if(!asset)throw new Error('Fichier absent de cet appareil.');return {blob:await store.soundAsset(id),filename:asset.name};},
 });
}

export async function uploadLocalSound(store,input,device,workspace,guard=()=>{}) {
 const transfer=await openSoundTransferStore(store.scope);
 try {
  return await uploadSound({...input,expectedDeviceId:device.id,transport:async(path,body)=>{
   guard();if(input.expectedWorkspace!==workspace)throw new Error('Identité de l’espace local différente.');
   if(path==='/api/v2/device')return {device,observed:{soundTransfer:SOUND_TRANSFER,soundLibrary:{version:1}}};
   if(path.endsWith('/begin')){await store.indexSoundAsset(body.soundId,guard);return transfer.begin(body,'local',guard);}
   if(path.endsWith('/chunk'))return transfer.append(body.id,body.offset,body.chunk,'local',guard);
   if(path.endsWith('/finish'))return transfer.finish(body.id,'local',guard);
   throw new Error('Opération audio inconnue.');
  }});
 }finally{transfer.close();}
}
