import {expect,it} from 'vitest';
// @ts-expect-error Browser module is typechecked by check:browser-types
import {renderSettings} from '../apps/mobile/control/settings-view.js';
const esc=(v:unknown)=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;');
function render(server:string,connected:boolean,role:'stream'|'control',tab='integrations'){
 const data={host:{settings:{},state:{at:new Date().toISOString(),google:{connected},twitch:{connected:false},obs:{inputs:{},scenes:[]}},hostname:'FIXE',settingsRevision:'r'},configuration:{revision:1,outputs:{twitch:{kind:'unconfigured',name:''}}}};
 return renderSettings({data,native:false,server,tab,online:true,
  device:{role,name:'QA'},localEndpoint:'',deviceExecutor:false,macroConfigurationError:'',
  esc,input:()=>'',select:()=>'',check:()=>''});
}
it('Desktop client does not demand Google secret from FIXE to read the master planning',()=>{
 const client=render('',false,'control');
 expect(client).toContain('Compte Google local facultatif sur ce PC client');
 expect(client).toContain('sans second secret OAuth');
 expect(client).toContain('Configurer le Client Secret Google');
});
it('paired Desktop distinguishes master Google identity from calendar freshness',()=>{
 expect(render('FIXE',true,'control')).toContain('Compte Google de la régie connecté ; actualisation du planning à vérifier.');
 expect(render('FIXE',false,'control')).toContain('Compte Google de la régie non connecté.');
 expect(render('',true,'stream')).toContain('Compte Google local de cet appareil.');
});
it('Desktop client hides local OBS and Twitch output configuration unless paired with FIXE',()=>{
 const obs=render('',false,'control','obs'),twitch=render('',false,'control','platforms');
 expect(obs).toContain('OBS piloté par FIXE');
 expect(obs).not.toContain('id="settings-form"');
 expect(twitch).toContain('sans deuxième diffuseur');
 expect(twitch).not.toContain('id="platform-form"');
 expect(render('FIXE',true,'control','obs')).toContain('id="settings-form"');
});
