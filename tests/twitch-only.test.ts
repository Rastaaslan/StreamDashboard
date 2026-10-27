import {afterEach,describe,expect,it,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {ControlService} from '../apps/server/src/control-service.js';
import {defaultControlData} from '../packages/contracts/src/control.js';
import {liveControlState} from '../apps/mobile/control/live-controls.js';
import {isRemoteApiAllowed} from '../apps/server/src/remote-api-policy.js';
const temp:string[]=[];
afterEach(async()=>{for(const p of temp.splice(0))await rm(p,{recursive:true,force:true});});
const id=()=>Math.random().toString(36).slice(2)+'abcd12345';
const action=(kind:string,extra:any={})=>({id:id(),issuedAt:new Date().toISOString(),action:kind,...extra});
async function controller(adapter:any){const dir=await mkdtemp(path.join(os.tmpdir(),'twitch-only-'));temp.push(dir);return ControlService.open(path.join(dir,'control.json'),adapter,()=>{},async()=>{});}
describe('Twitch-only safety',()=>{
 it('starts and stops ONLY Twitch; never calls the YouTube adapter',async()=>{
  const state={twitch:false};
  const live=vi.fn(async(p:string)=>{expect(p).toBe('twitch');return state.twitch;});
  const output=vi.fn(async(p:string,start:boolean)=>{expect(p).toBe('twitch');state.twitch=start;});
  const metadata=vi.fn(async(p:string)=>{expect(p).toBe('twitch');});
  const control=await controller({live,output,metadata,action:vi.fn()});
  const start=await control.execute(action('live.start'));
  expect(start.status).toBe('succeeded');expect(Object.keys(start.platforms||{})).toEqual(['twitch']);
  const stop=await control.execute(action('live.stop'));
  expect(stop.status).toBe('succeeded');expect(Object.keys(stop.platforms||{})).toEqual(['twitch']);
  expect(output).toHaveBeenCalledTimes(2);
  const m={...defaultControlData().configuration.metadata,title:'Twitch',tags:['Minecraft']};
  const changed=await control.execute(action('metadata.apply',{metadata:m,expectedRevision:0}));
  expect(changed.status).toBe('succeeded');expect(Object.keys(changed.platforms||{})).toEqual(['twitch']);
  expect(metadata).toHaveBeenCalledTimes(1);
  await expect(control.execute(action('live.start',{platform:'youtube'}))).rejects.toThrow();
 });
 it('remote YouTube routes are blocked but remote OBS and Twitch still allowed',()=>{
  expect(isRemoteApiAllowed('POST','/v2/actions')).toBe(true);
  expect(isRemoteApiAllowed('GET','/v2/state')).toBe(true);
  for(const r of ['/v2/youtube','/v2/youtube/chat','/v2/youtube/broadcasts','/v2/youtube/channels','/v2/youtube/metadata']){
   expect(isRemoteApiAllowed('GET',r)).toBe(false);
  }
  for(const r of ['/v2/youtube/connect','/v2/youtube/prepare','/v2/youtube/disconnect']){
   expect(isRemoteApiAllowed('POST',r)).toBe(false);
  }
 });
 it('remote live UI computes a single Twitch destination',()=>{
  const now=new Date().toISOString();
  const cfg=defaultControlData().configuration;
  cfg.outputs.twitch={kind:'main',name:''};
  const data:any={configuration:cfg,receipts:[],host:{platforms:{twitch:{live:false,observedAt:now}},state:{obs:{connected:true,streamingKnown:true,streaming:false}},outputStatus:{}}};
  const view=liveControlState(data,true);
  expect(Object.keys(view.destinations)).toEqual(['twitch']);
  expect(view.canStartBoth).toBe(true);
  expect(view.heading).not.toMatch(/YouTube/);
 });
});
