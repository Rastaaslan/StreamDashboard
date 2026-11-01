import {describe,expect,it} from 'vitest';
import {clientAuthorityEndpoint,clientMustDelegateCommand} from '../apps/mobile/control/client-authority.js';
const owner={id:'stream',name:'PC stream',enabled:true,roles:['obs-executor','controller'],endpoint:'https://192.168.1.15:48136'};
const client={id:'jeu',name:'PC jeu',enabled:true,roles:['controller','audio'],endpoint:''};
const installation={runtimeProfile:'device-runtime',localDeviceId:'jeu',routes:{obs:'stream'},devices:[client,owner]};
describe('StreamCockpit client authority',()=>{
 it('picks only the verified designated stream host, never a local timer',()=>{
  expect(clientAuthorityEndpoint(installation)).toBe('https://192.168.1.15:48136');
  expect(clientAuthorityEndpoint({...installation,routes:{obs:'jeu'}})).toBe('https://192.168.1.15:48136');
  expect(clientAuthorityEndpoint({...installation,runtimeProfile:'root'})).toBe('');
 });
 it('fails closed on absent, disabled, loopback or ambiguous OBS hosts',()=>{
  expect(clientAuthorityEndpoint({...installation,devices:[client]})).toBe('');
  expect(clientAuthorityEndpoint({...installation,devices:[client,{...owner,enabled:false}]})).toBe('');
  expect(clientAuthorityEndpoint({...installation,devices:[client,{...owner,endpoint:'http://127.0.0.1:48135'}]})).toBe('');
  expect(clientAuthorityEndpoint({...installation,devices:[client,{...owner,endpoint:'http://192.168.1.15:48136'}]})).toBe('');
  expect(clientAuthorityEndpoint({...installation,routes:{obs:'unknown'},devices:[client,owner,{...owner,id:'other',endpoint:'https://192.168.1.16:48136'}]})).toBe('');
 });
 it('delegates timer mutations but preserves local non-timer services',()=>{
  for(const type of ['timer.start','timer.pause','timer.reset','timer.add','session.prepare'])
   expect(clientMustDelegateCommand(true,'/api/v1/commands',{type})).toBe(true);
  expect(clientMustDelegateCommand(false,'/api/v1/commands',{type:'timer.start'})).toBe(false);
  expect(clientMustDelegateCommand(true,'/api/v1/commands',{type:'sound.play'})).toBe(false);
  expect(clientMustDelegateCommand(true,'/api/v1/state',undefined)).toBe(false);
 });
});
