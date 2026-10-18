// Keep these nodes mounted: removing/reinserting an iframe reloads its browsing context.
// No OAuth token or device credential is sent to the embedded services.
export function createLiveMonitor(root, { native = false, configure }) {
  if (native) { root.hidden = true; return { update() {} }; }
  let source = localStorage.getItem('sd2.monitor-source') === 'youtube' ? 'youtube' : 'twitch';
  let enabled = localStorage.getItem('sd2.monitor-enabled') !== 'false' && matchMedia('(min-width:701px)').matches;
  let state;
  root.className = 'live-monitor spacer';
  root.innerHTML = `<div class="section-heading"><div><h2>Retour du live & chats</h2><p class="small muted">Le retour diffusé aux spectateurs, avec le délai de la plateforme. Son coupé au départ.</p></div><button type="button" class="secondary" data-monitor-toggle></button></div>
    <div class="monitor-grid" data-monitor-body>
      <section class="panel monitor-video"><div class="monitor-heading"><h3>Retour vidéo</h3><div class="monitor-tabs" role="group" aria-label="Plateforme du retour vidéo"><button type="button" data-monitor-source="twitch">Twitch</button><button type="button" data-monitor-source="youtube">YouTube</button></div></div><div class="monitor-slot video-slot" data-monitor-slot="video"></div><div class="monitor-footer"><a data-monitor-link="video" target="_blank" rel="noopener noreferrer">Ouvrir le live ↗</a><button type="button" class="secondary" data-monitor-reload="video">Recharger la vidéo</button></div></section>
      <section class="panel monitor-chat"><div class="monitor-heading"><h3><span class="chat-dot twitch-dot"></span>Chat Twitch</h3><button type="button" class="secondary" data-monitor-reload="twitch">↻<span class="sr-only"> Recharger le chat Twitch</span></button></div><div class="monitor-slot" data-monitor-slot="twitch"></div><div class="monitor-footer"><a data-monitor-link="twitch" target="_blank" rel="noopener noreferrer">Ouvrir le chat ↗</a></div></section>
      <section class="panel monitor-chat"><div class="monitor-heading"><h3><span class="chat-dot youtube-dot"></span>Chat YouTube</h3><button type="button" class="secondary" data-monitor-reload="youtube">↻<span class="sr-only"> Recharger le chat YouTube</span></button></div><div class="monitor-slot" data-monitor-slot="youtube"></div><div class="monitor-footer"><a data-monitor-link="youtube" target="_blank" rel="noopener noreferrer">Ouvrir le chat ↗</a></div></section>
    </div><p class="small muted" data-monitor-note>Les chats sont fournis par Twitch et YouTube. Si une connexion ou l’affichage intégré est refusé, utilisez « Ouvrir le chat ».</p>`;
  const get = selector => root.querySelector(selector);
  const slots = Object.fromEntries(['video', 'twitch', 'youtube'].map(key => [key, get(`[data-monitor-slot="${key}"]`)]));

  function mount(key, url, title, missing) {
    const slot = slots[key];
    const identity = url || missing;
    if (slot.dataset.identity === identity) return;
    slot.dataset.identity = identity;
    slot.replaceChildren();
    if (!url) {
      const message = document.createElement('p'); message.textContent = missing;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary';
      button.textContent = 'Configurer la diffusion'; button.addEventListener('click', configure);
      slot.append(message, button); return;
    }
    const frame = document.createElement('iframe');
    frame.title = title;
    // YouTube requires an HTTP Referer (player error 153 when it is suppressed).
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    frame.allowFullscreen = true;
    frame.src = url;
    slot.append(frame);
  }
  function link(key, url) {
    const anchor = get(`[data-monitor-link="${key}"]`);
    anchor.hidden = !url;
    if (url && anchor.getAttribute('href') !== url) anchor.href = url;
    if (!url) anchor.removeAttribute('href');
  }
  function draw() {
    get('[data-monitor-toggle]').textContent = enabled ? 'Masquer les écrans' : 'Afficher les écrans';
    get('[data-monitor-toggle]').setAttribute('aria-expanded', String(enabled));
    get('[data-monitor-body]').hidden = !enabled;
    get('[data-monitor-note]').hidden = !enabled;
    if (!enabled) {
      for (const slot of Object.values(slots)) { slot.replaceChildren(); delete slot.dataset.identity; }
      return;
    }
    const rawLogin = state?.host.monitor?.twitchLogin || '';
    const login = /^[a-zA-Z0-9_]{1,25}$/.test(rawLogin) ? rawLogin.toLowerCase() : '';
    const rawVideo = state?.configuration.youtube.broadcastId || '';
    const video = /^[a-zA-Z0-9_-]{11}$/.test(rawVideo) ? rawVideo : '';
    const parent = encodeURIComponent(location.hostname);
    const twitchMissing = 'Connectez le compte Twitch sur la régie pour afficher sa chaîne.';
    const youtubeMissing = 'Choisissez la diffusion YouTube dans Configuration → Diffusion pour afficher son retour et son chat.';
    const videoUrl = source === 'twitch'
      ? login && `https://player.twitch.tv/?channel=${login}&parent=${parent}&muted=true&autoplay=true`
      : video && `https://www.youtube.com/embed/${video}?autoplay=1&mute=1&playsinline=1&origin=${encodeURIComponent(location.origin)}`;
    mount('video', videoUrl, `Retour du live ${source === 'twitch' ? 'Twitch' : 'YouTube'}`, source === 'twitch' ? twitchMissing : youtubeMissing);
    mount('twitch', login && `https://www.twitch.tv/embed/${login}/chat?parent=${parent}&darkpopout`, 'Chat Twitch', twitchMissing);
    mount('youtube', video && `https://www.youtube.com/live_chat?v=${video}&embed_domain=${parent}`, 'Chat YouTube', youtubeMissing);
    link('video', source === 'twitch' ? login && `https://www.twitch.tv/${login}` : video && `https://www.youtube.com/watch?v=${video}`);
    link('twitch', login && `https://www.twitch.tv/popout/${login}/chat?popout=`);
    link('youtube', video && `https://www.youtube.com/live_chat?v=${video}&is_popout=1`);
    root.querySelectorAll('[data-monitor-source]').forEach(button => {
      const selected = button.dataset.monitorSource === source;
      button.classList.toggle('secondary', !selected); button.setAttribute('aria-pressed', String(selected));
    });
  }
  root.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.hasAttribute('data-monitor-toggle')) { enabled = !enabled; localStorage.setItem('sd2.monitor-enabled', String(enabled)); draw(); }
    if (button.dataset.monitorSource) { source = button.dataset.monitorSource; localStorage.setItem('sd2.monitor-source', source); draw(); }
    if (button.dataset.monitorReload) { delete slots[button.dataset.monitorReload].dataset.identity; draw(); }
  });
  return { update(value) { state = value; draw(); } };
}
