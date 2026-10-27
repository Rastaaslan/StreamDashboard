/**
 * Shared compact soundboard pane used from Live and from Deck.
 * All actions are delegated to the existing verified control dispatcher.
 */
export function renderMobileSoundboard(root,{sounds=[],activePlaybacks=[],currentPlayback=null,category='',online=false,blocked=false,busy=false,canStop=false}={}){
  const catalog=Array.isArray(sounds)?sounds.filter(x=>x&&typeof x.id==='string'):[];
  const categories=[...new Set(catalog.map(x=>String(x.category||'')).filter(Boolean))];
  const shown=catalog.filter(x=>!category||(category==='favorites'?x.favorite===true:x.category===category));
  const el=(tag,cls,text)=>{
    const node=document.createElement(tag);
    if(cls)node.className=cls;
    if(text!==undefined)node.textContent=String(text);
    return node;
  };
  const heading=el('div','mobile-pane-title');
  heading.append(el('h2','', '♫ Soundboard'),el('small','',shown.length+' son(s)'));
  const categoriesBar=el('div','mobile-pane-sound-filters');
  categoriesBar.setAttribute('role','group');
  categoriesBar.setAttribute('aria-label','Catégories de la soundboard');
  for(const [key,label] of [['','Tous'],['favorites','Favoris'],...categories.map(x=>[x,x])]){
    const b=el('button',key===category?'':'secondary',label);
    b.type='button';b.dataset.soundCategory=key;
    b.setAttribute('aria-pressed',String(key===category));
    categoriesBar.append(b);
  }
  const grid=el('div','mobile-pane-sound-grid');
  if(!shown.length){
    grid.append(el('p','mobile-pane-empty',
      'Aucun son à afficher. Importez-en depuis Gestion → Bibliothèque audio.'));
  }
  for(const sound of shown.slice(0,48)){
    const playing=[...(Array.isArray(activePlaybacks)?activePlaybacks:[]),currentPlayback].some(p=>p?.soundId===sound.id);
    const button=el('button',playing?'playing':'');
    button.type='button';button.dataset.playSound=sound.id;
    button.disabled=!online||blocked||busy||!sound.enabled||!sound.sourceAvailable;
    button.append(el('strong','', '♫ '+String(sound.name||'Son')),
                  el('small','',playing?'En lecture':String(sound.category||'Jouer')));
    grid.append(button);
  }
  const actions=el('div','mobile-pane-actions');
  const stop=el('button','danger','■ Arrêter tous les sons');
  stop.type='button';stop.dataset.action='sound.stop';stop.disabled=!canStop;
  actions.append(stop);
  const more=el('button','secondary','Bibliothèque et soundboard complète');
  more.type='button';more.dataset.page='sounds';actions.append(more);
  root.replaceChildren(heading,categoriesBar,grid,actions);
}
