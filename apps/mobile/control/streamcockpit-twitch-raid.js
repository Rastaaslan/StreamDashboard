// F08: manually prepared/confirmed raid requests via the paired FIXE authority.
const base='/api/v1/twitch/advanced/raid/';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const loginPattern=/^[a-z0-9_]{4,25}$/;
export function mountTwitchRaid(root,{request}={}){
  const doc=root.ownerDocument,view=doc.defaultView;
  const element=(tag,text)=>{const e=doc.createElement(tag);if(text)e.textContent=text;return e;};
  const section=element('section');section.className='cockpit-twitch-raid panel';section.setAttribute('aria-label','Raid Twitch');
  const form=element('form'),operation=element('select');operation.setAttribute('aria-label','Action du raid');
  for(const [value,text] of [['start','Préparer un raid vers une chaîne'],['cancel','Annuler le raid en attente']]){
    const o=element('option',text);o.value=value;operation.append(o);
  }
  const label=element('label','Chaîne Twitch à raider (sans @)'),input=element('input');
  input.type='text';input.maxLength=25;input.autocomplete='off';input.setAttribute('aria-label','Chaîne Twitch à raider (sans @)');
  input.style.width='100%';input.style.maxWidth='100%';input.style.boxSizing='border-box';
  operation.style.maxWidth='100%';label.append(input);
  const prepare=element('button','Vérifier sans lancer de raid');prepare.type='submit';form.append(operation,label,prepare);
  const review=element('div');review.hidden=true;
  const details=element('p'),agreement=element('label'),consent=element('input');consent.type='checkbox';
  agreement.append(consent,element('span','Je confirme cette action publique sur Twitch.'));
  const confirm=element('button','Confirmer sur Twitch');confirm.type='button';review.append(details,agreement,confirm);
  const status=element('p');status.setAttribute('role','status');
  const reconciled=element('button','J’ai vérifié l’état du raid dans Twitch');reconciled.type='button';reconciled.hidden=true;
  section.append(element('h3','Raid Twitch'),element('p','Un raid préparé sur Twitch peut partir automatiquement. Vérifiez la cible avant de confirmer.'),form,review,status,reconciled);
  root.append(section);
  let disposed=false,online=false,source='',account='',revision=0,flight='',locked=false,pending;
  const connected=()=>!disposed&&root.isConnected&&online&&!!source&&view?.navigator?.onLine!==false&&doc.visibilityState!=='hidden';
  const clear=()=>{pending=undefined;review.hidden=true;consent.checked=false;details.textContent='';};
  const draw=()=>{
    const enabled=connected()&&!flight&&!locked&&typeof request==='function';
    operation.disabled=prepare.disabled=input.disabled=!enabled;
    label.hidden=operation.value==='cancel';
    prepare.textContent=operation.value==='cancel'?'Préparer la demande d’annulation':'Vérifier sans lancer de raid';
    consent.disabled=!enabled||!pending;
    confirm.disabled=!enabled||!pending||!consent.checked||Date.now()>=pending.expiresAt;
    reconciled.hidden=!locked;reconciled.disabled=!connected()||!!flight;
  };
  const invalidate=message=>{
    if(flight==='confirm')locked=true;
    revision++;flight='';clear();input.value='';
    status.textContent=locked?'Résultat du raid incertain. Vérifiez son état dans Twitch avant une nouvelle action.':message;draw();
  };
  const wanted=()=>operation.value==='cancel'?{operation:'cancel'}:{operation:'start',login:input.value.trim().toLowerCase()};
  const changed=()=>{if(flight)return;clear();status.textContent='Action modifiée : prévisualisation à refaire.';draw();};
  operation.addEventListener('change',changed);input.addEventListener('input',changed);consent.addEventListener('change',draw);
  reconciled.addEventListener('click',()=>{if(!connected()||flight)return;locked=false;invalidate('État vérifié dans Twitch : une nouvelle prévisualisation est nécessaire.');});
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(!connected()||flight||locked||typeof request!=='function')return;
    const desired=wanted();
    if(desired.operation==='start'&&!loginPattern.test(desired.login)){
      clear();status.textContent='Nom de chaîne Twitch invalide (4 à 25 lettres, chiffres ou _ ; sans @).';draw();return;
    }
    clear();const key=++revision,target=source;flight='preview';draw();status.textContent='Vérification sur le FIXE…';
    try{
      const result=await request(base+'preview',{request:desired},'POST',target);
      if(!connected()||key!==revision||target!==source)return;
      if(result?.kind!=='streamcockpit-raid-preview'||result.schemaVersion!==1||!uuid.test(result.confirmationId)||
        result.operation!==desired.operation||!Number.isFinite(result.expiresAt)||result.expiresAt<=Date.now()||
        result.expiresAt>Date.now()+45000||(desired.operation==='start'&&result.targetLogin!==desired.login))
        throw Error('UNVERIFIED_RAID_PREVIEW');
      pending={id:result.confirmationId,expiresAt:result.expiresAt,desired};
      details.textContent=desired.operation==='start'?'Cible vérifiée en direct : '+desired.login+'. Twitch pourra lancer le raid après cette confirmation.':
        'Demander l’annulation du raid actuellement en attente sur votre chaîne. Cette prévisualisation ne confirme pas sa présence.';
      review.hidden=false;status.textContent='Prévisualisation prête. Aucune action publique envoyée.';
    }catch(error){
      if(!connected()||key!==revision)return;
      clear();status.textContent=error?.status===403?'Permission Twitch ou gestion de la régie insuffisante.':
        error?.status===409?'Cible absente, hors ligne, ou direct du FIXE non confirmé.':
        'Prévisualisation indisponible. Aucune demande de raid envoyée.';
    }finally{if(!disposed&&key===revision){flight='';draw();}}
  });
  confirm.addEventListener('click',async()=>{
    if(!connected()||flight||locked||!pending||!consent.checked||Date.now()>=pending.expiresAt||typeof request!=='function')return;
    if(JSON.stringify(wanted())!==JSON.stringify(pending.desired)){clear();draw();return;}
    const key=++revision,target=source,id=pending.id,desired=pending.desired;
    clear();flight='confirm';draw();status.textContent='Demande envoyée au FIXE. Aucun renvoi automatique.';
    try{
      const result=await request(base+'confirm',{confirmationId:id,confirmed:true},'POST',target);
      if(!connected()||key!==revision||target!==source)return;
      if(result?.kind!=='streamcockpit-raid-confirmation'||result.schemaVersion!==1||result.operation!==desired.operation||
        (desired.operation==='start'?(result.status!=='requested'||result.targetLogin!==desired.login):result.status!=='cancel-accepted'))
        throw Error('UNVERIFIED_RAID_RECEIPT');
      input.value='';status.textContent=desired.operation==='start'?
        'Twitch a accepté la préparation du raid vers '+desired.login+'. Le transfert des spectateurs n’est pas encore confirmé.':
        'Twitch a accepté l’annulation du raid en attente.';
    }catch{
      if(!connected()||key!==revision)return;
      locked=true;input.value='';status.textContent='Résultat du raid incertain. Vérifiez son état dans Twitch avant une nouvelle action. Aucun renvoi automatique.';
    }finally{if(!disposed&&key===revision){flight='';draw();}}
  });
  const offline=()=>invalidate('Hors ligne : raids indisponibles.'),resume=()=>invalidate('Connexion reprise : nouvelle prévisualisation requise.');
  view?.addEventListener('offline',offline);view?.addEventListener('online',resume);doc.addEventListener('visibilitychange',resume);
  status.textContent='Source non associée : aucun raid possible.';draw();
  return {update(context={}){
    if(disposed)return;
    const nextOnline=context.online===true,nextSource=typeof context.sourceKey==='string'?context.sourceKey:'',
      nextAccount=typeof context.accountKey==='string'?context.accountKey:'';
    const changed=online!==nextOnline||source!==nextSource||account!==nextAccount;
    online=nextOnline;source=nextSource;account=nextAccount;
    if(changed)invalidate(online?'Prêt à prévisualiser une action de raid.':'Source déconnectée.');draw();
  },destroy(){if(disposed)return;disposed=true;revision++;clear();
    view?.removeEventListener('offline',offline);view?.removeEventListener('online',resume);doc.removeEventListener('visibilitychange',resume);section.remove();}};
}
