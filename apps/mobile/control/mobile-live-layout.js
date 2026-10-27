/**
 * Reorganizes the already-rendered mobile live page into four persistent panes.
 * Moves original DOM nodes instead of cloning them, preserving Twitch chat,
 * Spotify controls and the DJI battery reader across pane navigation.
 */
export function arrangeMobileLivePanes(root,{microAction=null}={}){
  const paneRoot=root.querySelector('.mobile-pane-layout[data-mobile-pane-group="live"]');
  const create=(tag,cls)=>{const item=document.createElement(tag);item.className=cls;return item};
  function prepareHealth(micro){
    const controls=root.querySelector('#live-controls');
    const fresh=controls?.querySelector('.simple-mic-health');
    if(fresh){
      const old=micro.querySelector('.simple-mic-health');
      if(old)old.replaceWith(fresh);
      else micro.insertBefore(fresh,micro.querySelector('#spotify-panel')||micro.querySelector('#dji-battery-panel'));
    }
    const health=micro.querySelector('.simple-mic-health');
    if(!health)return;
    for(const note of health.querySelectorAll('p')){
      if(note.textContent?.startsWith('Batterie DJI : inconnue'))note.remove();
    }
    health.querySelector('[data-mobile-mic-toggle]')?.remove();
    if(microAction && typeof microAction.id==='string'){
      const button=create('button','secondary');
      button.type='button';button.dataset.action=microAction.id;
      button.dataset.mobileMicToggle='';
      button.textContent=microAction.label||'Activer / couper le micro';
      button.disabled=microAction.disabled===true;
      health.append(button);
    }
  }
  if(paneRoot){
    const micro=paneRoot.querySelector('[data-mobile-pane="micro"]');
    if(micro)prepareHealth(micro);
    return paneRoot;
  }
  const nodes={overview:root.querySelector('#live-overview'),
    controls:root.querySelector('#live-controls'),
    monitor:root.querySelector('#live-monitor'),
    battery:root.querySelector('#dji-battery-panel'),
    spotify:root.querySelector('#spotify-panel'),
    streamlabs:root.querySelector('#streamlabs-feed')};
  if(Object.values(nodes).some(node=>!node))return null;
  const layout=create('div','mobile-pane-layout');layout.dataset.mobilePaneGroup='live';
  const pane=(key,label,title,extra='')=>{
    const screen=create('section','mobile-pane-screen '+extra);
    screen.dataset.mobilePaneGroup='live';screen.dataset.mobilePane=key;
    screen.setAttribute('aria-label',label);
    const heading=create('div','mobile-pane-title');
    const h2=document.createElement('h2');h2.textContent=title;
    heading.append(h2);screen.append(heading);layout.append(screen);return screen;
  };
  const chat=pane('chat','Chat Twitch','💬 Chat Twitch','mobile-pane-chat');
  chat.append(nodes.monitor);
  const micro=pane('micro','Spotify et micro','🎙 Micro & Spotify');
  const micSection=nodes.controls.querySelector('.simple-mic-health');
  if(micSection)micro.append(micSection);
  micro.append(nodes.spotify,nodes.battery);
  const sound=pane('sounds','Soundboard','♫ Sons du live');
  const soundSlot=create('div','mobile-pane-soundboard');
  soundSlot.id='mobile-live-sounds';sound.append(soundSlot);
  const control=pane('control','Gestion du live','◉ Gestion du live');
  control.append(nodes.overview,nodes.controls);
  nodes.streamlabs.remove(); // Streamlabs has its own Deck pane; avoid a second background poll.
  root.replaceChildren(layout);
  prepareHealth(micro);
  return layout;
}
