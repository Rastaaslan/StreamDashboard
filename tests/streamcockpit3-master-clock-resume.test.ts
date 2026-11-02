import {expect,it} from 'vitest';
import {chromium} from '@playwright/test';
import {build} from 'esbuild';
import {readFileSync} from 'node:fs';
// @ts-expect-error Browser JS exports intentionally stay in the mobile bundle.
import {createMasterClockProjection} from '../apps/mobile/control/streamcockpit-master-clock.js';

const fixe='https://192.168.1.15:48136',laptop='https://192.168.1.16:48136';
const running={running:true,deadline:1_020_000,remaining:20,duration:60};

it('F00 lifecycle: Android sleep/resume cannot silently resume a stale master countdown',()=>{
  const projection=createMasterClockProjection();
  expect(projection.observe(1_000_000,1_000,fixe)).toBe(true);
  expect(projection.now(3_000,fixe)).toBe(1_002_000);
  expect(projection.seconds(running,3_000,fixe,true)).toBe(18);
  // Page hidden/suspended: the client must not extrapolate the former sample.
  projection.invalidate();
  expect(projection.now(3_500,fixe)).toBeNull();
  expect(projection.seconds(running,3_500,fixe,true)).toBeNull();
  // Offline only freezes LAST host-reported remaining, never a local countdown.
  expect(projection.seconds(running,900_000,fixe,false)).toBe(20);
  expect(projection.observe(1_010_000,4_000,fixe)).toBe(true);
  expect(projection.seconds(running,6_000,fixe,true)).toBe(8);
});

it('F00 source switching, bad responses and stale samples fail closed',()=>{
  const projection=createMasterClockProjection();
  expect(projection.observe(1_000_000,1_000,fixe)).toBe(true);
  expect(projection.seconds(running,1_500,laptop,true)).toBeNull();
  projection.invalidate(); // Pairing transition BEFORE the new agent answers.
  expect(projection.seconds(running,2_000,fixe,true)).toBeNull();
  expect(projection.observe(undefined,2_000,fixe)).toBe(false);
  expect(projection.now(2_000,fixe)).toBeNull();
  expect(projection.observe(1_000_000,3_000,fixe)).toBe(true);
  expect(projection.seconds(running,18_001,fixe,true)).toBeNull();
  expect(projection.seconds(running,2_999,fixe,true)).toBeNull();
});

it('F00 pending GET from before suspend cannot resurrect an old timer',async()=>{
  const projection=createMasterClockProjection();
  const ticket=projection.revision();
  let release:()=>void=()=>{};
  const prior=new Promise<void>(resolve=>{release=resolve});
  const late=prior.then(()=>projection.observeIfCurrent(ticket,1_000_000,5_000,fixe));
  projection.invalidate();
  release();
  expect(await late).toBe(false);
  expect(projection.now(5_000,fixe)).toBeNull();
  const after=projection.revision();
  expect(after).not.toBe(ticket);
  expect(projection.observeIfCurrent(after,1_010_000,6_000,fixe)).toBe(true);
  expect(projection.now(7_000,fixe)).toBe(1_011_000);
  // A late older snapshot on the same ticket must not rewind the display.
  expect(projection.observeIfCurrent(after,1_000_000,7_200,fixe)).toBe(false);
  expect(projection.now(7_300,fixe)).toBeNull();
  expect(projection.revision()).toBe(after+1);
  expect(projection.observeIfCurrent(after,1_013_000,7_400,fixe)).toBe(false);
  const renewed=projection.revision();
  expect(projection.observeIfCurrent(renewed,1_013_000,7_400,fixe)).toBe(true);
  expect(projection.now(7_500,fixe)).toBe(1_013_100);
});

it('F00 malformed authenticated sample also revokes pre-existing HTTP tickets',()=>{
  const projection=createMasterClockProjection();
  const old=projection.revision();
  expect(projection.observeIfCurrent(old,1_000_000,1_000,fixe)).toBe(true);
  expect(projection.observeIfCurrent(old,Number.NaN,2_000,fixe)).toBe(false);
  expect(projection.now(2_000,fixe)).toBeNull();
  expect(projection.revision()).not.toBe(old);
  expect(projection.observeIfCurrent(old,1_002_000,2_100,fixe)).toBe(false);
  expect(projection.observeIfCurrent(projection.revision(),1_002_000,2_100,fixe)).toBe(true);
});

it('F00 integration contract clears clock on background, BFCache, disconnection and all source changes',()=>{
  const code=readFileSync('apps/mobile/control/control.js','utf8');
  expect(code).toContain('const masterClock=createMasterClockProjection();');
  expect(code).toMatch(/visibilitychange[\s\S]{0,110}masterClock\.invalidate\(\)/);
  expect(code).toMatch(/pageshow[\s\S]{0,110}masterClock\.invalidate\(\)/);
  expect(code).toMatch(/catch\(e\)\{online=false;masterClock\.invalidate\(\)/);
  expect((code.match(/masterClock\.invalidate\(\)/g)||[]).length).toBeGreaterThanOrEqual(6);
  expect(code).not.toContain('masterClockSample=');
});

it.skipIf(process.env.MASTER_CLOCK_RESUME_BROWSER_TEST!=='1')(
  'F00 real Edge touch 320px freezes on resume and recovers only after a new FIXE sample',
  async()=>{
    const bundle=await build({stdin:{contents:
      "import {renderMobileHome} from './apps/mobile/control/mobile-five-tab-ui.js';"+
      "import {createMasterClockProjection} from './apps/mobile/control/streamcockpit-master-clock.js';"+
      "globalThis.sc3={renderMobileHome,createMasterClockProjection};",
      resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser'});
    const browser=await chromium.launch({channel:'msedge',headless:true});
    try{
      const page=await browser.newPage({viewport:{width:320,height:720},hasTouch:true});
      const external:string[]=[];
      await page.route('**/*',route=>{external.push(route.request().url());return route.abort()});
      await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><main id="root" style="width:100%;min-width:0;box-sizing:border-box"></main>');
      await page.addStyleTag({content:readFileSync('apps/mobile/control/streamcockpit-mobile-v2.css','utf8')});
      await page.addScriptTag({content:bundle.outputFiles[0].text});
      await page.evaluate(()=>{
        const w=window as any;
        w.projection=w.sc3.createMasterClockProjection();
        w.fixe='https://192.168.1.15:48136';
        w.data={host:{hostname:'FIXE',state:{timer:{running:true,remaining:20,
          duration:60,deadline:1_020_000},obs:{connected:false}},
          planning:[],occurrences:[]},receipts:[]};
        w.paint=(now:number)=>{
          const data=w.data,host=w.fixe;
          document.getElementById('root')!.innerHTML=w.sc3.renderMobileHome({
            data,online:true,server:host,live:{destinations:{twitch:{}},unconfirmed:false},
            esc:String,timerNow:w.projection.now(now,host),
          });
        };
        Date.now=()=>9_999_999_999_999;
        w.projection.observe(1_000_000,1_000,w.fixe);
        w.paint(6_000);
      });
      expect(await page.locator('[data-timer-clock]').textContent()).toBe('00:00:15');
      await page.evaluate(()=>{
        const w=window as any;w.projection.invalidate();w.paint(6_500);
      });
      expect(await page.locator('[data-timer-clock]').textContent()).toBe('--:--:--');
      expect(await page.locator('[data-timer-status]').textContent()).toContain('resynchroniser');
      await page.evaluate(()=>{
        const w=window as any;w.projection.observe(1_010_000,7_000,w.fixe);w.paint(9_000);
      });
      expect(await page.locator('[data-timer-clock]').textContent()).toBe('00:00:08');
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=320)).toBe(true);
      expect(external).toEqual([]);
    }finally{await browser.close()}
  },30_000
);
