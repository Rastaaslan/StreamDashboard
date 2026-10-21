import { createYouTubeChat } from './youtube-chat.js';
import { createTwitchChat } from './twitch-chat.js';

// Keep platform frames mounted. Authenticated chat uses the runtime API separately.
export function createLiveMonitor(root, { native = false, configure = () => {}, request, activityRoot } = {}) {
  let source = localStorage.getItem('sd2.monitor-source') === 'youtube' ? 'youtube' : 'twitch';
  let enabled = localStorage.getItem('sd2.monitor-enabled') === null ? matchMedia('(min-width:701px)').matches : localStorage.getItem('sd2.monitor-enabled') === 'true';
  let state, context = {}, disposed = false, viewerFlight, viewerRevision = 0, viewerMessage = '';
  root.className = 'live-monitor spacer';
  root.innerHTML = '<div class="section-heading"><div><h2>Retour plateforme & chats</h2><p class="small muted">Vue spectateur après diffusion, avec le délai et les publicités éventuelles de la plateforme. Son coupé au départ.</p></div><button type="button" class="secondary" data-monitor-toggle></button></div>'
    + '<div class="monitor-grid" data-monitor-body>'
    + '<section class="panel monitor-video"><div class="monitor-heading"><h3>Retour plateforme</h3><div class="monitor-tabs" role="group" aria-label="Plateforme du retour vidéo"><button type="button" data-monitor-source="twitch">Twitch</button><button type="button" data-monitor-source="youtube">YouTube</button></div></div><div class="monitor-slot video-slot" data-monitor-slot="video"></div><div class="monitor-footer"><a data-monitor-link="video" target="_blank" rel="noopener noreferrer">Ouvrir le live ↗</a><button type="button" class="secondary" data-monitor-connect="twitch" title="Connecter le lecteur Twitch sur cet appareil">Connexion visionneuse</button><button type="button" class="secondary" data-monitor-reload="video">Recharger la vidéo</button></div></section>'
    + '<section class="panel monitor-chat monitor-native-twitch"><div class="monitor-heading"><h3><span class="chat-dot twitch-dot"></span>Chat Twitch connecté</h3></div><div data-twitch-native></div><div class="monitor-footer monitor-creator-links"><a data-monitor-link="twitch" target="_blank" rel="noopener noreferrer">Chat dans le navigateur ↗</a><a data-monitor-link="twitch-creator" target="_blank" rel="noopener noreferrer">Régie Twitch ↗</a></div></section>'
    + '<section class="panel monitor-chat"><div class="monitor-heading"><h3><span class="chat-dot youtube-dot"></span>Chat YouTube</h3><button type="button" class="secondary" data-monitor-reload="youtube">↻<span class="sr-only"> Recharger le chat YouTube</span></button></div><details class="youtube-api-chat" open><summary>Lecture API sur cet appareil</summary><div data-youtube-api></div></details><div class="monitor-slot" data-monitor-slot="youtube"></div><div class="monitor-footer monitor-creator-links"><a data-monitor-link="youtube" target="_blank" rel="noopener noreferrer">Chat dans le navigateur ↗</a><a data-monitor-link="youtube-creator" target="_blank" rel="noopener noreferrer">YouTube Studio ↗</a></div></section>'
    + '</div><p class="small muted" data-monitor-note><span data-monitor-viewer-status role="status"></span> Le chat Twitch utilise le compte affiché ici. Le chat YouTube intégré a sa propre connexion ; YouTube Studio donne accès aux outils de votre chaîne dans votre navigateur.</p>';
  root.insertAdjacentHTML('beforeend','<details class="monitor-targets"><summary>Choisir les chaînes et la diffusion sur cet appareil</summary><form data-monitor-targets><label>Chaîne Twitch (nom)<input name="channel" maxlength="25"></label><label>Identifiant de la diffusion YouTube<input name="video" maxlength="11"></label><p class="small muted">Laissez vide pour suivre la diffusion sélectionnée dans votre espace. Ces choix ne changent ni vos comptes ni le live.</p><button>Enregistrer ces retours</button><p data-monitor-targets-status role="status"></p></form></details>');
  const get = selector => root.querySelector(selector);
  get('[name="channel"]').value=localStorage.getItem('sd2.monitor-channel')||'';
  get('[name="video"]').value=localStorage.getItem('sd2.monitor-video')||'';
  get('[data-monitor-targets]').addEventListener('submit',event=>{
    event.preventDefault();event.stopPropagation();
    const channel=get('[name="channel"]').value.trim(),video=get('[name="video"]').value.trim();
    if((channel&&!/^[a-zA-Z0-9_]{1,25}$/.test(channel))||(video&&!/^[a-zA-Z0-9_-]{11}$/.test(video))){get('[data-monitor-targets-status]').textContent='Nom Twitch ou identifiant YouTube invalide.';return;}
    localStorage.setItem('sd2.monitor-channel',channel);localStorage.setItem('sd2.monitor-video',video);
    viewerRevision++;viewerMessage='';draw();get('[data-monitor-targets-status]').textContent='Retours enregistrés sur cet appareil.';
  });
  if (activityRoot) {
    activityRoot.classList.add('monitor-activity');
    get('[data-monitor-body]').classList.add('monitor-grid-with-activity');
    get('[data-monitor-body]').append(activityRoot);
  }
  const slots = Object.fromEntries(['video', 'youtube'].map(key => [key, get('[data-monitor-slot="' + key + '"]')]));
  const youtubeChat=createYouTubeChat(get('[data-youtube-api]'),{request,native});
  const twitchChat = native ? { update() {}, destroy() {} } : createTwitchChat(get('[data-twitch-native]'), { request, configure });
  if (native) {
    const holder=get('[data-twitch-native]');holder.className='monitor-slot';slots.twitch=holder;
    get('.monitor-native-twitch h3').textContent='Chat Twitch · session web';
  }


  function mount(key, url, title, missing) {
    const slot = slots[key], identity = url || missing;
    if (slot.dataset.identity === identity) return;
    slot.dataset.identity = identity; slot.replaceChildren();
    if (!url) {
      const message = document.createElement('p'); message.textContent = missing;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary';
      button.textContent = 'Configurer la diffusion'; button.addEventListener('click', configure);
      slot.append(message, button); return;
    }
    const frame = document.createElement('iframe'); frame.title = title;
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    frame.allowFullscreen = true; frame.src = url; slot.append(frame);
  }
  function link(key, url) {
    const anchor = get('[data-monitor-link="' + key + '"]'); anchor.hidden = !url;
    if (url && anchor.getAttribute('href') !== url) anchor.href = url;
    if (!url) anchor.removeAttribute('href');
  }
  function twitchLogin() {
    const login = localStorage.getItem('sd2.monitor-channel') || state?.host?.monitor?.twitchLogin || '';
    return /^[a-zA-Z0-9_]{1,25}$/.test(login) ? login.toLowerCase() : '';
  }
  async function connectViewer() {
    if (source === 'youtube') {
      const video=localStorage.getItem('sd2.monitor-video') || state?.configuration?.youtube?.broadcastId || '';
      const url=/^[a-zA-Z0-9_-]{11}$/.test(video)?'https://www.youtube.com/watch?v='+video:'https://studio.youtube.com/';
      window.open(url,'_blank','noopener,noreferrer');
      viewerMessage='Session YouTube intégrée non vérifiable. Connectez le compte souhaité dans le navigateur externe ; sa session reste distincte de la connexion API.';
      draw();return;
    }
    const channel = twitchLogin();
    if (disposed || viewerFlight || !enabled || source !== 'twitch' || !channel) return;
    const revision = viewerRevision;
    const open = globalThis.streamDashboardDesktop?.openTwitchViewerSession;
    if (native || typeof open !== 'function') {
      if (globalThis.streamDashboardDesktop) {
        viewerMessage = 'Mettez à jour cette application pour connecter sa visionneuse Twitch.';
      } else {
        const popup = window.open('https://www.twitch.tv/login', '_blank', 'noopener,noreferrer');
        viewerMessage = native ? 'Connectez-vous à Twitch dans le navigateur externe. Sa session est distincte de la visionneuse intégrée et ne peut pas y être vérifiée automatiquement.' : 'Connectez-vous à Twitch dans ce navigateur, puis cliquez sur Recharger la vidéo. La connexion du chat reste séparée.';
        if (popup) popup.opener = null;
      }
      draw(); return;
    }
    viewerMessage = 'Terminez la connexion Twitch dans la fenêtre de cet appareil, puis fermez-la pour actualiser le lecteur.';
    const operation = Promise.resolve().then(() => open({ channel }));
    viewerFlight = operation; draw();
    try {
      const result = await operation;
      if (disposed || revision !== viewerRevision || !enabled || source !== 'twitch' || channel !== twitchLogin()) return;
      if (result?.status !== 'closed') throw new Error('Fenêtre de connexion non confirmée.');
      delete slots.video.dataset.identity;
      viewerMessage = 'Visionneuse rechargée. Session web non vérifiable automatiquement : contrôlez le compte dans le lecteur, ou ouvrez le live dans le navigateur. La connexion API reste indépendante.';
    } catch {
      if (disposed || revision !== viewerRevision) return;
      viewerMessage = 'La connexion de la visionneuse n’a pas pu être ouverte. Réessayez ou ouvrez le live dans votre navigateur.';
    } finally {
      if (viewerFlight === operation) viewerFlight = undefined;
      if (!disposed) draw();
    }
  }
  function draw() {
    if (disposed) return;
    get('[data-monitor-toggle]').textContent = enabled ? 'Masquer les écrans' : 'Afficher les écrans';
    get('[data-monitor-toggle]').setAttribute('aria-expanded', String(enabled));
    get('[data-monitor-body]').hidden = !enabled && !activityRoot;
    get('[data-monitor-body]').dataset.screensEnabled = String(enabled);
    root.querySelectorAll('.monitor-video, .monitor-chat').forEach(card => { card.hidden = !enabled; });
    get('[data-monitor-note]').hidden = !enabled;
    get('[data-monitor-viewer-status]').textContent = viewerMessage || (source==='twitch'?'Session web Twitch non vérifiable automatiquement. Le compte API/chat est distinct.':'Session web YouTube non vérifiable automatiquement. Google Calendar, YouTube API et le lecteur ont des connexions distinctes.');
    const connect = get('[data-monitor-connect="twitch"]');
    connect.hidden = false; connect.disabled = Boolean(viewerFlight) || (source==='twitch'&&!twitchLogin());
    connect.textContent = viewerFlight ? 'Connexion ouverte…' : source==='youtube'?'Connexion YouTube dans le navigateur':'Connexion visionneuse';
    twitchChat.update({ ...context, online: context.online === true && enabled, sourceLabel: state?.host?.hostname || '' });
    const selectedVideo=localStorage.getItem('sd2.monitor-video')||state?.configuration?.youtube?.broadcastId||'';
    youtubeChat.update({enabled,sourceKey:context.sourceKey,broadcastId:/^[a-zA-Z0-9_-]{11}$/.test(selectedVideo)?selectedVideo:''});
    if (!enabled) {
      for (const slot of Object.values(slots)) { slot.replaceChildren(); delete slot.dataset.identity; }
      return;
    }
    const login = twitchLogin();
    const rawVideo = localStorage.getItem('sd2.monitor-video') || state?.configuration?.youtube?.broadcastId || '';
    const video = /^[a-zA-Z0-9_-]{11}$/.test(rawVideo) ? rawVideo : '';
    const parent = encodeURIComponent(location.hostname);
    const twitchMissing = 'Connectez le compte Twitch sur cette source pour afficher sa chaîne.';
    const youtubeMissing = 'Choisissez la diffusion YouTube dans Configuration → Diffusion pour afficher son retour et son chat.';
    const videoUrl = source === 'twitch'
      ? login && 'https://player.twitch.tv/?channel=' + login + '&parent=' + parent + '&muted=true&autoplay=true'
      : video && 'https://www.youtube.com/embed/' + video + '?autoplay=1&mute=1&playsinline=1&origin=' + encodeURIComponent(location.origin);
    mount('video', videoUrl, 'Retour plateforme ' + (source === 'twitch' ? 'Twitch' : 'YouTube'), source === 'twitch' ? twitchMissing : youtubeMissing);
    if(native)mount('twitch',login&&'https://www.twitch.tv/embed/'+login+'/chat?parent='+parent,'Chat Twitch','Choisissez votre chaîne Twitch. Si le chat intégré est restreint, utilisez le navigateur externe.');
    mount('youtube', video && 'https://www.youtube.com/live_chat?v=' + video + '&embed_domain=' + parent, 'Chat YouTube', youtubeMissing);
    link('video', source === 'twitch' ? login && 'https://www.twitch.tv/' + login : video && 'https://www.youtube.com/watch?v=' + video);
    link('twitch', login && 'https://www.twitch.tv/popout/' + login + '/chat?popout=');
    link('twitch-creator', login && 'https://dashboard.twitch.tv/u/' + login + '/stream-manager');
    link('youtube', video && 'https://www.youtube.com/live_chat?v=' + video + '&is_popout=1');
    link('youtube-creator', video ? 'https://studio.youtube.com/video/' + video + '/livestreaming' : 'https://studio.youtube.com/');
    root.querySelectorAll('[data-monitor-source]').forEach(button => {
      const selected = button.dataset.monitorSource === source;
      button.classList.toggle('secondary', !selected); button.setAttribute('aria-pressed', String(selected));
    });
  }
  root.addEventListener('click', event => {
    if (disposed) return;
    const button = event.target.closest('button'); if (!button) return;
    if (button.hasAttribute('data-monitor-toggle')) { viewerRevision++; enabled = !enabled; localStorage.setItem('sd2.monitor-enabled', String(enabled)); draw(); }
    if (['twitch', 'youtube'].includes(button.dataset.monitorSource)) { if (source !== button.dataset.monitorSource) { viewerRevision++; viewerMessage = ''; } source = button.dataset.monitorSource; localStorage.setItem('sd2.monitor-source', source); draw(); }
    if (button.dataset.monitorConnect === 'twitch') void connectViewer();
    if (slots[button.dataset.monitorReload]) { delete slots[button.dataset.monitorReload].dataset.identity; draw(); }
  });
  const stopViewerSession = globalThis.streamDashboardDesktop?.onTwitchViewerSessionClosed?.(() => {
    if (disposed || !enabled || source !== 'twitch' || !twitchLogin()) return;
    delete slots.video.dataset.identity;
    viewerMessage = 'Visionneuse rechargée. Session web non vérifiable automatiquement : contrôlez le compte dans le lecteur, ou ouvrez le live dans le navigateur. La connexion API reste indépendante.';
    draw();
  });
  return {
    update(value, options = {}) { if (disposed) return; if (context.sourceKey !== options.sourceKey || state?.host?.monitor?.twitchLogin !== value?.host?.monitor?.twitchLogin) { viewerRevision++; viewerMessage = ''; } state = value; context = options; draw(); },
    destroy() { disposed = true; viewerRevision++; if (typeof stopViewerSession === 'function') stopViewerSession(); twitchChat.destroy(); youtubeChat.destroy(); for (const slot of Object.values(slots)) slot.replaceChildren(); },
  };
}
