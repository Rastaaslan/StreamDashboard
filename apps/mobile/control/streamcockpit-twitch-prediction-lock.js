/** F08 LOCK: paired FIXE only. No local OBS/Twitch authority or automatic PATCH retry. */
const BASE = '/api/v1/twitch/advanced/prediction/lock';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function mountTwitchPredictionLock(root, {request} = {}) {
  const doc=root.ownerDocument, view=doc.defaultView;
  const panel=doc.createElement('section');
  panel.className='cockpit-twitch-prediction-lock panel';
  panel.setAttribute('aria-label','Verrouiller une prédiction Twitch');
  const heading=doc.createElement('h3');heading.textContent='Verrouiller les paris Twitch';
  const info=doc.createElement('p');
  info.className='small muted';
  info.textContent='Ferme les paris sur la prédiction exacte conservée par FIXE. Prévisualisation et confirmation distinctes. Aucun réessai automatique.';
  const prepare=doc.createElement('button');prepare.type='button';
  prepare.textContent='Vérifier la prédiction à verrouiller';
  const approval=doc.createElement('div');approval.hidden=true;
  const description=doc.createElement('p');
  description.textContent='Twitch confirme une prédiction active. Le verrouillage sera public.';
  const label=doc.createElement('label');
  const checkbox=doc.createElement('input');checkbox.type='checkbox';
  const consent=doc.createElement('span');
  consent.textContent='Je confirme vouloir fermer les paris sur Twitch maintenant.';
  label.append(checkbox,consent);
  const confirm=doc.createElement('button');confirm.type='button';
  confirm.textContent='Confirmer le verrouillage Twitch';
  approval.append(description,label,confirm);
  const status=doc.createElement('p');status.setAttribute('role','status');status.className='small';
  panel.append(heading,info,prepare,approval,status);
  root.append(panel);

  let disposed=false,sourceKey='',accountKey='',online=false,revision=0;
  let busy=false,started=false,blocked=false,pending,uncertain=false;
  const connected=()=>!disposed && root.isConnected && online && !!sourceKey &&
    view?.navigator?.onLine!==false && doc.visibilityState!=='hidden';
  const clear=()=>{pending=undefined;approval.hidden=true;checkbox.checked=false;};
  const draw=()=>{
    const available=connected() && !busy && !blocked && typeof request==='function';
    prepare.disabled=!available;
    checkbox.disabled=!available || !pending;
    confirm.disabled=!available || !pending || !checkbox.checked || Date.now()>=pending.expiresAt;
  };
  const invalidate=reason=>{
    revision++;
    if(started){blocked=true;uncertain=true;}
    started=false;busy=false;clear();
    status.textContent=uncertain
      ? 'Verrouillage Twitch potentiellement effectué. Ne renvoyez rien ; inspectez la prédiction exacte depuis FIXE.'
      : blocked ? 'Verrouillage déjà tenté. Une nouvelle tentative est interdite sans réconciliation qualifiée.' : reason;
    draw();
  };
  const run=async(path,body,onDone,onError)=>{
    if(!connected()||busy)return;
    const host=sourceKey,account=accountKey,seq=++revision;
    busy=true;draw();
    try {
      const data=await request(path,body,'POST',host);
      if(seq===revision && connected() && sourceKey===host && accountKey===account) onDone(data);
    } catch {
      if(seq===revision && connected() && sourceKey===host && accountKey===account) onError();
    } finally {
      if(!disposed && seq===revision){
        if(started){
          started=false;blocked=true;uncertain=true;
          status.textContent='Accusé Twitch perdu après tentative. Résultat incertain, aucun renvoi automatique.';
        }
        busy=false;draw();
      }
    }
  };
  prepare.addEventListener('click',()=>{
    if(!connected()||busy||blocked)return;
    clear();
    status.textContent='Observation exacte Twitch depuis FIXE ; aucune mutation…';
    void run(BASE+'/preview',{},data=>{
      if(data?.schemaVersion!==1 || data.kind!=='streamcockpit-prediction-lock-preview' ||
          !UUID.test(data.confirmationId) || data.providerStatus!=='active' ||
          !Number.isFinite(data.expiresAt) || data.expiresAt<=Date.now() ||
          data.expiresAt>Date.now()+45_000) {
        status.textContent='Prévisualisation invalide. Aucun verrouillage demandé.';return;
      }
      pending={id:data.confirmationId,expiresAt:data.expiresAt};
      approval.hidden=false;
      status.textContent='Prédiction active confirmée. Une confirmation distincte est nécessaire.';
    },()=>{status.textContent='Prédiction active non confirmée ou FIXE indisponible. Aucune modification envoyée.';});
  });
  checkbox.addEventListener('change',draw);
  confirm.addEventListener('click',()=>{
    if(!connected()||busy||blocked||!pending||!checkbox.checked||
        Date.now()>=pending.expiresAt)return;
    const confirmationId=pending.id;
    clear();blocked=true;started=true;
    status.textContent='Une confirmation envoyée au FIXE. Aucun renvoi automatique.';
    void run(BASE+'/confirm',{confirmationId,confirmed:true},data=>{
      started=false;
      if(data?.schemaVersion===1 && data.kind==='streamcockpit-prediction-lock-confirmation' &&
          data.status==='locked' && /^[A-Za-z0-9-]{1,128}$/.test(data.predictionId)){
        status.textContent='Verrouillage accepté par Twitch. Vérifiez son état ; aucune seconde tentative.';
      } else {
        uncertain=true;
        status.textContent='Reçu de verrouillage non vérifiable : résultat incertain, aucune seconde tentative.';
      }
    },()=>{
      started=false;uncertain=true;
      status.textContent='Résultat du verrouillage incertain. Vérifiez Twitch ; aucun renvoi automatique.';
    });
  });
  const visibility=()=>invalidate('Vue suspendue ; consentement annulé.');
  const offline=()=>invalidate('Hors ligne : aucune action Twitch.');
  const onlineChange=()=>invalidate('Connexion retrouvée : nouvelle vérification nécessaire.');
  doc.addEventListener('visibilitychange',visibility);
  view?.addEventListener('offline',offline);view?.addEventListener('online',onlineChange);
  status.textContent='FIXE indisponible.';draw();
  return {
    update(context={}){
      if(disposed)return;
      const source=typeof context.sourceKey==='string'?context.sourceKey:'';
      const account=typeof context.accountKey==='string'?context.accountKey:'';
      const available=context.online===true;
      if(source!==sourceKey||account!==accountKey||available!==online){
        sourceKey=source;accountKey=account;online=available;
        invalidate(available?'Vérification volontaire de la prédiction requise.':'Source indisponible.');
      }
      draw();
    },
    destroy(){
      if(disposed)return;
      invalidate('Vue fermée.');disposed=true;
      doc.removeEventListener('visibilitychange',visibility);
      view?.removeEventListener('offline',offline);view?.removeEventListener('online',onlineChange);
      panel.remove();
    },
  };
}
