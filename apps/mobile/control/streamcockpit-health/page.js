import {mountStreamCockpitHealth} from './index.js';

/** GET only, no offline cache or fallback to the local Android runtime. */
export function mountHealthPage(root,{online,request}) {
  const panel=mountStreamCockpitHealth(root);
  const detail=root.ownerDocument.createElement('p');
  detail.setAttribute('role','status');
  detail.textContent=online?'Lecture des observations du fixe…':'Hors ligne — régie indisponible. États UNKNOWN.';
  root.append(detail);
  let disposed=false;
  const started=performance.now();
  if(online) Promise.resolve().then(()=>request('/api/v1/streamcockpit-health')).then(report=>{
    if(disposed)return;
    const elapsed=Math.max(0,performance.now()-started);
    if(elapsed>=15000){panel.unavailable();detail.textContent='Lecture trop ancienne — états UNKNOWN.';return;}
    panel.update({...report,diagnostics:report?.diagnostics?.map(d=>({...d,ageMs:Number.isFinite(d.ageMs)?d.ageMs+elapsed:d.ageMs}))});
    detail.textContent='Lecture seule. Twitch indique la disponibilité de la lecture API, pas un live public. Les sources sans horodatage attesté restent inconnues.';
  }).catch(()=>{
    if(disposed)return;
    panel.unavailable();
    detail.textContent='Centre de santé indisponible : connexion, autorisation ou lecture hôte en échec. États UNKNOWN.';
  });
  return {unavailable(){disposed=true;panel.unavailable();detail.textContent='Hors ligne — régie indisponible. États UNKNOWN.';},destroy(){disposed=true;panel.destroy();detail.remove();}};
}
