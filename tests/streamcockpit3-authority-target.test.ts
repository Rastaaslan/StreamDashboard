import {it,expect} from 'vitest';
// @ts-expect-error browser module has no TypeScript declaration.
import {liveControlTarget} from '../apps/mobile/control/streamcockpit-authority-target.js';
it('F02/F04/F08 laptop commands keep FIXE as target while local chat has its own runtime',()=>{
  const base={server:'https://fixe:48136',localEndpoint:'http://127.0.0.1:48135',clientRole:true,online:true,sourceKey:'https://fixe:48136'};
  expect(liveControlTarget(base)).toBe(base.server);
  for(const patch of [{online:false},{server:''},{sourceKey:base.localEndpoint},
    {server:base.localEndpoint,sourceKey:base.localEndpoint}])
    expect(()=>liveControlTarget({...base,...patch})).toThrow('REGIE_CONTROL_UNAVAILABLE');
  expect(liveControlTarget({server:'http://127.0.0.1:48133',localEndpoint:'http://127.0.0.1:48133',clientRole:false,online:true,sourceKey:'http://127.0.0.1:48133'})).toBe('http://127.0.0.1:48133');
});
