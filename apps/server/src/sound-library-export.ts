import {open} from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import type {Sound} from '../../../packages/contracts/src/index.js';
import {AUDIO_MAX,createSoundLibraryExport} from '../../mobile/shared/sound-library.js';

export function createServerSoundLibrary(sounds:()=>Sound[]) {
 return createSoundLibraryExport({uuid:randomUUID,list:sounds,
  hash:async blob=>createHash('sha256').update(new Uint8Array(await blob.arrayBuffer())).digest('hex'),
  load:async id=>{
   const sound=sounds().find(value=>value.id===id);if(!sound)throw new Error('Son introuvable.');
   const source=sound.source,file=await open(source,'r');
   try {
    const before=await file.stat();if(!before.isFile()||!before.size||before.size>AUDIO_MAX)throw new Error('Fichier audio invalide (100 Mo maximum).');
    const bytes=Buffer.alloc(before.size);let offset=0;
    while(offset<bytes.length){const {bytesRead}=await file.read(bytes,offset,Math.min(65536,bytes.length-offset),offset);if(!bytesRead)throw new Error('Fichier modifié pendant sa lecture.');offset+=bytesRead;}
    const after=await file.stat();if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs||sounds().find(value=>value.id===id)?.source!==source)throw new Error('Fichier modifié pendant sa lecture.');
    return {blob:new Blob([bytes]),filename:path.basename(source)};
   }finally{await file.close();}
  },
 });
}
