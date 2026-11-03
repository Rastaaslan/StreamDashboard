import {EventEmitter} from 'node:events';
import {afterEach,describe,it,expect,vi} from 'vitest';
const {instances,fixture}=vi.hoisted(()=>({
  instances:[] as any[],
  fixture:{
    uuid:'11111111-2222-3333-4444-555555555555',
    secondUuid:'' as string,
    invalidTracks:false,
    disconnectDuringRead:false,
  },
}));
vi.mock('obs-websocket-js',()=>({default:class extends EventEmitter{
  constructor(){super();instances.push(this)}
  connect=vi.fn(async()=>{});
  disconnect=vi.fn(async()=>{});
  calls=0;
  call=vi.fn(async(type:string)=>{
    switch(type){
      case 'GetVersion':return {obsVersion:'30.0',obsWebSocketVersion:'5.3.1'};
      case 'GetCurrentProgramScene':return {currentProgramSceneName:'Live'};
      case 'GetSceneList':return {scenes:[]};
      case 'GetStreamStatus':case 'GetRecordStatus':return {outputActive:false};
      case 'GetInputList':
        this.calls++;
        return {inputs:[{inputName:'Game Audio',inputKind:'wasapi_input_capture',
          inputUuid:this.calls>=3 && fixture.secondUuid?fixture.secondUuid:fixture.uuid}]};
      case 'GetInputMute':return {inputMuted:false};
      case 'GetInputVolume':return {inputVolumeMul:0.8,inputVolumeDb:-2};
      case 'GetSceneItemList':return {sceneItems:[]};
      case 'GetSpecialInputs':return {};
      case 'GetInputAudioTracks':
        if(fixture.disconnectDuringRead)this.emit('ConnectionClosed',{code:1006});
        return {inputAudioTracks: fixture.invalidTracks?{'1':false}:
          {'1':true,'2':false,'3':true,'4':false,'5':false,'6':false}};
      case 'GetInputAudioMonitorType':return {monitorType:'OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT'};
      default:return {};
    }
  });
}}));
import {ObsClient} from '../integrations/obs/src/client.js';
afterEach(()=>{
  instances.length=0;
  fixture.secondUuid='';fixture.invalidTracks=false;fixture.disconnectDuringRead=false;
});
describe('F05 OBS genuine six tracks and monitoring, no VOD inference',()=>{
  it('reads only on demand with OBS UUID and no Set* requests',async()=>{
    const c=new ObsClient('ws://fake','');
    try{
      await c.connect();
      const socket=instances.at(-1);
      const before=socket.call.mock.calls.length;
      const result=await c.readMixerRouting('Game Audio');
      expect(result).toMatchObject({sourceId:'Game Audio',generation:0,
        kind:'streamcockpit-obs-audio-routing',
        monitorType:'OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT',
        vodTrack:'unverified'});
      expect(result.tracks).toEqual([1,2,3,4,5,6].map(number=>({number,enabled:number===1||number===3})));
      const newCalls=socket.call.mock.calls.slice(before);
      expect(newCalls.map(([name]:[string])=>name)).toEqual([
        'GetInputList','GetInputAudioTracks','GetInputAudioMonitorType','GetInputList',
      ]);
      expect(newCalls.every(([method]:[string])=>method.startsWith('Get'))).toBe(true);
      expect(JSON.stringify(result)).not.toContain(fixture.uuid);
    }finally{await c.close()}
  });
  it('fails closed on missing or malformed route flags',async()=>{
    const c=new ObsClient('ws://fake','');
    try{await c.connect();fixture.invalidTracks=true;
      await expect(c.readMixerRouting('Game Audio')).rejects.toThrow(/tracks invalid/);
      await expect(c.readMixerRouting('nonexistent')).rejects.toThrow(/UUID unavailable/);
    }finally{await c.close()}
  });
  it('refuses a switched OBS UUID before releasing a route observation',async()=>{
    const c=new ObsClient('ws://fake','');
    try{
      await c.connect();
      fixture.secondUuid='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
      await expect(c.readMixerRouting('Game Audio')).rejects.toThrow(/changed/);
    }finally{await c.close()}
  });
  it('revokes a route read if OBS closes while a request is in flight',async()=>{
    const c=new ObsClient('ws://fake','');
    try{
      await c.connect();fixture.disconnectDuringRead=true;
      await expect(c.readMixerRouting('Game Audio')).rejects.toThrow();
      expect(c.state.connected).toBe(false); // OBS transport was revoked before any routing observation was exposed.
    }finally{await c.close()}
  });
});
