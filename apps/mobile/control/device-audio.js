/** Device-owned audio. Every pending read/play is cancelled by Stop; reconnect
 * never replays a command. Mixing is opt-in and leaves existing files intact. */
export function createDeviceAudio({store,onChange=()=>{},onError=()=>{},createAudio=url=>new Audio(url),urls=URL,now=Date.now}) {
 let generation=0,sequence=0,disposed=false;
 const active=new Map(),starting=new Map(),played=new Map();
 const volume=value=>Number.isFinite(Number(value))?Math.min(1,Math.max(0,Number(value))):1;
 const cancelled=()=>Object.assign(new Error('Lecture locale annulée.'),{code:'CANCELED'});
 function release(playback){
  if(!playback||playback.released)return;
  playback.released=true;playback.audio.onended=null;playback.audio.onerror=null;
  try{playback.audio.pause();playback.audio.removeAttribute?.('src');playback.audio.load?.();}catch{}
  urls.revokeObjectURL(playback.url);
 }
 function finish(playback,error){
  if(active.get(playback.id)!==playback)return;
  active.delete(playback.id);release(playback);onChange();
  if(error)onError('Lecture audio impossible sur cet appareil. Vérifiez le fichier et son format.');
 }
 function stop(){
  generation++;starting.clear();const hadAudio=active.size>0;
  for(const playback of active.values())release(playback);active.clear();onChange();
  return {status:'succeeded',message:hadAudio?'Tous les sons sont arrêtés sur cet appareil.':'Aucun son en cours sur cet appareil.'};
 }
 function snapshot(sounds=store.view()?.sounds||{sounds:[]}){
  const assets=store.record.localAssets||{};
  const catalog=(sounds.sounds||[]).map(sound=>({...sound,sourceAvailable:Boolean(assets[sound.id])}));
  for(const playback of active.values()){
   const sound=catalog.find(value=>value.id===playback.soundId);
   if(!sound?.enabled||!sound.sourceAvailable){active.delete(playback.id);release(playback);}
   else playback.audio.volume=volume(sound.volume);
  }
  const activePlaybacks=[...active.values()].map(p=>({soundId:p.soundId,status:p.started?'playing':'starting',...(p.startedAt?{startedAt:p.startedAt}:{})}));
  const pending=[...starting.values()].filter(p=>!active.has(p.id)).map(p=>({soundId:p.soundId,status:'starting'}));
  return {...sounds,sounds:catalog,available:!disposed,localPlayback:true,activePlaybacks:[...activePlaybacks,...pending],currentPlayback:pending.at(-1)||activePlaybacks.at(-1)||null};
 }
 async function play(soundId){
  if(disposed)throw cancelled();
  const initial=store.view()?.sounds.sounds.find(value=>value.id===soundId);
  if(initial?.playbackMode!=='mix'){generation++;starting.clear();}
  if(active.size+starting.size>=8&&initial?.playbackMode==='mix')throw new Error('Huit sons sont déjà en lecture ou en préparation.');
  if([...starting.values()].some(p=>p.soundId===soundId))throw new Error('Ce son est déjà en préparation.');
  const id=++sequence,attempt=generation;starting.set(id,{id,soundId});onChange();
  const check=()=>{if(disposed||attempt!==generation)throw cancelled();};
  let playback;
  try{
   await store.reload();check();
   const sound=store.view()?.sounds.sounds.find(value=>value.id===soundId);
   if(!sound||!sound.enabled)throw new Error('Ce son est absent ou désactivé sur cet appareil.');
   if(sound.playbackMode!==undefined&&!['replace','mix'].includes(sound.playbackMode))throw new Error('Mode de lecture invalide.');
   const cooldown=Number.isFinite(Number(sound.cooldownMs))?Math.max(0,Number(sound.cooldownMs)):0;
   if(played.has(soundId)&&now()-played.get(soundId)<cooldown)throw new Error('Patientez avant de rejouer ce son.');
   const file=await store.soundAsset(soundId);check();
   if(!file?.size)throw new Error('Le fichier audio est indisponible sur cet appareil. Réimportez-le.');
   if(sound.playbackMode==='mix'&&active.size>=8)throw new Error('Huit sons sont déjà en lecture.');
   const url=urls.createObjectURL(file);let audio;
   try{audio=createAudio(url);}catch(error){urls.revokeObjectURL(url);throw error;}
   playback={id,audio,url,soundId,started:false,released:false};
   if(sound.playbackMode!=='mix'){for(const previous of active.values())release(previous);active.clear();}
   active.set(id,playback);audio.volume=volume(sound.volume);audio.preload='auto';
   audio.onended=()=>finish(playback);audio.onerror=()=>finish(playback,true);onChange();
   await audio.play();check();
   if(active.get(id)!==playback){release(playback);throw cancelled();}
   playback.started=true;playback.startedAt=new Date(now()).toISOString();played.set(soundId,now());
   return {status:'succeeded',message:'Lecture sur cet appareil : '+sound.name};
  }catch(error){
   if(playback){active.delete(id);release(playback);}
   if(disposed||attempt!==generation||error?.code==='CANCELED')throw cancelled();
   if(playback)throw new Error('Lecture audio impossible sur cet appareil. Vérifiez le fichier et son format.');
   throw error;
  }finally{starting.delete(id);onChange();}
 }
 return {snapshot,play,stop,dispose(){if(disposed)return;disposed=true;stop();played.clear();}};
}
