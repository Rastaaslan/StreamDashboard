import {createYouTubeChatReader} from '../shared/youtube-chat.js';
import {callDeviceBridge} from './device-bridge.js';

export function createYouTubeChat(root,{request,native=false,bridge=globalThis.StreamDashboardProviders}) {
  root.innerHTML='<p class="small" data-youtube-account></p><p class="small" role="status" data-youtube-diagnostic></p><div class="youtube-api-messages" aria-label="Messages YouTube reçus sur cet appareil" role="log"></div>';
  let context={},key='',generation=0,timer,flight,disposed=false,reader,account='';
  const get=selector=>root.querySelector(selector);
  const diagnostic=text=>{get('[data-youtube-diagnostic]').textContent=text;};
  async function call(method,payload) {
    const value=await callDeviceBridge(bridge,method,payload);
    if(value.ok===false)throw Object.assign(new Error(value.message||'YouTube indisponible.'),{code:value.code});
    return value;
  }
  async function read(current) {
    if(!native)return request('/api/v2/youtube/chat?broadcastId='+encodeURIComponent(current.broadcastId),undefined,'GET',current.sourceKey);
    const status=await call('youtubeStatus',{});
    if(!status.connected)throw Object.assign(new Error('Connectez YouTube dans « Mes comptes sur cet appareil ».'),{code:'REAUTH_REQUIRED'});
    if(!reader||account!==status.account){
      account=status.account;get('.youtube-api-messages').replaceChildren();
      reader=createYouTubeChatReader({broadcast:id=>call('youtubeChatBroadcast',{broadcastId:id}),messages:(id,pageToken)=>call('youtubeChatMessages',{liveChatId:id,pageToken})});
    }
    return reader.read(current.broadcastId);
  }
  function draw(value) {
    get('[data-youtube-account]').textContent=value.account?`YouTube API · ${value.account} · chaîne ${value.channelId}`:'YouTube API · compte de cet appareil';
    diagnostic([value.phaseMessage,value.message].filter(Boolean).join(' '));
    const log=get('.youtube-api-messages'),atBottom=log.scrollHeight-log.scrollTop-log.clientHeight<40;
    const existing=new Map([...log.querySelectorAll('[data-message-id]')].map(node=>[node.dataset.messageId,node]));
    const messages=value.messages||[],wanted=new Set(messages.map(message=>message.id));
    for(const [id,node] of existing)if(!wanted.has(id))node.remove();
    if(messages.length||value.status!=='connected')log.querySelector('[data-chat-empty]')?.remove();
    messages.forEach((message,index)=>{
      let line=existing.get(message.id);
      if(!line){line=document.createElement('p');line.dataset.messageId=message.id;line.append(document.createElement('b'),document.createTextNode(''));}
      const name=message.author+' : ';if(line.firstChild.textContent!==name)line.firstChild.textContent=name;
      if(line.lastChild.textContent!==message.text)line.lastChild.textContent=message.text;
      if(log.children[index]!==line)log.insertBefore(line,log.children[index]||null);
    });
    if(!messages.length&&value.status==='connected'&&!log.querySelector('[data-chat-empty]')){const empty=document.createElement('p');empty.dataset.chatEmpty='';empty.className='small muted';empty.textContent='Chat connecté · aucun message reçu pour le moment.';log.append(empty);}
    if(atBottom)log.scrollTop=log.scrollHeight;
  }
  async function poll() {
    if(disposed||!context.enabled||flight)return;
    const current={...context},revision=generation;let delay=15000;
    if(!current.broadcastId){diagnostic('Aucune diffusion YouTube sélectionnée.');return;}
    flight=(async()=>{
      try {const value=await read(current);if(revision!==generation||disposed)return;draw(value);delay=Math.max(5000,Number(value.nextPollAt)-Date.now()||15000);}
      catch(error){if(revision!==generation||disposed)return;diagnostic(error.code==='REAUTH_REQUIRED'?error.message:'Lecture API YouTube indisponible. Vérifiez le compte de cet appareil ; le chat web reste accessible.');if(error.code==='REAUTH_REQUIRED'){get('.youtube-api-messages').replaceChildren();get('[data-youtube-account]').textContent='YouTube API · déconnecté';reader=undefined;account='';}delay=30000;}
    })();
    try{await flight;}finally{flight=undefined;if(!disposed&&context.enabled){clearTimeout(timer);timer=setTimeout(poll,revision===generation?delay:0);}}
  }
  return {
    update(value){
      const nextKey=JSON.stringify([value.sourceKey,value.broadcastId]);
      if(nextKey!==key){generation++;key=nextKey;get('.youtube-api-messages').replaceChildren();get('[data-youtube-account]').textContent='YouTube API · vérification du compte';diagnostic('Vérification de la diffusion et du chat…');clearTimeout(timer);timer=undefined;}
      const wasEnabled=context.enabled;context=value;
      if(!value.enabled){clearTimeout(timer);timer=undefined;return;}
      if(!timer||!wasEnabled)void poll();
    },
    refresh(){clearTimeout(timer);timer=undefined;void poll();},
    destroy(){disposed=true;generation++;clearTimeout(timer);},
  };
}
