import {it,expect} from 'vitest';
import {chromium} from '@playwright/test';
import {build} from 'esbuild';

it.skipIf(process.env.MIXER_BROWSER_TEST!=='1')(
  'F05 real 320px browser: explicit routing read, no OBS writers, and revocation clears the UI',async()=>{
    const built=await build({stdin:{
      contents:"import {mountMixerPage} from './apps/mobile/control/streamcockpit-mixer-page.js';globalThis.mountMixerPage=mountMixerPage;",
      resolveDir:process.cwd(),
    },bundle:true,write:false,format:'iife',platform:'browser'});
    const browser=await chromium.launch({headless:true,channel:'msedge'});
    try{
      const page=await browser.newPage({viewport:{width:320,height:740},hasTouch:true});
      const external:string[]=[];
      await page.route('**/*',route=>{external.push(route.request().url());return route.abort()});
      await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><main id="root"></main>');
      await page.addScriptTag({content:built.outputFiles[0].text});
      await page.evaluate(()=>{
        const w=window as any;w.calls=[];w.events=[];
        w.page=w.mountMixerPage(document.getElementById('root'),{online:true,
          request:async(path:string)=>{
            w.calls.push(path);
            if(path.startsWith('/api/v1/streamcockpit-mixer/routing?'))return {
              schemaVersion:1,kind:'streamcockpit-obs-audio-routing',sourceId:'Game Audio',
              observedAt:Date.now(),generation:4,monitorType:'OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT',
              tracks:[1,2,3,4,5,6].map(number=>({number,enabled:number===1||number===4})),
              vodTrack:'unverified',
            };
            if(path==='/api/v1/streamcockpit-mixer')return {
              schemaVersion:1,readOnly:true,owner:'FIXE',revision:'obs:4:1',errors:[],outputs:[],
              sources:[{id:'Game Audio',name:'<img src=x onerror=alert(1)> Game Audio',
                gain:{state:'known',value:1},mute:{state:'known',value:false},
                level:{state:'unknown',reason:'not-observed'},
                stream:{state:'unknown',reason:'not-observed'},
                monitor:{state:'unknown',reason:'not-observed'},
                vod:{state:'unknown',reason:'not-observed'},
                device:{state:'unknown',reason:'not-observed'}}],
            };
            throw Error('UNEXPECTED_EXTERNAL_WRITE');
          },
        });
      });
      const button=page.getByRole('button',{name:'Lire les pistes OBS'});
      await expect.poll(()=>button.isEnabled()).toBe(true);
      expect(await page.evaluate(()=>(window as any).calls)).toEqual(['/api/v1/streamcockpit-mixer']);
      await button.click();
      await expect.poll(()=>page.getByLabel('Pistes et monitoring OBS — observation manuelle').textContent())
        .toContain('Pistes OBS activées : 1, 4');
      const body=await page.getByLabel('Pistes et monitoring OBS — observation manuelle').textContent();
      expect(body).toContain('Correspondance piste VOD Twitch : non vérifiée');
      expect(body).not.toContain('OBS_MONITORING_TYPE_');
      expect(await page.locator('img').count()).toBe(0);
      expect(await page.evaluate(()=>(window as any).calls)).toEqual([
        '/api/v1/streamcockpit-mixer',
        '/api/v1/streamcockpit-mixer/routing?sourceId=Game%20Audio',
      ]);
      await page.evaluate(()=>(window as any).page.unavailable());
      expect(await page.getByRole('button',{name:'Lire les pistes OBS'}).count()).toBe(0);
      expect(external).toEqual([]);
    }finally{await browser.close()}
  },30000);
