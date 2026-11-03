/** F08: voluntary terminal action on the saved FIXE Twitch prediction.
 * The client never owns OBS, Twitch tokens, SQLite or any automatic retry.
 */
const BASE='/api/v1/twitch/advanced/prediction/end';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const providerId=/^[A-Za-z0-9-]{1,128}$/;
export function mountTwitchPredictionEnd(root,{request}={}){
  const doc=root.ownerDocument,view=doc.defaultView;
  const panel=doc.createElement('section');
  panel.className='cockpit-twitch-prediction-end panel';
  panel.setAttribute('aria-label','Terminer une prédiction Twitch');
  const title=doc.createElement('h3');
  title.textContent='Terminer une prédiction Twitch';
  const info=doc.createElement('p');
  info.className='small muted';
  info.textContent='Résoudre ou annuler la prédiction exacte enregistrée par FIXE. Une action publique irréversible, à confirmer deux fois.';
  const inspect=doc.createElement('button');
  inspect.type='button';inspect.textContent='Inspecter la prédiction sur FIXE';
  const controls=doc.createElement('div');controls.hidden=true;
  const actionLabel=doc.createElement('label');actionLabel.textContent='Action';
  const action=doc.createElement('select');
  if(action.style)action.style.maxWidth='100%';
  const resolveChoice=doc.createElement('option');
  resolveChoice.value='RESOLVED';resolveChoice.textContent='Résoudre (désigner le résultat gagnant)';
  const cancelChoice=doc.createElement('option');
  cancelChoice.value='CANCELED';cancelChoice.textContent='Annuler la prédiction';
  action.append(resolveChoice,cancelChoice);
  actionLabel.append(action);
  const winnerLabel=doc.createElement('label');
  winnerLabel.textContent='Résultat gagnant';
  const winner=doc.createElement('select');
  if(winner.style)winner.style.maxWidth='100%';
  winnerLabel.append(winner);
  const preview=doc.createElement('button');
  preview.type='button';preview.textContent='Prévisualiser la fin Twitch';
  controls.append(actionLabel,winnerLabel,preview);
  const consentPanel=doc.createElement('div');consentPanel.hidden=true;
  const description=doc.createElement('p');
  const label=doc.createElement('label');
  const checkbox=doc.createElement('input');checkbox.type='checkbox';
  const agreement=doc.createElement('span');
  agreement.textContent='Je confirme cette fin publique et irréversible sur Twitch.';
  label.append(checkbox,agreement);
  const confirm=doc.createElement('button');
  confirm.type='button';confirm.textContent='Confirmer la fin de la prédiction Twitch';
  consentPanel.append(description,label,confirm);
  const status=doc.createElement('p');
  status.className='small';status.setAttribute('role','status');
  panel.append(title,info,inspect,controls,consentPanel,status);
  root.append(panel);

  let disposed=false,sourceKey='',accountKey='',online=false,revision=0;
  let busy=false,attempted=false,uncertain=false,started=false,pending,observation;
  const connected=()=>!disposed&&root.isConnected&&online&&!!sourceKey&&
    view?.navigator?.onLine!==false&&doc.visibilityState!=='hidden';
  const clear=()=>{pending=undefined;consentPanel.hidden=true;checkbox.checked=false;};
  const draw=()=>{
    const ready=connected()&&!busy&&!attempted&&typeof request==='function';
    inspect.disabled=!ready;
    const has=!!observation;
    action.disabled=!ready||!has;
    winner.disabled=!ready||!has||action.value!=='RESOLVED';
    winnerLabel.hidden=action.value!=='RESOLVED';
    preview.disabled=!ready||!has||(action.value==='RESOLVED'&&
      (!observation.canResolve||!providerId.test(winner.value)));
    checkbox.disabled=!ready||!pending;
    confirm.disabled=!ready||!pending||!checkbox.checked||Date.now()>=pending.expiresAt;
  };
  const invalidate=reason=>{
    revision++;
    if(started){attempted=true;uncertain=true;}
    started=false;busy=false;clear();observation=undefined;controls.hidden=true;
    status.textContent=uncertain
      ? 'Fin Twitch potentiellement effectuée. Résultat incertain : aucune seconde tentative. Vérifiez depuis FIXE.'
      : attempted ? 'Fin Twitch déjà tentée. Aucune répétition automatique.' : reason;
    draw();
  };
  const run=async(path,body,method,onSuccess,onFailure)=>{
    if(!connected()||busy||typeof request!=='function')return;
    const host=sourceKey,account=accountKey,seq=++revision;
    busy=true;draw();
    try{
      const result=await request(path,body,method,host);
      if(seq===revision&&connected()&&sourceKey===host&&accountKey===account)onSuccess(result);
    }catch{
      if(seq===revision&&connected()&&sourceKey===host&&accountKey===account)onFailure();
    }finally{
      if(seq===revision&&!disposed){
        if(started){
          started=false;attempted=true;uncertain=true;
          status.textContent='Accusé de fin Twitch perdu : résultat incertain, aucun renvoi automatique.';
        }
        busy=false;draw();
      }
    }
  };
  inspect.addEventListener('click',()=>{
    if(!connected()||busy||attempted)return;
    clear();observation=undefined;controls.hidden=true;
    status.textContent='Lecture exacte de Twitch via la régie FIXE, sans mutation…';
    void run(BASE+'/inspect',undefined,'GET',data=>{
      if(data?.schemaVersion!==1||data.kind!=='streamcockpit-prediction-end-inspection'||
          !['active','locked'].includes(data.providerStatus)||
          !Array.isArray(data.outcomes)||data.outcomes.length<2||data.outcomes.length>10||
          data.outcomes.some(row=>!providerId.test(row?.id)||
            typeof row.title!=='string'||!row.title.trim()||
            [...row.title].length>25)||
          new Set(data.outcomes.map(row=>row.id)).size!==data.outcomes.length||
          data.canResolve!==(data.providerStatus==='locked')||data.canCancel!==true||
          data.mutationPerformed!==false){
        status.textContent='Observation invalide, aucune opération autorisée.';return;
      }
      observation={canResolve:data.canResolve};
      winner.replaceChildren();
      for(const item of data.outcomes){
        const option=doc.createElement('option');
        option.value=item.id;option.textContent=item.title;
        winner.append(option);
      }
      action.value=data.canResolve?'RESOLVED':'CANCELED';
      controls.hidden=false;
      status.textContent='Prédiction '+data.providerStatus+' vérifiée. Choisissez volontairement la fin souhaitée.';
    },()=>{status.textContent='Observation FIXE/Twitch indisponible ; aucune fin autorisée.';});
  });
  action.addEventListener('change',()=>{clear();draw();});
  winner.addEventListener('change',()=>{clear();draw();});
  preview.addEventListener('click',()=>{
    if(!connected()||busy||attempted||!observation)return;
    const draft=action.value==='RESOLVED'
      ?{action:'RESOLVED',winnerId:winner.value}:{action:'CANCELED'};
    if(draft.action==='RESOLVED'&&(!observation.canResolve||!providerId.test(draft.winnerId)))return;
    clear();status.textContent='Deuxième vérification Twitch avant consentement…';
    void run(BASE+'/preview',draft,'POST',data=>{
      if(data?.schemaVersion!==1||data.kind!=='streamcockpit-prediction-end-preview'||
          !UUID.test(data.confirmationId)||
          data.action!==draft.action.toLowerCase()||
          (draft.action==='RESOLVED'&&data.winnerId!==draft.winnerId)||
          !Number.isFinite(data.expiresAt)||data.expiresAt<=Date.now()||
          data.expiresAt>Date.now()+30_000){
        status.textContent='Prévisualisation invalide ; aucun envoi public.';return;
      }
      pending={confirmationId:data.confirmationId,expiresAt:data.expiresAt};
      description.textContent=draft.action==='RESOLVED'
        ?'Twitch attribuera les points à « '+winner.selectedOptions[0]?.textContent+' ». Confirmez seulement après vérification.'
        :'Twitch annulera les paris de cette prédiction. Confirmez seulement après vérification.';
      consentPanel.hidden=false;
      status.textContent='Consentement prêt, aucune fin de prédiction encore demandée.';
    },()=>{status.textContent='Prévisualisation refusée : aucun PATCH Twitch envoyé.';});
  });
  checkbox.addEventListener('change',draw);
  confirm.addEventListener('click',()=>{
    if(!connected()||busy||attempted||!pending||!checkbox.checked||
        Date.now()>=pending.expiresAt)return;
    const confirmationId=pending.confirmationId;
    clear();attempted=true;started=true;
    status.textContent='Confirmation envoyée une seule fois au FIXE.';
    void run(BASE+'/confirm',{confirmationId,confirmed:true},'POST',data=>{
      started=false;
      if(data?.schemaVersion===1&&data.kind==='streamcockpit-prediction-end-confirmation'&&
          ['resolved','canceled'].includes(data.status)&&providerId.test(data.predictionId)){
        status.textContent='Fin Twitch '+data.status+' confirmée par FIXE. Réconciliation locale séparée requise avant une nouvelle prédiction.';
      }else{
        uncertain=true;
        status.textContent='Reçu invalide, résultat incertain : ne renvoyez aucune action.';
      }
    },()=>{
      started=false;uncertain=true;
      status.textContent='Résultat de fin Twitch incertain : vérifiez FIXE, aucun renvoi automatique.';
    });
  });
  const visibility=()=>invalidate('Vue suspendue : nouvelle vérification nécessaire.');
  const offline=()=>invalidate('Hors ligne : action Twitch désactivée.');
  const onlineChange=()=>invalidate('Connexion retrouvée : nouvelle inspection nécessaire.');
  doc.addEventListener('visibilitychange',visibility);
  view?.addEventListener('offline',offline);
  view?.addEventListener('online',onlineChange);
  status.textContent='FIXE indisponible.';draw();
  return{
    update(context={}){
      if(disposed)return;
      const source=typeof context.sourceKey==='string'?context.sourceKey:'';
      const account=typeof context.accountKey==='string'?context.accountKey:'';
      const available=context.online===true;
      if(sourceKey!==source||accountKey!==account||online!==available){
        sourceKey=source;accountKey=account;online=available;
        invalidate(available?'Inspection volontaire requise.':'FIXE indisponible.');
      }
      draw();
    },
    destroy(){
      if(disposed)return;
      invalidate('Vue fermée.');disposed=true;
      doc.removeEventListener('visibilitychange',visibility);
      view?.removeEventListener('offline',offline);
      view?.removeEventListener('online',onlineChange);
      panel.remove();
    },
  };
}
