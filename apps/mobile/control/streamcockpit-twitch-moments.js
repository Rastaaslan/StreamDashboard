import {rememberUncertainMoment,clearUncertainMoment,reconcileExpiredUncertainMoment,diagnoseUncertainMomentStore,describeUncertainMomentIssue,recoverUncertainMomentForReview,readUncertainMomentBackup,withExclusiveMomentJournal} from './streamcockpit-twitch-moment-pending.js';
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
  const inspect=doc.createElement('button');inspect.type='button';inspect.textContent='Consulter le journal FIXE sans renvoyer';inspect.hidden=true;
  const backup=doc.createElement('button');backup.type='button';backup.textContent='Exporter une copie locale du journal (confidentiel)';backup.hidden=true;
  const diagnostic=doc.createElement('button');diagnostic.type='button';diagnostic.textContent='Afficher le diagnostic expurgé du journal';diagnostic.hidden=true;
  const backupWarning=doc.createElement('p');backupWarning.hidden=true;backupWarning.textContent='Sauvegarde manuelle brute sur cet appareil uniquement. Attention : le journal endommagé peut contenir des informations sensibles. Ne partagez pas le fichier. Cette copie ne répare rien et n’autorise aucune nouvelle demande Twitch.';
  section.append(heading,note,form,review,status,link,inspect,verified,diagnostic,backupWarning,backup);root.append(section);
  let disposed=false,online=false,sourceKey='',accountKey='',revision=0,flight=false,sending=false,uncertain=false,storageBlocked=false,pending,uncertainReceipt,exportedSnapshot=null;
  const blockedText='Stockage des confirmations Twitch illisible ou inaccessible : aucune nouvelle demande autorisée. Conservez les données du navigateur et vérifiez les demandes dans Twitch et le journal FIXE avant toute réconciliation manuelle. Aucun renvoi automatique.';
  const connected=()=>!disposed&&root.isConnected&&online&&sourceKey&&view?.navigator?.onLine!==false&&doc.visibilityState!=='hidden';
  const cancel=()=>{pending=undefined;review.hidden=true;agree.checked=false};
  const draw=()=>{const enabled=connected()&&!flight&&!sending&&!uncertain&&!storageBlocked&&typeof request==='function';kind.disabled=description.disabled=preview.disabled=!enabled;agree.disabled=!enabled||!pending;publish.disabled=!enabled||!pending||!agree.checked||Date.now()>=pending.expiresAt;
    const expiredReview=storageBlocked&&Boolean(exportedSnapshot)&&describeUncertainMomentIssue(view,sourceKey,accountKey).code==='expired-unreviewed';
    verified.hidden=!uncertain||(storageBlocked&&!expiredReview);verified.disabled=!connected()||flight||sending;
    verified.textContent=expiredReview?'J’ai conservé la copie ET vérifié ce moment dans Twitch':'J’ai vérifié ce moment dans Twitch';
    inspect.hidden=!uncertain||!uncertainReceipt;inspect.disabled=!connected()||flight||sending||typeof request!=='function';
    backupWarning.hidden=backup.hidden=diagnostic.hidden=!storageBlocked||!connected();backup.disabled=diagnostic.disabled=backup.hidden||flight||sending};
  const invalidate=message=>{revision++;exportedSnapshot=null;if(sending)uncertain=true;flight=false;cancel();link.hidden=true;link.removeAttribute('href');status.textContent=uncertain?'Résultat incertain : vérifiez Twitch avant une nouvelle demande. Aucun renvoi automatique.':storageBlocked?blockedText:message;draw()};
  kind.addEventListener('change',()=>invalidate('Type modifié : nouvelle vérification requise.'));
  description.addEventListener('input',()=>{cancel();draw()});agree.addEventListener('change',draw);
  diagnostic.addEventListener('click',()=>{
    if(!connected()||!storageBlocked||sending||flight)return;
    // Fixed phrases only: never render the journal, UUIDs, account labels or thrown errors.
    const labels={
      'unavailable':'Stockage inaccessible.',
      'corrupt-json':'JSON illisible.',
      'too-large':'Journal trop volumineux pour validation.',
      'unknown-schema':'Schéma de journal inconnu.',
      'invalid-rows':'Lignes incohérentes ou ambiguës.',
      'expired-unreviewed':'Ancienne référence non réconciliée : conservez le journal et vérifiez sur Twitch avant une action.',
      'pending':'Référence en attente de vérification.',
      'clear':'Aucune référence courante identifiée.'
    };
    const code=describeUncertainMomentIssue(view,sourceKey,accountKey).code;
    status.textContent=blockedText+' Diagnostic local expurgé : '+(labels[code]||labels.unavailable)+' Aucun identifiant ni autre compte affiché.';
  });
  backup.addEventListener('click',()=>{
    if(!connected()||!storageBlocked||sending||flight||diagnoseUncertainMomentStore(view,sourceKey,accountKey).state!=='blocked')return;
    // Explicit user click only. Do not put raw data in DOM, console, URL, or a remote request.
    const raw=readUncertainMomentBackup(view);
    if(raw===null){status.textContent='Copie impossible (stockage indisponible ou taille supérieure à 1 Mio). Ne supprimez pas le journal ; réconciliation manuelle nécessaire.';return}
    let url;
    try{
      url=view.URL.createObjectURL(new view.Blob([raw],{type:'text/plain;charset=utf-8'}));
      const a=doc.createElement('a');a.download='streamcockpit-f04-journal-'+new Date().toISOString().slice(0,10).replace(/-/g,'')+'.txt';a.href=url;a.hidden=true;section.append(a);a.click();a.remove();
      view.setTimeout(()=>view.URL.revokeObjectURL(url),10_000);
      // A requested download is not proof that the OS actually saved the file.
      // The operator must inspect the local copy AND verify Twitch before using
      // the explicitly worded, one-receipt manual reconciliation action.
      exportedSnapshot=describeUncertainMomentIssue(view,sourceKey,accountKey).code==='expired-unreviewed'?raw:null;
      status.textContent=exportedSnapshot?'Copie locale demandée : vérifiez qu’elle est bien enregistrée sur disque, puis vérifiez ce moment dans Twitch avant toute confirmation manuelle. Aucun renvoi automatique.':'Copie locale demandée. Fichier confidentiel : ne pas partager. Journal d’origine inchangé et commandes Twitch toujours bloquées.';
      draw();
    }catch{if(url)view.URL.revokeObjectURL(url);status.textContent='Export local impossible. Journal d’origine inchangé, commandes Twitch toujours bloquées.'}
  });
  verified.addEventListener('click',async()=>{
    if(sending||flight||!uncertain||!uncertainReceipt)return;
    const receipt=uncertainReceipt,target=sourceKey,account=accountKey,snapshot=exportedSnapshot,key=++revision;
    flight=true;draw();
    const cleared=await withExclusiveMomentJournal(view,()=>
      key===revision&&connected()&&target===sourceKey&&account===accountKey&&
      (storageBlocked?
        snapshot&&describeUncertainMomentIssue(view,target,account).code==='expired-unreviewed'&&
          reconcileExpiredUncertainMoment(view,target,account,receipt,snapshot):
        clearUncertainMoment(view,target,account,receipt)));
    if(key!==revision)return;
    flight=false;
    if(!cleared){exportedSnapshot=null;status.textContent='Référence locale non effacée : journal modifié, copie non confirmée ou verrou indisponible. Aucune nouvelle demande autorisée.';draw();return}
    uncertain=false;uncertainReceipt=undefined;
    storageBlocked=diagnoseUncertainMomentStore(view,target,account).state==='blocked';
    invalidate('Vérification externe confirmée. Une nouvelle prévisualisation est requise.');
    if(storageBlocked)status.textContent=blockedText+' D’autres références restent non réconciliées.';
    draw();
  });
  inspect.addEventListener('click',async()=>{
    if(!connected()||flight||sending||!uncertain||!uncertainReceipt||typeof request!=='function')return;
    const receipt=uncertainReceipt,target=sourceKey,account=accountKey,key=++revision;flight=true;draw();
    try{
      const r=await request('/api/v1/twitch/advanced/moment/status/'+receipt.id,undefined,'GET',target);
      if(!connected()||key!==revision||target!==sourceKey||account!==accountKey)return;
      if(r?.schemaVersion!==1||r.kind!=='streamcockpit-moment-status'||r.retryable!==false)throw Error('UNVERIFIED');
      if(r.status==='journal_observed'&&r.momentKind===receipt.kind){
        status.textContent=r.momentKind==='clip'?'Le journal FIXE retrouve la demande de clip ; sa vidéo reste à vérifier sur Twitch. Aucun renvoi.':'Le journal FIXE retrouve le marqueur Twitch. Aucun renvoi.';
      }else if(r.status==='not_found_at_read'){
        status.textContent='Aucune entrée trouvée à cet instant dans le journal FIXE. Le résultat Twitch reste incertain ; aucun renvoi.';
      }else throw Error('UNVERIFIED');
      if(storageBlocked)status.textContent+=' Stockage local toujours bloqué : aucune nouvelle demande autorisée.';
    }catch{if(key===revision&&connected())status.textContent='Journal FIXE indisponible ou non confirmé. Résultat incertain, aucun renvoi.'+(storageBlocked?' Stockage local toujours bloqué.':'')}
    finally{if(key===revision){flight=false;draw()}}
  });
  form.addEventListener('submit',async e=>{
    e.preventDefault();if(!connected()||flight||sending||uncertain||typeof request!=='function')return;
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
    if(!connected()||flight||sending||uncertain||!pending||!agree.checked||Date.now()>=pending.expiresAt)return;
    const id=pending.confirmationId,expected=pending.draft.kind,target=sourceKey,account=accountKey,key=++revision;
    cancel();flight=true;draw();
    // Claim the same-origin native lock BEFORE touching the shared journal or POSTing.
    // Contention, missing Web Locks and outdated previews fail closed, without retry.
    const stored=await withExclusiveMomentJournal(view,()=>
      connected()&&key===revision&&target===sourceKey&&account===accountKey&&
      !uncertain&&!storageBlocked&&rememberUncertainMoment(view,target,account,{id,kind:expected}));
    if(key!==revision)return;
    if(!stored){
      flight=false;
      if(diagnoseUncertainMomentStore(view,target,account).state==='blocked')storageBlocked=true;
      status.textContent=storageBlocked?blockedText:'Sauvegarde locale de la demande impossible (verrou ou référence existante) : aucun moment envoyé sur Twitch.';draw();return;
    }
    uncertainReceipt={id,kind:expected};sending=true;draw();
    try{
      const r=await request('/api/v1/twitch/advanced/moment/confirm',{confirmationId:id,confirmed:true},'POST',target);
      if(!connected()||key!==revision||target!==sourceKey||account!==accountKey){if(key===revision)uncertain=true;return}
      if(r?.schemaVersion!==1||r.kind!=='streamcockpit-moment-confirmation'||r.momentKind!==expected||r.status!==(expected==='marker'?'confirmed':'accepted'))throw Error('UNVERIFIED');
      status.textContent=r.status==='confirmed'?'Marqueur confirmé par Twitch.':'Demande de clip acceptée par Twitch ; disponibilité de la vidéo à vérifier.';
      status.textContent+=r.journal==='recorded'?' Ajouté à la timeline.':r.journal==='uncertain'?' Écriture timeline incertaine : vérifiez le journal, sans recréer le moment.':' Aucune session liée pour la timeline.';
      if(expected==='clip'){
        if(typeof r.id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(r.id)||typeof r.editUrl!=='string')throw Error('UNVERIFIED');
        const url=new URL(r.editUrl);
        if(url.protocol!=='https:'||url.hostname!=='clips.twitch.tv'||url.username||url.password||
          url.port||url.search||url.hash||url.pathname!==`/${r.id}/edit`)throw Error('UNVERIFIED');
        link.href=url.href;link.hidden=false;
      }else if(r.editUrl!==undefined)throw Error('UNVERIFIED');
      const cleared=await withExclusiveMomentJournal(view,()=>
        key===revision&&target===sourceKey&&account===accountKey&&
        clearUncertainMoment(view,target,account,{id,kind:expected}));
      if(key!==revision||target!==sourceKey||account!==accountKey)return;
      if(cleared)uncertainReceipt=undefined;
      else {uncertain=true;status.textContent+=' Référence locale toujours présente (verrou ou journal indisponible) : vérifier dans Twitch avant une nouvelle demande.'}
    }catch{if(key===revision&&target===sourceKey&&account===accountKey){uncertain=true;status.textContent='Résultat incertain : vérifiez Twitch avant une nouvelle demande. Aucun renvoi automatique.'}}
    finally{sending=false;if(key===revision)flight=false;draw()}
  });
  // Other windows share localStorage, not this in-memory preview. Never present a
  // stale "ready" preview after another window has recorded an uncertain Twitch POST.
  const onJournalChange=event=>{
    if(disposed||(event.key!==null&&event.key!=='sd3.f04.twitch-moment-uncertain.v1')||
      event.storageArea!==view?.localStorage||!sourceKey||!accountKey)return;
    const diagnosis=diagnoseUncertainMomentStore(view,sourceKey,accountKey);
    const newReceipt=diagnosis.state==='pending'?diagnosis.receipt:diagnosis.state==='blocked'?recoverUncertainMomentForReview(view,sourceKey,accountKey):undefined;
    // Even if another tab wrote and cleared a receipt before delivery of this
    // event, its side effect can make an already consented preview obsolete.
    // A same-state storage event must therefore invalidate active UI work.
    if(!pending&&!flight&&!sending&&(diagnosis.state==='blocked')===storageBlocked&&Boolean(newReceipt)===uncertain&&
      (!newReceipt||(newReceipt.id===uncertainReceipt?.id&&newReceipt.kind===uncertainReceipt?.kind)))return;
    const wasSending=sending;
    invalidate('Journal Twitch modifié dans une autre fenêtre : nouvelle prévisualisation requise.');
    if(wasSending){
      // A pending provider POST may have succeeded despite a concurrent storage
      // modification. Keep this view blocked, even if its old hint disappeared.
      uncertain=true;
      status.textContent='Résultat incertain : journal modifié pendant la demande. Vérifiez Twitch et le journal FIXE, sans renvoi.';
    }else{
      storageBlocked=diagnosis.state==='blocked';
      uncertainReceipt=newReceipt;
      uncertain=Boolean(newReceipt);
      status.textContent=storageBlocked?blockedText+(uncertainReceipt?' Une référence de ce compte est récupérable en lecture seule pour consulter le journal FIXE, sans réparation.':''):uncertain?
        'Résultat incertain enregistré dans une autre fenêtre : vérifier Twitch ou le journal FIXE. Aucun renvoi automatique.':
        'Journal Twitch actualisé depuis une autre fenêtre : nouvelle vérification requise.';
    }
    draw();
  };
  const pause=()=>invalidate('Connexion ou vue interrompue : confirmation invalidée.');
  view?.addEventListener('offline',pause);view?.addEventListener('online',pause);view?.addEventListener('storage',onJournalChange);doc.addEventListener('visibilitychange',pause);
  status.textContent='Source non associée.';draw();
  return {update(c={}){if(disposed)return;const next=c.online===true,key=typeof c.sourceKey==='string'?c.sourceKey:'',account=typeof c.accountKey==='string'?c.accountKey:'';
    const identityChanged=key!==sourceKey||account!==accountKey,changed=next!==online||identityChanged;
    online=next;sourceKey=key;accountKey=account;
    if(changed){invalidate(online?'Prêt à vérifier un moment.':'Source déconnectée.');
      if(identityChanged){const diagnosis=diagnoseUncertainMomentStore(view,key,account);
        storageBlocked=diagnosis.state==='blocked';uncertainReceipt=diagnosis.state==='pending'?diagnosis.receipt:storageBlocked?recoverUncertainMomentForReview(view,key,account):undefined;uncertain=Boolean(uncertainReceipt);
        if(storageBlocked)status.textContent=blockedText+(uncertainReceipt?' Une référence de ce compte reste consultable dans le journal FIXE en lecture seule ; stockage non réparé.':'');
        else if(uncertain)status.textContent='Résultat incertain conservé après rechargement : consulter le journal FIXE ou vérifier dans Twitch. Aucun renvoi automatique.';
        else status.textContent=online?'Prêt à vérifier un moment.':'Source déconnectée.';
        draw();}
    }else draw()},
    destroy(){disposed=true;invalidate('Vue fermée.');view?.removeEventListener('offline',pause);view?.removeEventListener('online',pause);view?.removeEventListener('storage',onJournalChange);doc.removeEventListener('visibilitychange',pause);section.remove()}};
}
