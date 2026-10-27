import {describe,expect,it} from 'vitest';
import {MOBILE_PANES,paneSlideMotion,PANE_SLIDE_DURATION_MS} from '../apps/mobile/control/mobile-panes.js';
import {micBadgeState} from '../apps/mobile/control/floating-mic-battery.js';

const now=Date.parse('2026-10-25T18:00:00.000Z');
const packet=(at=now)=>({
 status:'ok',source:'dji-mic3-rx-winusb',
 observedAt:new Date(at).toISOString(),
 tx:[
   {slot:1,connected:false,rawGauge:null,level:'unknown',calibration:'none'},
   {slot:2,connected:true,rawGauge:3,level:'uncalibrated',calibration:'raw-only'},
 ],
 rx:{level:'uncalibrated',rawGauge:1,percent:null},
});

describe('Mobile contextual pane structure',()=>{
 it('slides lightly in the travel direction with a 180ms easing curve',()=>{
   const next=paneSlideMotion('next');
   const previous=paneSlideMotion('previous');
   expect(PANE_SLIDE_DURATION_MS).toBe(180);
   expect(next.options.duration).toBe(180);
   expect(next.options.easing).toContain('cubic-bezier');
   expect(next.keyframes[0].transform).toContain('26px');
   expect(previous.keyframes[0].transform).toContain('-26px');
   expect(next.keyframes.at(-1)?.opacity).toBe(1);
 });

 it('includes four predictable panes in each main destination, no YouTube',()=>{
  expect(MOBILE_PANES.live.map(x=>x.id)).toEqual(['chat','micro','sounds','control']);
  expect(MOBILE_PANES.planning.map(x=>x.id)).toEqual(['next','week','events','manage']);
  expect(MOBILE_PANES.deck.map(x=>x.id)).toEqual(['sounds','actions','wizebot','streamlabs']);
  expect(JSON.stringify(MOBILE_PANES).toLowerCase()).not.toContain('youtube');
 });
 it('does not use soundboard or Twitch streaming state as a battery estimate',()=>{
  const value=micBadgeState(packet(),now);
  expect(value.text).toContain('TX2 3/7');
  expect(value.text).toContain('RX 1/7');
  expect(value.text).toContain('TX1 —');
  expect(value.text).not.toMatch(/%|pour\s*cent|100/);
  expect(value.tone).toBe('ok');
 });
 it('only shows full when TX2 gauge 1 is confirmed on RX',()=>{
  const gauge=packet();
  gauge.tx[1].rawGauge=1;
  gauge.tx[1].calibration='rx-display-confirmed-tx2';
  expect(micBadgeState(gauge,now).text).toContain('TX2 plein');
  gauge.tx[1].calibration='raw-only';
  expect(micBadgeState(gauge,now).text).toContain('TX2 1/7');
 });
 it('flags an actual TX wireless disconnection, without calling TX1 absent an emergency',()=>{
  const value=packet();
  value.tx[1].connected=false;value.tx[1].rawGauge=null;
  expect(micBadgeState(value,now,new Set([2]))).toMatchObject({tone:'critical'});
  expect(micBadgeState(value,now,new Set())).toMatchObject({tone:'idle'});
 });
 it('warns on uncalibrated extreme raw codes but does not invent a threshold',()=>{
  const value=packet();value.rx.rawGauge=7;
  expect(micBadgeState(value,now).tone).toBe('check');
  expect(micBadgeState(value,now).detail).toContain('Vérifiez');
 });
 it('never keeps a stale or unauthenticated measure as current',()=>{
  expect(micBadgeState(packet(now-91_000),now).tone).toBe('offline');
  expect(micBadgeState(packet(now+20_000),now).tone).toBe('offline');
  expect(micBadgeState({status:'unavailable'},now).tone).toBe('offline');
 });
});
