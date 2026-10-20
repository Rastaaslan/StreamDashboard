/** Playback for the autonomous workspace. Files stay on this device; live/OBS
 * commands never enter this player and no failed play is queued for later. */
export function createDeviceAudio({store,onChange=()=>{},onError=()=>{},createAudio=url=>new Audio(url),urls=URL,now=Date.now}) {
 let current=null,starting=null,generation=0,disposed=false;
 const played=new Map();
 const volume=value=>Number.isFinite(Number(value))?Math.min(1,Math.max(0,Number(value))):1;
 const cancelled=()=>Object.assign(new Error('Lecture locale annulée.'),{code:'CANCELED'});
 function release(playback){
  if(!playback||playback.released)return;
  playback.released=true;playback.audio.onended=null;playback.audio.onerror=null;
  try{playback.audio.pause();playback.audio.removeAttribute?.('src');playback.audio.load?.();}catch{}
  urls.revokeObjectURL(playback.url);
 }
 function finish(playback,error){
  if(current!==playback)return;
  current=null;release(playback);onChange();
  if(error)onError('Lecture audio impossible sur cet appareil. Vérifiez le fichier et son format.');
 }
 function stop(){
  generation++;starting=null;const previous=current;current=null;release(previous);onChange();
  return {status:'succeeded',message:previous?'Son arrêté sur cet appareil.':'Aucun son en cours sur cet appareil.'};
 }
 function snapshot(sounds=store.view()?.sounds||{sounds:[]}){
  const assets=store.record.localAssets||{};
  const catalog=(sounds.sounds||[]).map(sound=>({...sound,sourceAvailable:Boolean(assets[sound.id])}));
  if(current){
   const sound=catalog.find(value=>value.id===current.soundId);
   if(!sound?.enabled||!sound.sourceAvailable){const previous=current;current=null;generation++;release(previous);}
   else current.audio.volume=volume(sound.volume);
  }
  return {...sounds,sounds:catalog,available:!disposed,localPlayback:true,currentPlayback:starting?{soundId:starting.soundId,status:'starting'}:current?{soundId:current.soundId,status:current.started?'playing':'starting',...(current.startedAt?{startedAt:current.startedAt}:{})}:null};
 }
 async function play(soundId){
  if(disposed)throw cancelled();
  const attempt=++generation;starting={soundId,attempt};onChange();
  let playback;
  try{
   await store.reload();
   if(disposed||attempt!==generation)throw cancelled();
   const sound=store.view()?.sounds.sounds.find(value=>value.id===soundId);
   if(!sound||!sound.enabled)throw new Error('Ce son est absent ou désactivé sur cet appareil.');
   const cooldown=Number.isFinite(Number(sound.cooldownMs))?Math.max(0,Number(sound.cooldownMs)):0;
   if(played.has(soundId)&&now()-played.get(soundId)<cooldown)throw new Error('Patientez avant de rejouer ce son.');
   const file=await store.soundAsset(soundId);
   if(disposed||attempt!==generation)throw cancelled();
   if(!file?.size)throw new Error('Le fichier audio est indisponible sur cet appareil. Réimportez-le.');
   const url=urls.createObjectURL(file);
   let audio;
   try{audio=createAudio(url);}catch(error){urls.revokeObjectURL(url);throw error;}
   playback={audio,url,soundId,started:false,released:false};
   release(current);current=playback;
   audio.volume=volume(sound.volume);audio.preload='auto';
   audio.onended=()=>finish(playback);
   audio.onerror=()=>finish(playback,true);
   onChange();
   await audio.play();
   if(disposed||attempt!==generation||current!==playback){release(playback);throw cancelled();}
   playback.started=true;playback.startedAt=new Date(now()).toISOString();played.set(soundId,now());
   return {status:'succeeded',message:'Lecture sur cet appareil : '+sound.name};
  }catch(error){
   if(playback&&current===playback){current=null;release(playback);}
   if(disposed||attempt!==generation||error?.code==='CANCELED')throw cancelled();
   if(playback)throw new Error('Lecture audio impossible sur cet appareil. Vérifiez le fichier et son format.');
   throw error;
  }finally{if(starting?.attempt===attempt)starting=null;onChange();}
 }
 return {snapshot,play,stop,dispose(){if(disposed)return;disposed=true;stop();played.clear();}};
}
