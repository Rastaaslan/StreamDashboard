// F08: voluntary Twitch shoutout from the authenticated FIXE host only.
// Preview performs verified Twitch GETs. Confirm may make exactly ONE public POST.
const previewPath='/api/v1/twitch/advanced/shoutout/preview';
const confirmPath='/api/v1/twitch/advanced/shoutout/confirm';
const validLogin=/^[a-z0-9_]{4,25}$/;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function mountTwitchShoutout(root,{request}={}) {
  const doc=root.ownerDocument,view=doc.defaultView;
  const section=doc.createElement('section');
  section.className='cockpit-twitch-shoutout panel';
  section.setAttribute('aria-label','Shoutout Twitch');
  const heading=doc.createElement('h3');heading.textContent='Shoutout Twitch';
  const hint=doc.createElement('p');hint.className='small muted';
  hint.textContent='Mettre une chaîne à l’honneur, pendant le direct confirmé du FIXE. Un shoutout est public dès confirmation.';
  const form=doc.createElement('form');
  const label=doc.createElement('label');label.textContent='Chaîne Twitch (sans @)';
  const input=doc.createElement('input');input.type='text';input.maxLength=25;
  input.autocomplete='off';input.setAttribute('aria-label','Chaîne Twitch (sans @)');
  label.append(input);
  const preview=doc.createElement('button');preview.type='submit';
  preview.textContent='Vérifier la chaîne sans publier';
  form.append(label,preview);
  const review=doc.createElement('div');review.hidden=true;
  const description=doc.createElement('p');description.setAttribute('role','status');
  const confirmLabel=doc.createElement('label');
  const agree=doc.createElement('input');agree.type='checkbox';
  const agreeText=doc.createElement('span');
  agreeText.textContent='Je confirme le shoutout public immédiat sur Twitch.';
  confirmLabel.append(agree,agreeText);
  const publish=doc.createElement('button');publish.type='button';
  publish.textContent='Publier le shoutout sur Twitch';
  review.append(description,confirmLabel,publish);
  const status=doc.createElement('p');status.setAttribute('role','status');
  section.append(heading,hint,form,review,status);root.append(section);
  if(input.style){input.style.width='100%';input.style.maxWidth='100%';input.style.boxSizing='border-box';}

  let disposed=false,online=false,sourceKey='',accountKey='',revision=0;
  let flight=false,uncertain=false,pending;
  const connected=()=>!disposed&&root.isConnected&&online&&!!sourceKey&&
    view?.navigator?.onLine!==false&&doc.visibilityState!=='hidden';
  const cancelPreview=()=>{pending=undefined;review.hidden=true;agree.checked=false;description.textContent='';};
  const draw=()=>{
    const enabled=connected()&&!flight&&!uncertain&&typeof request==='function';
    input.disabled=preview.disabled=!enabled;
    agree.disabled=!enabled||!pending;
    publish.disabled=!enabled||!pending||!agree.checked||Date.now()>=pending.expiresAt;
  };
  const invalidate=message=>{
    revision++;flight=false;uncertain=false;cancelPreview();input.value='';
    status.textContent=message;draw();
  };
  const normalize=()=>{const login=input.value.trim().toLowerCase();return validLogin.test(login)?login:null;};
  input.addEventListener('input',()=>{if(disposed||flight)return;cancelPreview();status.textContent='Chaîne modifiée : vérification à refaire.';draw();});
  agree.addEventListener('change',draw);
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(!connected()||flight||uncertain||typeof request!=='function')return;
    const login=normalize();
    if(!login){cancelPreview();status.textContent='Nom de chaîne Twitch invalide (4 à 25 lettres, chiffres ou _ ; sans @).';draw();return;}
    cancelPreview();const key=++revision,target=sourceKey;flight=true;draw();
    status.textContent='Vérification de la chaîne et des autorisations sur le FIXE…';
    try{
      const result=await request(previewPath,{target:{login}},'POST',target);
      if(disposed||!connected()||key!==revision||target!==sourceKey)return;
      if(result?.kind!=='streamcockpit-shoutout-preview'||result.schemaVersion!==1||
        !uuid.test(result.confirmationId)||result.targetLogin!==login||
        !Number.isFinite(result.expiresAt)||result.expiresAt<=Date.now()||
        result.expiresAt>Date.now()+45_000)throw new Error('UNVERIFIED_PREVIEW');
      pending={id:result.confirmationId,expiresAt:result.expiresAt,login};
      description.textContent='Chaîne vérifiée : '+login+'. Le shoutout sera envoyé publiquement seulement après votre confirmation.';
      review.hidden=false;status.textContent='Prévisualisation terminée, aucune publication déclenchée.';
    }catch(error){
      if(disposed||!connected()||key!==revision)return;
      cancelPreview();
      status.textContent=error?.status===403?'Autorisation Twitch ou gestion de la régie insuffisante.':
        error?.status===409?'Chaîne introuvable, hors préconditions ou direct FIXE non confirmé.':
        error?.status===429?'Limite Twitch atteinte. Aucune publication envoyée.':
        'Vérification indisponible. Aucun shoutout demandé.';
    }finally{if(!disposed&&key===revision){flight=false;draw();}}
  });
  publish.addEventListener('click',async()=>{
    if(!connected()||flight||uncertain||!pending||!agree.checked||
        Date.now()>=pending.expiresAt||typeof request!=='function')return;
    if(normalize()!==pending.login){cancelPreview();draw();return;}
    const key=++revision,target=sourceKey,id=pending.id;
    cancelPreview();flight=true;draw();
    status.textContent='Shoutout demandé au FIXE. Le résultat peut être incertain : aucun renvoi automatique.';
    try{
      const result=await request(confirmPath,{confirmationId:id,confirmed:true},'POST',target);
      if(disposed||!connected()||key!==revision||target!==sourceKey)return;
      if(result?.kind!=='streamcockpit-shoutout-confirmation'||result.schemaVersion!==1||
        result.status!=='accepted'||!validLogin.test(result.targetLogin))throw new Error('UNVERIFIED_CONFIRMATION');
      input.value='';
      status.textContent='Twitch a accepté la demande de shoutout. Son affichage aux spectateurs n’est pas garanti.';
    }catch{
      if(disposed||!connected()||key!==revision)return;
      uncertain=true;input.value='';
      status.textContent='Issue du shoutout incertaine. Vérifiez dans Twitch avant toute nouvelle demande. Aucun renvoi automatique.';
    }finally{if(!disposed&&key===revision){flight=false;draw();}}
  });
  const offline=()=>invalidate('Hors ligne : shoutout indisponible.');
  const onlineEvent=()=>invalidate('Connexion rétablie : nouvelle vérification requise.');
  const visibility=()=>invalidate('Vue suspendue ou reprise : confirmation précédente invalidée.');
  view?.addEventListener('offline',offline);view?.addEventListener('online',onlineEvent);
  doc.addEventListener('visibilitychange',visibility);
  status.textContent='Source non associée : aucun shoutout possible.';draw();
  return {
    update(context={}){
      if(disposed)return;
      const newOnline=context.online===true,newSource=typeof context.sourceKey==='string'?context.sourceKey:'',
        newAccount=typeof context.accountKey==='string'?context.accountKey:'';
      const changed=online!==newOnline||sourceKey!==newSource||accountKey!==newAccount;
      online=newOnline;sourceKey=newSource;accountKey=newAccount;
      if(changed)invalidate(online?'Prêt à vérifier une chaîne Twitch.':'Source déconnectée.');
      draw();
    },
    destroy(){
      if(disposed)return;
      disposed=true;invalidate('Vue fermée.');
      view?.removeEventListener('offline',offline);view?.removeEventListener('online',onlineEvent);
      doc.removeEventListener('visibilitychange',visibility);section.remove();
    },
  };
}
