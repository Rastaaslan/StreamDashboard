import {expect,it} from 'vitest';
import {chromium} from '@playwright/test';
import {build} from 'esbuild';
import {readFileSync} from 'node:fs';

/** Opt-in real Microsoft Edge viewport test, synthetic FIXE clock only.
 * No OBS/Twitch commands, pairing secret, Android install or network.
 */
it.skipIf(process.env.MASTER_CLOCK_BROWSER_TEST!=='1')(
  'F00 320px Home shows FIXE timer despite device wall-clock skew and fails closed when stale',
  async()=>{
    const bundle=await build({
      stdin:{contents:
        "import {renderMobileHome} from './apps/mobile/control/mobile-five-tab-ui.js';"+
        "import {sampleMasterClock,estimateMasterNow} from './apps/mobile/control/streamcockpit-master-clock.js';"+
        "globalThis.sc3={renderMobileHome,sampleMasterClock,estimateMasterNow};",
        resolveDir:process.cwd()},
      bundle:true,write:false,format:'iife',platform:'browser',
    });
    const browser=await chromium.launch({channel:'msedge',headless:true});
    try{
      const page=await browser.newPage({viewport:{width:320,height:720},hasTouch:true});
      const external:string[]=[];
      await page.route('**/*',route=>{external.push(route.request().url());return route.abort()});
      await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><main id="root" style="min-width:0;width:100%"></main>');
      await page.addStyleTag({content:readFileSync('apps/mobile/control/streamcockpit-mobile-v2.css','utf8')});
      await page.addScriptTag({content:bundle.outputFiles[0].text});
      await page.evaluate(()=>{
        const w=window as any,host='https://192.168.1.15:48136';
        const data={host:{hostname:'FIXE',state:{timer:{running:true,remaining:20,duration:60,deadline:1_020_000},obs:{connected:false}},planning:[],occurrences:[]},receipts:[]};
        w.sc3Args={data,online:true,server:host,live:{destinations:{twitch:{}},unconfirmed:false},esc:String,now:1_000_000};
        // Simulate a phone clock decades away from FIXE. Only the fresh host
        // observation and monotonic elapsed time may drive the countdown.
        Date.now=()=>9_999_999_999_999;
        const sample=w.sc3.sampleMasterClock(1_000_000,1_000,host);
        w.sc3Sample=sample;
        const timerNow=w.sc3.estimateMasterNow(sample,6_000,host);
        document.getElementById('root')!.innerHTML=w.sc3.renderMobileHome({...w.sc3Args,timerNow});
      });
      expect(await page.locator('[data-timer-clock]').textContent()).toBe('00:00:15');
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=320)).toBe(true);
      await page.evaluate(()=>{
        const w=window as any,host=w.sc3Args.server;
        const expired=w.sc3.estimateMasterNow(w.sc3Sample,16_001,host);
        document.getElementById('root')!.innerHTML=w.sc3.renderMobileHome({...w.sc3Args,timerNow:expired??Number.NaN});
      });
      expect(await page.locator('[data-timer-clock]').textContent()).toBe('--:--:--');
      expect(await page.locator('[data-timer-status]').textContent()).toContain('resynchroniser');
      expect(external).toEqual([]);
    }finally{await browser.close()}
  },30000,
);
