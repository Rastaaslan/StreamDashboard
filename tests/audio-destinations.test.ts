import {expect,it,vi} from 'vitest';
import {AudioDestinations} from '../apps/server/src/audio-destinations.js';
import type {AudioPlayback} from '../apps/server/src/soundboard-runtime.js';
const backend=(id:string):AudioPlayback=>({available:true,supportedFormats:['wav','mp3'],supportsVolume:true,supportsStop:true,supportsExplicitOutputSelection:true,outputs:async()=>[{id,name:id,isDefault:false,selectable:true}],play:vi.fn(async()=>({finished:new Promise<void>(()=>{})})),stop:vi.fn(async()=>{}),setVolume:vi.fn(async()=>{})});
it('plays locally without OBS, applies volume, stops the selected output and never falls back',async()=>{
 const obs=backend('obs'),device=backend('device-default');obs.outputs=async()=>{throw Error('offline');};obs.play=vi.fn(async()=>{throw Error('OBS disconnected');});
 const audio=new AudioDestinations(obs,device);
 expect(await audio.outputs()).toEqual(await device.outputs());
 device.outputs=vi.fn(device.outputs);await audio.outputs(true);expect(device.outputs).toHaveBeenCalledWith(true);
 await audio.play({file:'test.mp3',volume:.3,outputId:'device-default'});expect(obs.play).not.toHaveBeenCalled();
 await audio.setVolume(.4);expect(device.setVolume).toHaveBeenCalledWith(.4);
 await audio.stop();expect(device.stop).toHaveBeenCalledTimes(1);
 await expect(audio.play({file:'test.mp3',volume:.3,outputId:'obs'})).rejects.toThrow('OBS disconnected');expect(device.play).toHaveBeenCalledTimes(1);
});
it('completion of an older sound does not forget the next playback on the same output',async()=>{
 const obs=backend('obs'),device=backend('device-default');let finish!:()=>void;
 device.play=vi.fn().mockResolvedValueOnce({finished:new Promise<void>(r=>{finish=r;})}).mockResolvedValue({finished:new Promise<void>(()=>{})});
 const audio=new AudioDestinations(obs,device),input={file:'test.wav',volume:1,outputId:'device-default'};
 await audio.play(input);await audio.play(input);finish();await Promise.resolve();
 await audio.stop();expect(device.stop).toHaveBeenCalledTimes(2);
});
