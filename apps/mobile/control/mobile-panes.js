export const MOBILE_PANES = Object.freeze({
  live: [
    {id:'chat',label:'Chat',shortLabel:'Chat',icon:'💬'},
    {id:'micro',label:'Micro / Spotify',shortLabel:'Micro',icon:'🎤'},
    {id:'sounds',label:'Soundboard',shortLabel:'Sons',icon:'🔊'},
    {id:'control',label:'Gérer le live',shortLabel:'Diffusion',icon:'🔴'},
  ],
  planning: [
    {id:'next',label:'Prochain live',shortLabel:'Prochain',icon:'⏭️'},
    {id:'week',label:'La semaine',shortLabel:'Semaine',icon:'📅'},
    {id:'events',label:'Événements',shortLabel:'Agenda',icon:'📋'},
    {id:'manage',label:'Gestion',shortLabel:'Gérer',icon:'⚙️'},
  ],
  deck: [
    {id:'sounds',label:'Soundboard',shortLabel:'Sons',icon:'🔊'},
    {id:'actions',label:'Actions live',shortLabel:'Actions',icon:'🔴'},
    {id:'wizebot',label:'WizeBot',shortLabel:'WizeBot',icon:'⚡'},
    {id:'streamlabs',label:'Streamlabs',shortLabel:'Streamlabs',icon:'💟'},
  ],
});
const STORE_PREFIX='sd2.mobile.pane:';
const FALLBACK={live:'chat',planning:'next',deck:'sounds'};
const SWIPE_MIN_PX=65;
export const PANE_SLIDE_DURATION_MS=180;
const PANE_SLIDE_DISTANCE_PX=26;

/**
 * A short directional entrance: the page shifts only 26px, never the
 * fixed microphone badge or the OBS live controls outside the active pane.
 */
export function paneSlideMotion(direction){
  const displacement=direction==='previous'?-PANE_SLIDE_DISTANCE_PX:PANE_SLIDE_DISTANCE_PX;
  return {
    keyframes:[
      {transform:'translate3d('+displacement+'px, 0, 0)',opacity:0.72},
      {transform:'translate3d(0, 0, 0)',opacity:1},
    ],
    options:{duration:PANE_SLIDE_DURATION_MS,easing:'cubic-bezier(0.22, 0.72, 0.22, 1)',fill:'none'},
  };
}
const SWIPE_EXCLUDE='button,input,textarea,select,iframe,a,[contenteditable],'+
  '.twitch-chat-log,.streamlabs-events,.deck-banks,.tabs,.monitor-slot,.deck-dock,details,summary';

export function createMobilePanes(nav, {root,storage,onSelect=()=>{},now=Date.now}={}) {
  const selections=new Map();
  const preferred=group=>{
    if(!MOBILE_PANES[group])return '';
    if(selections.has(group))return selections.get(group);
    let saved='';
    try{saved=storage?.getItem(STORE_PREFIX+group)||'';}catch{}
    const selected=MOBILE_PANES[group].some(item=>item.id===saved)?saved:FALLBACK[group];
    selections.set(group,selected);return selected;
  };
  let page='',enabled=false,disposed=false,lastTouch=null;
  let pendingSlide=null,activeSlide=null;
  const swipeReduced=()=>nav.ownerDocument?.defaultView
    ?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches===true;

  // Finger tracking deliberately changes ONLY the visual position of the
  // active pane. It does not mutate any OBS/Twitch or planning state.
  function resetDraggedPane(gesture,{snapBack=false}={}){
    const pane=gesture?.pane;
    if(!pane)return;
    const offset=gesture.offset||0;
    const faded=gesture.fade??1;
    pane.style.removeProperty('transform');
    pane.style.removeProperty('opacity');
    pane.style.removeProperty('will-change');
    delete pane.dataset.paneDragging;
    if(snapBack && pane.isConnected && !swipeReduced() &&
       Math.abs(offset)>1 && typeof pane.animate==='function'){
      try{
        pane.animate([
          {transform:'translate3d('+offset+'px, 0, 0)',opacity:faded},
          {transform:'translate3d(0, 0, 0)',opacity:1},
        ],{duration:140,easing:'cubic-bezier(0.22,0.72,0.22,1)'});
      }catch{ /* Animation failure must never block input or navigation. */ }
    }
  }

  function trackFinger(gesture,dx){
    const pane=gesture.pane;
    if(!pane?.isConnected)return;
    const panes=MOBILE_PANES[page]||[];
    const index=panes.findIndex(item=>item.id===gesture.selected);
    const neighboring=dx<0?index<panes.length-1:index>0;
    const width=Math.max(1,pane.getBoundingClientRect().width);
    // Limited travel keeps live commands and the DJI badge accessible.
    const max=Math.min(width*0.43,210);
    const travel=Math.max(-max,Math.min(max,dx*(neighboring?0.82:0.2)));
    gesture.offset=Math.round(travel);
    gesture.fade=1-0.16*Math.abs(travel)/Math.max(1,max);
    pane.style.willChange='transform, opacity';
    pane.style.transform='translate3d('+gesture.offset+'px, 0, 0)';
    pane.style.opacity=String(gesture.fade);
    pane.dataset.paneDragging='true';
  }

  function cancelSlide(){
    if(!activeSlide)return;
    try{activeSlide.cancel();}catch{ /* A removed DOM node cannot hold a live animation. */ }
    activeSlide=null;
  }
  function slideActivePane(active){
    if(!pendingSlide || !active ||
       pendingSlide.group!==page || pendingSlide.id!==preferred(page))return;
    const slide=pendingSlide;
    pendingSlide=null;
    cancelSlide();
    const windowContext=nav.ownerDocument?.defaultView;
    if(!enabled || !active.isConnected || typeof active.animate!=='function' ||
       windowContext?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches)return;
    const motion=paneSlideMotion(slide.direction);
    try{
      const animation=active.animate(motion.keyframes,motion.options);
      activeSlide=animation;
      // Always release the reference when the animation finishes or is
      // cancelled. No detached iframe, chat or page is cloned or recreated.
      const clear=()=>{if(activeSlide===animation)activeSlide=null;};
      animation.addEventListener?.('finish',clear,{once:true});
      animation.addEventListener?.('cancel',clear,{once:true});
    }catch{activeSlide=null;}
  }
  function applyDom(){
    if(disposed)return;
    for(const panel of root?.querySelectorAll('[data-mobile-pane]')||[]){
      const selected=panel.dataset.mobilePane===preferred(page) && panel.dataset.mobilePaneGroup===page;
      panel.hidden=!selected;
      panel.inert=!selected;
      panel.setAttribute('aria-hidden',String(!selected));
    }
    for(const button of nav.querySelectorAll('[data-pane-tab]')){
      const selected=button.dataset.paneTab===preferred(page);
      button.setAttribute('aria-selected',String(selected));
      button.tabIndex=selected?0:-1;
    }
    // Planning and Deck render a new pane per selection, unlike Live which
    // retains the Twitch chat DOM. Wait until the destination exists before
    // consuming its animation, so both architectures get the same motion.
    const active=[...(root?.querySelectorAll('[data-mobile-pane]')||[])]
      .find(node=>node.dataset.mobilePaneGroup===page &&
                  node.dataset.mobilePane===preferred(page) && !node.hidden);
    slideActivePane(active);
  }
  function select(group,id,{notify=true}={}){
    if(!MOBILE_PANES[group]?.some(item=>item.id===id))return false;
    const previous=preferred(group);
    if(page===group && enabled && previous!==id){
      const panes=MOBILE_PANES[group];
      const oldIndex=panes.findIndex(item=>item.id===previous);
      const newIndex=panes.findIndex(item=>item.id===id);
      // Last action wins when the user swipes/taps again during animation.
      pendingSlide={group,id,direction:newIndex>oldIndex?'next':'previous'};
      cancelSlide();
    }
    selections.set(group,id);
    try{storage?.setItem(STORE_PREFIX+group,id);}catch{}
    if(page===group)applyDom();
    if(notify&&previous!==id)onSelect(group,id);
    return true;
  }
  function update({group='',compact=false}={}){
    enabled=compact && Object.hasOwn(MOBILE_PANES,group);
    const nextPage=enabled?group:'';
    if(page!==nextPage || !enabled){
      pendingSlide=null;cancelSlide();
      if(lastTouch){resetDraggedPane(lastTouch);lastTouch=null;}
    }
    page=nextPage;
    nav.hidden=!enabled;
    if(!enabled){nav.replaceChildren();lastTouch=null;return;}
    if(nav.dataset.group!==group || !nav.childElementCount){
      nav.dataset.group=group;
      nav.replaceChildren();
      for(const item of MOBILE_PANES[group]){
        const button=document.createElement('button');
        button.type='button';button.className='mobile-pane-tab';
        button.dataset.paneTab=item.id;button.setAttribute('role','tab');
        button.setAttribute('aria-label',item.label);
        button.setAttribute('aria-controls','content');
        const icon=document.createElement('span');icon.className='mobile-pane-tab-icon';
        icon.textContent=item.icon;icon.setAttribute('aria-hidden','true');
        const caption=document.createElement('span');caption.className='mobile-pane-tab-label';
        caption.textContent=item.shortLabel||item.label;
        button.append(icon,caption);nav.append(button);
      }
    }
    applyDom();
  }
  nav.addEventListener('click',event=>{
    const target=event.target.closest('button[data-pane-tab]');
    if(!target||!enabled)return;
    select(page,target.dataset.paneTab);
  });
  nav.addEventListener('keydown',event=>{
    const keys=['ArrowRight','ArrowLeft','Home','End'];
    if(!enabled||!keys.includes(event.key))return;
    const entries=MOBILE_PANES[page],index=entries.findIndex(v=>v.id===preferred(page));
    const next=event.key==='Home'?0:event.key==='End'?entries.length-1:
      Math.max(0,Math.min(entries.length-1,index+(event.key==='ArrowRight'?1:-1)));
    if(next===index)return;
    event.preventDefault();select(page,entries[next].id);
    nav.querySelector('[data-pane-tab="'+entries[next].id+'"]')?.focus();
  });
  root?.addEventListener('touchstart',event=>{
    if(lastTouch){resetDraggedPane(lastTouch);lastTouch=null;}
    if(!enabled||event.touches.length!==1||document.querySelector('dialog[open]'))return;
    const target=event.target;
    if(target.closest?.(SWIPE_EXCLUDE))return;
    const pane=target.closest?.('[data-mobile-pane]');
    if(!pane || pane.hidden || pane.dataset.mobilePaneGroup!==page ||
       pane.dataset.mobilePane!==preferred(page))return;
    lastTouch={
      x:event.touches[0].clientX,y:event.touches[0].clientY,
      at:now(),group:page,selected:preferred(page),
      identifier:event.touches[0].identifier,pane,
      axis:'',offset:0,fade:1,
    };
  },{passive:true});

  root?.addEventListener('touchmove',event=>{
    const gesture=lastTouch;
    if(!gesture || !enabled || gesture.group!==page)return;
    if(event.touches.length!==1){resetDraggedPane(gesture);lastTouch=null;return;}
    const finger=event.touches[0];
    if(finger.identifier!==gesture.identifier)return;
    const dx=finger.clientX-gesture.x,dy=finger.clientY-gesture.y;
    // Allow native vertical scrolling and nested interactive controls.
    if(!gesture.axis){
      if(Math.max(Math.abs(dx),Math.abs(dy))<9)return;
      gesture.axis=Math.abs(dx)>Math.abs(dy)*1.25?'horizontal':'vertical';
    }
    if(gesture.axis!=='horizontal')return;
    if(event.cancelable)event.preventDefault();
    if(swipeReduced())return;
    trackFinger(gesture,dx);
  },{passive:false});

  root?.addEventListener('touchend',event=>{
    const gesture=lastTouch;
    if(!gesture)return;
    lastTouch=null;
    // Make sure no inline transform survives into the next page or live.
    const finger=[...event.changedTouches].find(t=>t.identifier===gesture.identifier);
    const dx=finger?.clientX-gesture.x ?? 0;
    const dy=finger?.clientY-gesture.y ?? 0;
    const horizontal=gesture.axis==='horizontal' ||
      (!gesture.axis&&Math.abs(dx)>Math.abs(dy)*1.4);
    const entries=MOBILE_PANES[page]||[];
    const index=entries.findIndex(item=>item.id===preferred(page));
    const next=index+(dx<0?1:-1);
    const acceptable=enabled&&page===gesture.group &&
      gesture.selected===preferred(page)&&index>=0&&
      next>=0&&next<entries.length &&
      horizontal&&Math.abs(dx)>=SWIPE_MIN_PX&&
      Math.abs(dx)>Math.abs(dy)*1.25&&now()-gesture.at<=1250;
    resetDraggedPane(gesture,{snapBack:!acceptable});
    if(acceptable)select(page,entries[next].id);
  },{passive:true});

  root?.addEventListener('touchcancel',()=>{
    if(lastTouch)resetDraggedPane(lastTouch,{snapBack:true});
    lastTouch=null;
  },{passive:true});
  return {
    get:preferred,select,update,applyDom,
    destroy(){
      disposed=true;pendingSlide=null;cancelSlide();
      if(lastTouch){resetDraggedPane(lastTouch);lastTouch=null;}
      nav.replaceChildren();nav.hidden=true;
    },
  };
}
