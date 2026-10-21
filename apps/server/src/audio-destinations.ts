import type {AudioPlayback,PlaybackSession} from './soundboard-runtime.js';
/** Explicit OBS/device outputs. An unavailable output never falls back. */
export class AudioDestinations implements AudioPlayback {
  private active?:{audio:AudioPlayback};
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
    if(this.active)await this.stop();
    const result=await target.play(input),current={audio:target};this.active=current;
    void result.finished.finally(()=>{if(this.active===current)this.active=undefined;}).catch(()=>{});
    return result;
  }
  async stop(){const target=this.active;if(!target)return;await target.audio.stop();if(this.active===target)this.active=undefined;}
  async setVolume(volume:number){if(!this.active?.audio.setVolume)throw new Error('Aucune lecture audio à régler.');await this.active.audio.setVolume(volume);}
}
