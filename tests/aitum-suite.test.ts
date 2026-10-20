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
});
