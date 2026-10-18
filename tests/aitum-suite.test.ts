import { describe, it, expect, vi } from 'vitest';
import { AitumSuiteOutputs } from '../integrations/obs/src/aitum-suite.js';

describe('Installed Stream Suite 1.2.4 protocol',()=>{
  it('lists the vendor outputs and dispatches only the inactive target once',async()=>{
    const outputs=[{name:'Twitch horizontal',type:'stream',active:true},{name:'YouTube horizontal',type:'stream',active:false}];
    const request=vi.fn(async(type:string,_data:Record<string,string>)=>type==='version'?{success:true,version:'1.2.4'}:type==='get_outputs'?{success:true,outputs}:{success:true});
    const suite=new AitumSuiteOutputs(request);
    expect(await suite.inspect()).toEqual({version:'1.2.4',outputs});
    await suite.set('Twitch horizontal',true);await suite.set('YouTube horizontal',true);
    expect(request.mock.calls.filter(([type])=>type.startsWith('start_'))).toEqual([['start_output',{output:'YouTube horizontal'}]]);
    expect(outputs[1].active).toBe(false); // an acknowledgement is not a live confirmation
  });
  it('rejects missing, duplicate, non-stream and malformed targets without dispatch',async()=>{
    let outputs:unknown[]=[];
    const request=vi.fn(async(_type:string,_data:Record<string,string>)=>({success:true,outputs}));const suite=new AitumSuiteOutputs(request);
    await expect(suite.set('YouTube',true)).rejects.toThrow('absente');
    outputs=[{name:'YouTube',type:'record',active:false}];await expect(suite.set('YouTube',true)).rejects.toThrow('diffusion');
    outputs=[{name:'YouTube',type:'stream',active:false},{name:'YouTube',type:'stream',active:false}];await expect(suite.set('YouTube',true)).rejects.toThrow('ambiguë');
    outputs=[{name:'YouTube',type:'stream',active:'false'}];await expect(suite.set('YouTube',true)).rejects.toThrow('invalide');
    expect(request.mock.calls.every(call=>call[0]==='get_outputs')).toBe(true);
  });
  it('retains vendor failure and never retries a failed dispatch automatically',async()=>{
    const request=vi.fn(async(type:string,_data:Record<string,string>)=>type==='get_outputs'?{success:true,outputs:[{name:'YouTube',type:'stream',active:false}]}:{success:false,error:'output not found'});
    const suite=new AitumSuiteOutputs(request);await expect(suite.set('YouTube',true)).rejects.toThrow('output not found');
    expect(request.mock.calls.filter(([type])=>type==='start_output')).toHaveLength(1);
  });
});
