import { describe, it, expect, vi } from 'vitest';
import { AitumSuiteOutputs } from '../integrations/obs/src/aitum-suite.js';

const routes = (name: string) => ['Start','Stop'].map(operation => `AitumStreamSuite${operation}Output${name}`);
describe('Installed Stream Suite 1.2.4 protocol',()=>{
  it('lists vendor outputs and dispatches only the exact inactive target once',async()=>{
    const outputs=[{name:'Twitch horizontal',type:'stream',active:true},{name:'YouTube horizontal',type:'stream',active:false}];
    const request=vi.fn(async(type:string,_data:Record<string,string>)=>type==='version'?{success:true,version:'1.2.4'}:type==='get_outputs'?{success:true,outputs}:{success:true});
    const suite=new AitumSuiteOutputs(request,async()=>outputs.flatMap(output=>routes(output.name)));
    expect(await suite.inspect()).toEqual({version:'1.2.4',outputs});
    await suite.set('Twitch horizontal',true);await suite.set('YouTube horizontal',true);
    expect(request.mock.calls.filter(([type])=>type.startsWith('start_'))).toEqual([['start_output',{output:'YouTube horizontal'}]]);
    expect(outputs[1].active).toBe(false);
  });
  it('rejects missing, duplicate, non-stream and malformed targets without dispatch',async()=>{
    let outputs:unknown[]=[];
    const request=vi.fn(async(_type:string,_data:Record<string,string>)=>({success:true,outputs}));const suite=new AitumSuiteOutputs(request,async()=>routes('YouTube'));
    await expect(suite.set('YouTube',true)).rejects.toThrow('absente');
    outputs=[{name:'YouTube',type:'record',active:false}];await expect(suite.set('YouTube',true)).rejects.toThrow('diffusion');
    outputs=[{name:'YouTube',type:'stream',active:false},{name:'YouTube',type:'stream',active:false}];await expect(suite.set('YouTube',true)).rejects.toThrow('ambiguë');
    outputs=[{name:'YouTube',type:'stream',active:'false'}];await expect(suite.set('YouTube',true)).rejects.toThrow('invalide');
    expect(request.mock.calls.every(call=>call[0]==='get_outputs')).toBe(true);
  });
  it('retains vendor failure and never retries a failed dispatch automatically',async()=>{
    const request=vi.fn(async(type:string,_data:Record<string,string>)=>type==='get_outputs'?{success:true,outputs:[{name:'YouTube',type:'stream',active:false}]}:{success:false,error:'output not found'});
    const suite=new AitumSuiteOutputs(request,async()=>routes('YouTube'));await expect(suite.set('YouTube',true)).rejects.toThrow('output not found');
    expect(request.mock.calls.filter(([type])=>type==='start_output')).toHaveLength(1);
  });
  it.each([[],[...routes('YouTube'),'AitumStreamSuiteStartOutputYouTube'],routes('YouTube other')].map(hotkeys=>({hotkeys})))('refuses absent, duplicate or wrong exact hotkey routing',async({hotkeys})=>{
    const request=vi.fn(async(type:string,_data:Record<string,string>)=>type==='get_outputs'?{success:true,outputs:[{name:'YouTube',type:'stream',active:false}]}:{success:true});
    const suite=new AitumSuiteOutputs(request,async()=>hotkeys);
    await expect(suite.set('YouTube',true)).rejects.toThrow(/Routage.*ambigu/);
    expect(request.mock.calls.every(([type])=>type==='get_outputs')).toBe(true);
  });
  it('rejects embedded NUL names before the C-string vendor could route their prefix',async()=>{
    const request=vi.fn(async()=>({success:true}));
    const suite=new AitumSuiteOutputs(request,async()=>routes('YouTube'));
    await expect(suite.set('YouTube\u0000other',true)).rejects.toThrow('invalide');
    expect(request).not.toHaveBeenCalled();
  });
  it('cancels dispatch when the connection changes during route inspection',async()=>{
    let current=true;
    const request=vi.fn(async()=>({success:true,outputs:[{name:'YouTube',type:'stream',active:false}]}));
    const suite=new AitumSuiteOutputs(request,async()=>{current=false;return routes('YouTube');});
    await expect(suite.set('YouTube',true,()=>{if(!current)throw new Error('Connexion remplacée');})).rejects.toThrow('remplacée');
    expect(request).toHaveBeenCalledTimes(1);
  });
  it.each([true,false])('confirms a lost %s acknowledgement by reading the exact output without repeating its hotkey',async(active)=>{
    const outputs=[{name:'YouTube',type:'stream',active:!active}];
    const request=vi.fn(async(type:string,_data:Record<string,string>)=>{
      if(type==='get_outputs')return {success:true,outputs};
      outputs[0].active=active;throw new Error('Reply lost');
    });
    const suite=new AitumSuiteOutputs(request,async()=>routes('YouTube'));
    await expect(suite.set('YouTube',active)).resolves.toBeUndefined();
    expect(request.mock.calls.filter(([type])=>type===(active?'start_output':'stop_output'))).toHaveLength(1);
    expect(request.mock.calls.filter(([type])=>type==='get_outputs')).toHaveLength(2);
  });
  it.each([new Error('Reply lost'),Object.assign(new Error('Socket closed'),{code:1006}),undefined])('keeps an unconfirmed or malformed dispatch uncertain and never retries it (%s)',async(failure)=>{
    const request=vi.fn(async(type:string,_data:Record<string,string>)=>{
      if(type==='get_outputs')return {success:true,outputs:[{name:'YouTube',type:'stream',active:false}]};
      if(failure)throw failure;
      return undefined;
    });
    const suite=new AitumSuiteOutputs(request,async()=>routes('YouTube'));
    await expect(suite.set('YouTube',true)).rejects.toMatchObject({name:'ACTION_UNCERTAIN'});
    expect(request.mock.calls.filter(([type])=>type==='start_output')).toHaveLength(1);
    expect(request.mock.calls.filter(([type])=>type==='get_outputs')).toHaveLength(2);
  });
  it('keeps an explicit vendor or OBS request rejection definitive',async()=>{
    for(const rejection of [{success:false,error:'output not found'},Object.assign(new Error('Vendor absent'),{code:600})]){
      const request=vi.fn(async(type:string,_data:Record<string,string>)=>{
        if(type==='get_outputs')return {success:true,outputs:[{name:'YouTube',type:'stream',active:false}]};
        if(rejection instanceof Error)throw rejection;
        return rejection;
      });
      const suite=new AitumSuiteOutputs(request,async()=>routes('YouTube'));
      const error=await suite.set('YouTube',true).catch(value=>value);
      expect(error).toBeInstanceOf(Error);expect(error.name).not.toBe('ACTION_UNCERTAIN');
      expect(request.mock.calls.filter(([type])=>type==='start_output')).toHaveLength(1);
      expect(request.mock.calls.filter(([type])=>type==='get_outputs')).toHaveLength(1);
    }
  });
  it('does not use a replaced connection to confirm a dispatched hotkey',async()=>{
    let current=true;
    const request=vi.fn(async(type:string,_data:Record<string,string>)=>{
      if(type==='get_outputs')return {success:true,outputs:[{name:'YouTube',type:'stream',active:false}]};
      current=false;return {success:true};
    });
    const suite=new AitumSuiteOutputs(request,async()=>routes('YouTube'));
    await expect(suite.set('YouTube',true,()=>{if(!current)throw new Error('Connexion remplacée');})).rejects.toMatchObject({name:'ACTION_UNCERTAIN'});
    expect(request.mock.calls.filter(([type])=>type==='start_output')).toHaveLength(1);
    expect(request.mock.calls.filter(([type])=>type==='get_outputs')).toHaveLength(1);
  });
});
