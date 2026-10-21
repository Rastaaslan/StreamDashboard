/** The native agent owns playback. Disposing a dashboard view only detaches it. */
export function createNativeDeviceAudio({bridge,store,onChange=()=>{}}){
 let observed,disposed=false;
 return {
  async refresh(){try{const value=await bridge.autonomousRequest('state');if(value.workspace!==store.record.workspace)throw new Error('Identité de l’espace autonome différente.');if(!disposed)observed=value.sounds;return value;}catch(error){observed={available:false,activePlaybacks:[],currentPlayback:null};throw error;}},
  snapshot(bundle=store.view()?.sounds||{sounds:[]}){return {...bundle,...observed,sounds:(bundle.sounds||[]).map(sound=>({...sound,sourceAvailable:Boolean(store.record.localAssets?.[sound.id])})),available:!disposed&&observed?.available!==false,localPlayback:true};},
  async stop(){const result=await bridge.autonomousRequest('command',{id:crypto.randomUUID(),issuedAt:new Date().toISOString(),workspace:store.record.workspace,action:'sound.stop'});observed=undefined;onChange();return result;},
  dispose(){disposed=true;},
 };
}
