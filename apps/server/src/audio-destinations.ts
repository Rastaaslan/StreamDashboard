import type {AudioPlayback,PlaybackSession} from './soundboard-runtime.js';
/** Explicit OBS/device outputs. An unavailable output never falls back. */
export class AudioDestinations implements AudioPlayback {
  private active=new Set<{audio:AudioPlayback}>();
  readonly supportsVolume=true;
  readonly supportsStop=true;
  readonly supportsExplicitOutputSelection=true;
  constructor(private obs:AudioPlayback,private device:AudioPlayback) {}
  get available(){return this.obs.available||this.device.available;}
  get supportedFormats(){return [...new Set([...this.obs.supportedFormats,...this.device.supportedFormats])];}
  async outputs(refresh=false){const [obs,device]=await Promise.all([this.obs.outputs(refresh).catch(()=>[]),this.device.outputs(refresh).catch(()=>[])]);return [...obs,...device];}
  async play(input:Parameters<AudioPlayback['play']>[0]):Promise<PlaybackSession> {
    const target=input.outputId==='obs'?this.obs:input.outputId==='device-default'||input.outputId.startsWith('device:')?this.device:undefined;
    if(!target)throw new Error('Sortie audio inconnue.');
    if(input.playbackMode!=='mix'&&this.active.size)await this.stop();
    const result=await target.play(input),current={audio:target};this.active.add(current);
    void result.finished.finally(()=>{this.active.delete(current);}).catch(()=>{});
    return result;
  }
  async stop(){
    const targets=[...new Set([...this.active].map(value=>value.audio))];
    const results=await Promise.allSettled(targets.map(async audio=>{await audio.stop();for(const entry of this.active)if(entry.audio===audio)this.active.delete(entry);}));
    const failure=results.find((result):result is PromiseRejectedResult=>result.status==='rejected');if(failure)throw failure.reason;
  }
  async setVolume(volume:number){
    const targets=[...new Set([...this.active].map(value=>value.audio))];
    if(!targets.length||targets.some(audio=>!audio.setVolume))throw new Error('Aucune lecture audio à régler.');
    await Promise.all(targets.map(audio=>audio.setVolume!(volume)));
  }
}

/** Keep library management usable while its playback engine is disabled. */
export class RoleAudioPlayback implements AudioPlayback {
  readonly supportsVolume:boolean;
  readonly supportsStop=true;
  readonly supportsExplicitOutputSelection:boolean;
  constructor(private readonly backend:AudioPlayback,private readonly enabled:()=>boolean) {
    this.supportsVolume=backend.supportsVolume;this.supportsExplicitOutputSelection=backend.supportsExplicitOutputSelection;
  }
  get available(){return this.enabled()&&this.backend.available;}
  get supportedFormats(){return this.backend.supportedFormats;}
  async outputs(refresh=false){return this.enabled()?this.backend.outputs(refresh):[];}
  async play(input:Parameters<AudioPlayback['play']>[0]){
    if(!this.enabled())throw Object.assign(new Error('Le rôle Audio local est arrêté sur cet appareil.'),{name:'DEVICE_ROLE_STOPPED'});
    return this.backend.play(input);
  }
  stop(){return this.backend.stop();}
  async setVolume(volume:number){
    if(!this.enabled())throw new Error('Le rôle Audio local est arrêté sur cet appareil.');
    if(!this.backend.setVolume)throw new Error('Volume indisponible.');await this.backend.setVolume(volume);
  }
}
