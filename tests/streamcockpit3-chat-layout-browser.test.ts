import {expect,it} from 'vitest';
import {chromium} from '@playwright/test';
import {readFileSync} from 'node:fs';

const styles=['control.css','twitch-chat.css','mobile-panes.css','mobile-ergonomics.css','alpha27-spontaneous-style.css','deck-action-layout.css','streamcockpit-timer.css','streamcockpit-mobile-v2.css'];
const sizes=[[1366,900],[1280,700],[1920,1080],[390,844],[320,690],[844,390]] as const;

// Exact Twitch chat DOM selectors, without accounts, tokens, sockets or provider requests.
// Long errors + expanded composer must never flow over the Twitch tools below the chat.
const markup=`
<div class="workspace"><main>
<section class="live-monitor">
<div class="monitor-grid monitor-grid-with-activity" data-screens-enabled="true">
<section class="panel monitor-video"><div class="video-slot">Retour vidéo</div></section>
<section class="panel monitor-chat monitor-native-twitch">
 <div class="monitor-heading"><h3>Chat Twitch</h3></div>
 <div data-twitch-native><div class="twitch-native-chat">
  <div class="twitch-chat-account"><p>Compte : chaîne de test</p><button>Actualiser</button></div>
  <p class="small muted" data-twitch-status role="status"></p>
  <div class="twitch-chat-log" data-twitch-messages role="log"></div>
  <form class="twitch-chat-compose"><label>Message Twitch<textarea data-twitch-draft rows="2"></textarea></label><div class="twitch-chat-compose-footer"><span>500 / 500</span><button type="button">Envoyer</button></div><p data-twitch-result role="status"></p></form>
 </div>
 </div><div class="monitor-footer">Chat dans le navigateur · Régie Twitch</div>
 <section class="spacer" id="twitch-permissions"><h3>Permissions Twitch</h3><p>Etat des permissions</p></section>
 <section class="spacer" id="twitch-moderation"><h3>Shield Mode et AutoMod</h3><p>Contrôle modération</p></section>
</section>
<section class="monitor-activity">Activité</section>
</div></section>
</main></div>`;

it.skipIf(process.env.SC3_FINAL_BROWSER_TEST!=='1')('chat never overlaps following Twitch tools with long messages and errors at Desktop and Android widths',async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  for(const [width,height] of sizes){
   const page=await browser.newPage({viewport:{width,height},hasTouch:width<=700});
   const compact=width<=700;
   await page.setContent(`<!doctype html><html class="${compact?'compact-app mobile-panes-active':''}"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body class="${compact?'mobile-pane-chat':''}">${markup}</body></html>`);
   for(const name of styles)await page.addStyleTag({content:readFileSync('apps/mobile/control/'+name,'utf8')});
   const measurements=await page.evaluate(()=>{
    const chat=document.querySelector('.twitch-native-chat')!;
    (chat.querySelector('[data-twitch-status]') as HTMLElement).textContent='Etat de la régie distant et permissions à vérifier : '.repeat(22);
    (chat.querySelector('[data-twitch-result]') as HTMLElement).textContent='Résultat de l’action incertain, ne pas renvoyer : '.repeat(22);
    const textarea=chat.querySelector('textarea')!;
    textarea.style.height='160px';
    const list=chat.querySelector('.twitch-chat-log')!;
    for(let i=0;i<20;i++){const line=document.createElement('div');line.textContent='Message de test très long sans données externes '.repeat(7);list.append(line);}
    const wrap=chat.parentElement!,permissions=document.getElementById('twitch-permissions')!;
    const r=(node:Element)=>node.getBoundingClientRect();
    const chatRect=r(chat),wrapRect=r(wrap),permissionsRect=r(permissions);
    return {
     chatOverflow:chat.scrollHeight-chat.clientHeight,
     chatExitsWrapper:chatRect.bottom-wrapRect.bottom,
     permissionsOverlap:wrapRect.bottom-permissionsRect.top,
     horizontalOverflow:document.documentElement.scrollWidth-innerWidth,
     chatHeight:chatRect.height,wrapperHeight:wrapRect.height,
    };
   });
   try{
    expect(measurements.chatOverflow,'chat overflows its own layout at '+width+'px').toBeLessThanOrEqual(1);
    expect(measurements.chatExitsWrapper,'chat leaves the measured wrapper at '+width+'px').toBeLessThanOrEqual(1);
    expect(measurements.permissionsOverlap,'permissions overlap native chat at '+width+'px').toBeLessThanOrEqual(1);
    expect(measurements.horizontalOverflow,'horizontal overflow at '+width+'px').toBeLessThanOrEqual(1);
   }finally{await page.close();}
  }
 }finally{await browser.close();}
},45000);
