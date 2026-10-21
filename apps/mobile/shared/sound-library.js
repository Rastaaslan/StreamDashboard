// Portable catalogue data only: paths, accounts and device outputs stay local.
export const AUDIO_CHUNK = 65536, AUDIO_MAX = 100 * 1024 * 1024;
export const soundIdentity = value => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,100}$/.test(value);
export function portableSound(value) {
 if (!value || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 100
  || typeof value.category !== 'string' || !value.category.trim() || value.category.length > 80
  || typeof value.enabled !== 'boolean' || typeof value.favorite !== 'boolean'
  || !Number.isFinite(value.volume) || value.volume < 0 || value.volume > 1
  || !Number.isInteger(value.cooldownMs) || value.cooldownMs < 0 || value.cooldownMs > 3600000
  || !['stream','monitor'].includes(value.monitoringMode ?? 'stream')
  || !['replace','mix'].includes(value.playbackMode ?? 'replace')) throw new Error('Réglages audio invalides.');
 return {name:value.name.trim(),category:value.category.trim(),enabled:value.enabled,favorite:value.favorite,
  volume:value.volume,cooldownMs:value.cooldownMs,monitoringMode:value.monitoringMode ?? 'stream',playbackMode:value.playbackMode ?? 'replace'};
}
export const sameSound = (left,right) => JSON.stringify(portableSound(left)) === JSON.stringify(portableSound(right));

/** Short-lived immutable exports are bound to the authenticated controller.
 * Every request checks its permission again, including after asynchronous reads.
 * Only registered sounds can be opened. No path is accepted or disclosed. */
export function createSoundLibraryExport({list,load,hash,uuid,now=Date.now}) {
 const snapshots=new Map();let opening=false;
 const remove=id=>{clearTimeout(snapshots.get(id)?.timer);snapshots.delete(id);};
 const touch=value=>{clearTimeout(value.timer);value.expires=now()+300000;value.timer=setTimeout(()=>remove(value.descriptor.id),300000);value.timer.unref?.();};
 const sweep=()=>{for(const [key,value] of snapshots)if(value.expires<now())remove(key);};
 return async function handle(body,owner,guard=()=>{}) {
  guard();sweep();
  if(body.operation==='list') {
   const sounds=await list();guard();
   if(sounds.length>1000)throw new Error('La bibliothèque dépasse 1 000 sons.');
   return {items:sounds.map(sound=>{if(!soundIdentity(sound.id))throw new Error('Identité audio invalide.');return {id:sound.id,...portableSound(sound)};})};
  }
  if(body.operation==='open') {
   if(!soundIdentity(body.soundId)||opening)throw new Error('Fichier invalide ou export déjà en préparation.');
   if(snapshots.size>=8)throw new Error('Huit lectures sont en cours. Fermez-les ou patientez cinq minutes.');
   opening=true;
   try {
    const current=(await list()).find(sound=>sound.id===body.soundId);
    if(!current||!sameSound(current,body.settings))throw new Error('Le son a changé depuis la prévisualisation. Relisez la bibliothèque.');
    const {blob,filename}=await load(body.soundId);guard();
    if(!(blob instanceof Blob)||!blob.size||blob.size>AUDIO_MAX||typeof filename!=='string'||filename.length>200||/[/\\\x00-\x1f]/.test(filename)||!/\.(wav|mp3|ogg|aac|m4a|flac)$/i.test(filename))throw new Error('Fichier audio indisponible ou incompatible (100 Mo maximum).');
    if([...snapshots.values()].reduce((sum,value)=>sum+value.blob.size,0)+blob.size>2*AUDIO_MAX)throw new Error('Trop de fichiers ouverts. Fermez les lectures en cours.');
    const sha256=await hash(blob),latest=(await list()).find(sound=>sound.id===body.soundId);guard();
    if(!latest||!sameSound(current,latest))throw new Error('Le son a changé pendant sa lecture.');
    const descriptor={id:uuid(),soundId:body.soundId,filename,size:blob.size,sha256,settings:portableSound(current)};
    const snapshot={owner,blob,descriptor};touch(snapshot);snapshots.set(descriptor.id,snapshot);return descriptor;
   } finally {opening=false;}
  }
  const snapshot=snapshots.get(body.id);
  if(!snapshot||snapshot.owner!==owner)throw new Error('Lecture expirée ou appartenant à un autre contrôleur. Reprenez le transfert.');
  if(body.operation==='close'){remove(body.id);return {closed:true};}
  if(body.operation!=='read'||!Number.isSafeInteger(body.offset)||body.offset<0||body.offset>=snapshot.blob.size||body.offset%AUDIO_CHUNK)throw new Error('Bloc audio invalide.');
  const bytes=new Uint8Array(await snapshot.blob.slice(body.offset,body.offset+AUDIO_CHUNK).arrayBuffer());guard();
  let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
  touch(snapshot);return {id:body.id,offset:body.offset,chunk:btoa(binary)};
 };
}
