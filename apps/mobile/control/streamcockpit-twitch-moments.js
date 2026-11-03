// F04 simple provider moments, independent of the deferred video editor.
export function mountTwitchMoments(root,{request}={}){
  const doc=root.ownerDocument,view=doc.defaultView,section=doc.createElement('section');
  section.className='panel';section.setAttribute('aria-label','Marqueurs et clips Twitch');
  const heading=doc.createElement('h3');heading.textContent='Marqueurs et clips Twitch';
  const note=doc.createElement('p');note.textContent='Marquer le direct ou demander un clip Twitch simple. Un marqueur exige les VOD activées. Twitch traite les clips de façon asynchrone.';
  const form=doc.createElement('form'),kind=doc.createElement('select');kind.setAttribute('aria-label','Type de moment Twitch');
  for(const [value,text]of [['marker','Marqueur dans la VOD'],['clip','Clip Twitch simple']]){const o=doc.createElement('option');o.value=value;o.textContent=text;kind.append(o)}
  const label=doc.createElement('label'),description=doc.createElement('input');description.maxLength=140;
  label.textContent='Description du repère (140 caractères maximum)';description.setAttribute('aria-label','Description du moment');label.append(description);
  const preview=doc.createElement('button');preview.type='submit';preview.textContent='Vérifier le moment sans publier';form.append(kind,label,preview);
  const review=doc.createElement('div');review.hidden=true;
  const agreement=doc.createElement('label'),agree=doc.createElement('input'),text=doc.createElement('span');
  agree.type='checkbox';agree.setAttribute('aria-label','Confirmer le moment Twitch');text.textContent='Je confirme cette demande sur le direct Twitch.';agreement.append(agree,text);
  const publish=doc.createElement('button');publish.type='button';publish.textContent='Créer ce moment sur Twitch';review.append(agreement,publish);
  const status=doc.createElement('p');status.setAttribute('role','status');
  const link=doc.createElement('a');link.textContent='Ouvrir le clip dans Twitch';link.target='_blank';link.rel='noopener noreferrer';link.hidden=true;
  const verified=doc.createElement('button');verified.type='button';verified.textContent='J’ai vérifié ce moment dans Twitch';verified.hidden=true;
  section.append(heading,note,form,review,status,link,verified);root.append(section);
  let disposed=false,online=false,sourceKey='',accountKey='',revision=0,flight=false,sending=false,uncertain=false,pending;
  const connected=()=>!disposed&&root.isConnected&&online&&sourceKey&&view?.navigator?.onLine!==false&&doc.visibilityState!=='hidden';
  const cancel=()=>{pending=undefined;review.hidden=true;agree.checked=false};
  const draw=()=>{const enabled=connected()&&!flight&&!uncertain&&typeof request==='function';kind.disabled=description.disabled=preview.disabled=!enabled;agree.disabled=!enabled||!pending;publish.disabled=!enabled||!pending||!agree.checked||Date.now()>=pending.expiresAt;verified.hidden=!uncertain};
  const invalidate=message=>{revision++;if(sending)uncertain=true;flight=false;cancel();link.hidden=true;link.removeAttribute('href');status.textContent=uncertain?'Résultat incertain : vérifiez Twitch avant une nouvelle demande. Aucun renvoi automatique.':message;draw()};
  kind.addEventListener('change',()=>invalidate('Type modifié : nouvelle vérification requise.'));
  description.addEventListener('input',()=>{cancel();draw()});agree.addEventListener('change',draw);
  verified.addEventListener('click',()=>{if(sending)return;uncertain=false;invalidate('Vérification externe confirmée. Une nouvelle prévisualisation est requise.')});
  form.addEventListener('submit',async e=>{
    e.preventDefault();if(!connected()||flight||uncertain||typeof request!=='function')return;
    cancel();link.hidden=true;const target=sourceKey,key=++revision,draft={kind:kind.value,description:description.value.trim()};flight=true;draw();
    try{
      const r=await request('/api/v1/twitch/advanced/moment/preview',{draft},'POST',target);
      if(!connected()||key!==revision||sourceKey!==target)return;
      if(r?.schemaVersion!==1||r.kind!=='streamcockpit-moment-preview'||typeof r.confirmationId!=='string'||!Number.isFinite(r.expiresAt)||
        r.expiresAt<=Date.now()||r.expiresAt>Date.now()+45_000||JSON.stringify(r.draft)!==JSON.stringify(draft))throw Error('UNVERIFIED');
      pending=r;review.hidden=false;status.textContent='Direct et permissions vérifiés. Aucun moment créé.';
    }catch(error){if(key===revision&&connected())status.textContent=error?.status===403?'Autorisation Twitch ou gestion de la régie manquante.':'Direct FIXE ou autorisation non confirmés. Aucun moment demandé.'}
    finally{if(key===revision){flight=false;draw()}}
  });
  publish.addEventListener('click',async()=>{
    if(!connected()||flight||uncertain||!pending||!agree.checked||Date.now()>=pending.expiresAt)return;
    const id=pending.confirmationId,expected=pending.draft.kind,target=sourceKey,key=++revision;cancel();flight=true;sending=true;draw();
    try{
      const r=await request('/api/v1/twitch/advanced/moment/confirm',{confirmationId:id,confirmed:true},'POST',target);
      if(!connected()||key!==revision||target!==sourceKey){uncertain=true;return}
      if(r?.schemaVersion!==1||r.kind!=='streamcockpit-moment-confirmation'||r.momentKind!==expected||r.status!==(expected==='marker'?'confirmed':'accepted'))throw Error('UNVERIFIED');
      status.textContent=r.status==='confirmed'?'Marqueur confirmé par Twitch.':'Demande de clip acceptée par Twitch ; disponibilité de la vidéo à vérifier.';
      status.textContent+=r.journal==='recorded'?' Ajouté à la timeline.':r.journal==='uncertain'?' Écriture timeline incertaine : vérifiez le journal, sans recréer le moment.':' Aucune session liée pour la timeline.';
      if(r.editUrl){const url=new URL(r.editUrl);if(url.protocol==='https:'&&url.hostname==='clips.twitch.tv'&&!url.username&&!url.password){link.href=url.href;link.hidden=false}}
    }catch{uncertain=true;status.textContent='Résultat incertain : vérifiez Twitch avant une nouvelle demande. Aucun renvoi automatique.'}
    finally{sending=false;if(key===revision)flight=false;draw()}
  });
  const pause=()=>invalidate('Connexion ou vue interrompue : confirmation invalidée.');
  view?.addEventListener('offline',pause);view?.addEventListener('online',pause);doc.addEventListener('visibilitychange',pause);
  status.textContent='Source non associée.';draw();
  return {update(c={}){if(disposed)return;const next=c.online===true,key=typeof c.sourceKey==='string'?c.sourceKey:'',account=typeof c.accountKey==='string'?c.accountKey:'';
    const changed=next!==online||key!==sourceKey||account!==accountKey;online=next;sourceKey=key;accountKey=account;
    if(changed)invalidate(online?'Prêt à vérifier un moment.':'Source déconnectée.');else draw()},
    destroy(){disposed=true;invalidate('Vue fermée.');view?.removeEventListener('offline',pause);view?.removeEventListener('online',pause);doc.removeEventListener('visibilitychange',pause);section.remove()}};
}
