// F02: the paired FIXE owns OAuth, preview, one-use consent and provider readback.
export function mountTwitchModeration(root,{request}={}){
  const doc=root.ownerDocument,view=doc.defaultView,section=doc.createElement('section');
  section.className='panel';section.setAttribute('aria-label','Modération Twitch avancée');
  const title=doc.createElement('h3');title.textContent='Shield Mode et AutoMod';
  const note=doc.createElement('p');note.textContent='Appliquer un réglage Twitch après vérification et confirmation. Le niveau global AutoMod remplace ses réglages individuels.';
  const form=doc.createElement('form'),label=doc.createElement('label'),select=doc.createElement('select');
  label.textContent='Réglage à appliquer';select.setAttribute('aria-label','Réglage de modération');
  for(const [value,text]of [['shield:true','Activer Shield Mode'],['shield:false','Désactiver Shield Mode'],...Array.from({length:5},(_,i)=>['automod:'+i,'AutoMod — niveau global '+i])]){
    const option=doc.createElement('option');option.value=value;option.textContent=text;select.append(option);
  }
  label.append(select);const preview=doc.createElement('button');preview.type='submit';preview.textContent='Vérifier sans modifier Twitch';
  form.append(label,preview);
  const review=doc.createElement('div');review.hidden=true;
  const description=doc.createElement('p'),agreement=doc.createElement('label'),agree=doc.createElement('input');
  agree.type='checkbox';agree.setAttribute('aria-label','Confirmer la modification Twitch');
  const text=doc.createElement('span');text.textContent='Je confirme ce changement de modération sur Twitch.';
  agreement.append(agree,text);
  const confirm=doc.createElement('button');confirm.type='button';confirm.textContent='Appliquer sur Twitch';
  review.append(description,agreement,confirm);
  const status=doc.createElement('p');status.setAttribute('role','status');
  const reconcile=doc.createElement('button');reconcile.type='button';reconcile.textContent="J’ai vérifié le réglage dans Twitch";reconcile.hidden=true;
  const heldTitle=doc.createElement('h4');heldTitle.textContent='Messages retenus par AutoMod';
  const heldRefresh=doc.createElement('button');heldRefresh.type='button';heldRefresh.textContent='Lire les retenues observées';
  const heldStatus=doc.createElement('p');heldStatus.setAttribute('aria-live','polite');
  const heldList=doc.createElement('ul');heldList.setAttribute('aria-label','Retenues AutoMod observées');
  section.append(title,note,form,review,status,reconcile,heldTitle,heldRefresh,heldStatus,heldList);root.append(section);
  let disposed=false,online=false,declaredOnline=false,sourceKey='',accountKey='',revision=0,flight=false,sending=false,uncertain=false,pending;
  let heldFlight=false,heldRevision=0;
  const connected=()=>!disposed&&root.isConnected&&online&&sourceKey&&view?.navigator?.onLine!==false&&doc.visibilityState!=='hidden';
  const cancel=()=>{pending=undefined;review.hidden=true;agree.checked=false};
  const draw=()=>{
    const enabled=connected()&&!flight&&!uncertain&&typeof request==='function';
    select.disabled=preview.disabled=!enabled;agree.disabled=!enabled||!pending;
    confirm.disabled=!enabled||!pending||!agree.checked||Date.now()>=pending.expiresAt;reconcile.hidden=!uncertain;
    heldRefresh.disabled=!connected()||heldFlight||typeof request!=='function';
  };
  const invalidate=message=>{revision++;heldRevision++;heldList.replaceChildren();heldStatus.textContent='Observations effacées : relecture manuelle nécessaire.';if(sending)uncertain=true;flight=false;cancel();status.textContent=uncertain?'Issue incertaine. Vérifiez le réglage dans Twitch ; aucun renvoi automatique.':message;draw()};
  const change=()=>{
    const [kind,value]=select.value.split(':');
    return {kind,value:kind==='shield'?value==='true':Number(value)};
  };
  select.addEventListener('change',()=>invalidate('Réglage changé : nouvelle vérification requise.'));
  agree.addEventListener('change',draw);
  reconcile.addEventListener('click',()=>{if(sending)return;uncertain=false;invalidate('Réglage vérifié par l’opérateur. Une nouvelle prévisualisation est requise.')});
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(!connected()||flight||uncertain||typeof request!=='function')return;
    cancel();flight=true;const key=++revision,target=sourceKey,selected=change();draw();
    status.textContent='Lecture des droits et du réglage actuel sur Twitch…';
    try{
      const result=await request('/api/v1/twitch/advanced/moderation/preview',{change:selected},'POST',target);
      if(!connected()||key!==revision||target!==sourceKey)return;
      if(result?.kind!=='streamcockpit-moderation-preview'||result.schemaVersion!==1||
        typeof result.confirmationId!=='string'||!Number.isFinite(result.expiresAt)||result.expiresAt<=Date.now()||
        result.expiresAt>Date.now()+45_000||JSON.stringify(result.change)!==JSON.stringify(selected))throw Error('INVALID_PREVIEW');
      pending=result;review.hidden=false;
      const before=selected.kind==='shield'?result.previous?.is_active:result.previous?.overall_level;
      description.textContent=(selected.kind==='shield'?'Shield Mode':'AutoMod global')+' : '+String(before??'personnalisé')+' → '+String(selected.value)+'.';
      status.textContent='Réglage vérifié. Aucun changement envoyé.';
    }catch(error){if(key===revision&&connected())status.textContent=error?.status===403?'Permission Twitch ou gestion de la régie manquante.':'Vérification indisponible. Aucun changement demandé.'}
    finally{if(key===revision){flight=false;draw()}}
  });
  confirm.addEventListener('click',async()=>{
    if(!connected()||flight||uncertain||!pending||!agree.checked||Date.now()>=pending.expiresAt)return;
    const id=pending.confirmationId,expected=pending.change,target=sourceKey,key=++revision;cancel();flight=true;sending=true;draw();
    status.textContent='Modification demandée au FIXE ; attente de la relecture Twitch.';
    try{
      const result=await request('/api/v1/twitch/advanced/moderation/confirm',{confirmationId:id,confirmed:true},'POST',target);
      if(!connected()||key!==revision||target!==sourceKey){uncertain=true;return}
      if(result?.kind!=='streamcockpit-moderation-confirmation'||result.schemaVersion!==1||!['confirmed','unchanged'].includes(result.status)||JSON.stringify(result.change)!==JSON.stringify(expected))throw Error('UNVERIFIED_RECEIPT');
      status.textContent=result.status==='unchanged'?'Twitch utilisait déjà ce réglage. Aucune écriture envoyée.':'Modification confirmée puis relue sur Twitch.';
    }catch{uncertain=true;status.textContent='Issue incertaine. Vérifiez le réglage dans Twitch avant une nouvelle demande. Aucun renvoi automatique.'}
    finally{sending=false;if(key===revision)flight=false;draw()}
  });
  // Voluntary read-only refresh; unlike the settings button it never makes
  // a Twitch write. Data only covers messages witnessed by FIXE EventSub.
  heldRefresh.addEventListener('click',async()=>{
    if(!connected()||heldFlight||typeof request!=='function')return;
    const target=sourceKey,key=++heldRevision;
    heldFlight=true;heldList.replaceChildren();
    heldStatus.textContent='Lecture des retenues observées par FIXE…';draw();
    try{
      const data=await request('/api/v1/twitch/advanced/moderation/held',undefined,'GET',target);
      if(key!==heldRevision||target!==sourceKey||!connected())return;
      if(data?.kind!=='streamcockpit-automod-observed'||data.schemaVersion!==1||
        !['partial-observation','unavailable'].includes(data.status)||
        !Array.isArray(data.messages)||data.messages.length>50)throw Error('INVALID_OBSERVATION');
      for(const item of data.messages){
        if(typeof item?.id!=='string'||typeof item?.text!=='string'||
          typeof item?.userName!=='string'||typeof item?.heldAt!=='string')throw Error('INVALID_ITEM');
        const li=doc.createElement('li');
        li.textContent=item.userName.slice(0,100)+' : '+item.text.slice(0,500);
        heldList.append(li);
      }
      heldStatus.textContent=data.status==='unavailable'
        ?'EventSub indisponible ou scope manquant. Rien ne prouve que la file Twitch soit vide.'
        :'Réception partielle : '+data.messages.length+' message(s) vus depuis la connexion. Cette liste ne remplace pas la file Twitch.';
    }catch{
      if(key===heldRevision&&connected())heldStatus.textContent='Lecture AutoMod indisponible ; consultez Twitch. Aucun message supposé approuvé.';
    }finally{heldFlight=false;if(key===heldRevision)draw();}
  });
  const offline=()=>{online=false;invalidate('Hors ligne : confirmation invalidée.');};
  const resume=event=>{if(event.type==='online')online=declaredOnline;invalidate('Connexion ou vue reprise : vérification requise.');};
  view?.addEventListener('offline',offline);view?.addEventListener('online',resume);doc.addEventListener('visibilitychange',resume);
  status.textContent='Source non associée.';draw();
  return {update(context={}){
    if(disposed)return;
    const next=context.online===true,key=typeof context.sourceKey==='string'?context.sourceKey:'',account=typeof context.accountKey==='string'?context.accountKey:'';
    const changed=next!==online||key!==sourceKey||account!==accountKey;declaredOnline=next;online=next;sourceKey=key;accountKey=account;
    if(changed)invalidate(online?'Prêt à vérifier un réglage.':'Source déconnectée.');else draw();
  },destroy(){disposed=true;invalidate('Vue fermée.');view?.removeEventListener('offline',offline);view?.removeEventListener('online',resume);doc.removeEventListener('visibilitychange',resume);section.remove()}};
}
