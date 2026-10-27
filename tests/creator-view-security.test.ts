import {describe,expect,it} from 'vitest';
import {isAllowedCreatorViewUrl,isAllowedLiveViewUrl} from '../apps/desktop/src/security.js';

describe('creator links use exact browser destinations',()=>{
 it('allows generated Twitch and YouTube creator destinations through the existing window gate',()=>{
  for(const url of ['https://dashboard.twitch.tv/u/lefeudecampdedam/stream-manager','https://studio.youtube.com/','https://studio.youtube.com/video/abcdefghijk/livestreaming']){
   expect(isAllowedCreatorViewUrl(url)).toBe(true);
   expect(isAllowedLiveViewUrl(url)).toBe(true);
  }
 });
 it('rejects alternate hosts, protocols, credentials, ports and redirect parameters',()=>{
  for(const url of [
   'http://dashboard.twitch.tv/u/dam/stream-manager',
   'https://dashboard.twitch.tv.evil.test/u/dam/stream-manager',
   'https://user:password@dashboard.twitch.tv/u/dam/stream-manager',
   'https://dashboard.twitch.tv:444/u/dam/stream-manager',
   'https://dashboard.twitch.tv/u/dam/stream-manager?redirect=https://evil.test',
   'https://dashboard.twitch.tv/u/dam/stream-manager#script',
   'https://dashboard.twitch.tv/u/dam/settings',
   'https://studio.youtube.com/redirect',
   'https://studio.youtube.com/video/invalid/livestreaming',
   'https://studio.youtube.com/video/abcdefghijk/livestreaming?authuser=1',
   'https://studio.youtube.com.evil.test/video/abcdefghijk/livestreaming',
   'file:///C:/Windows/System32','javascript:alert(1)',
  ])expect(isAllowedCreatorViewUrl(url),url).toBe(false);
 });
});
