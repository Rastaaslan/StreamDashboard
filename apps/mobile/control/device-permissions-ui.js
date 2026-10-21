import {DEVICE_PERMISSIONS,validateDevicePermissions} from '../shared/device-permissions.js';
export function createDevicePermissionsUI({request,modal,esc,nativeExecutor=false}) {
  let devices=[];
  let identity;
  const desktop=globalThis.streamDashboardDesktop;
  const fields=permissions=>`<fieldset><legend>Autorisations de cet appareil</legend>${Object.entries(DEVICE_PERMISSIONS).map(([key,label])=>`<label class="check"><input type="checkbox" name="permission" value="${key}" ${permissions.includes(key)?'checked':''}> ${esc(label)}</label>`).join('')}</fieldset>`;
  document.addEventListener('change',event=>{
    const input=event.target;
    if(!input.matches?.('#device-permission-form [name="permission"]'))return;
    const form=input.form;
    if(input.value==='configuration'&&input.checked)form.querySelectorAll('[name="permission"]').forEach(item=>{item.checked=true;});
    else if(!input.checked)form.querySelector('[value="configuration"]').checked=false;
  });
  async function openList() {
    devices=await request('/api/v1/remote/devices');
    modal(`<h2>Appareils autorisés sur cet appareil</h2><p>Les permissions sont vérifiées par l’exécuteur, pour chaque requête.</p>${devices.filter(d=>!d.revokedAt).map(d=>`<section><b>${esc(d.name)}</b><p class="small">${esc((d.permissions||Object.keys(DEVICE_PERMISSIONS)).map(p=>DEVICE_PERMISSIONS[p]).join(' · '))}</p><button class="secondary" data-task="device-permissions-edit" data-device-id="${esc(d.id)}">Modifier les permissions</button><button class="secondary" data-task="device-revoke" data-device-id="${esc(d.id)}">Révoquer cet appareil</button></section>`).join('')||'<p>Aucun appareil associé.</p>'}<button data-task="pairing">Créer un code d’association</button>`);
  }
  async function task(name,button) {
    if(name==='transport'){
      const info=await request('/api/v1/remote/info');
      identity=await desktop?.getAgentIdentity?.();
      const state=await request('/api/v2/state');
      modal(`<h2>Connexion sécurisée de cet agent</h2><p>${esc(info.error||(info.enabled?'Partage HTTPS actif.':'Partage réseau désactivé.'))}</p><p class="small">${esc(info.urls.join(' · '))}</p>${info.discoveryError?`<p>${esc(info.discoveryError)}</p>`:''}<label>Empreinte SHA-256<textarea readonly>${esc(identity?.fingerprint||info.fingerprint||'Identité créée lors de l’activation')}</textarea></label>${identity?.expires?`<p>Expiration : ${esc(new Date(identity.expires).toLocaleString())}</p>`:''}<form id="remote-sharing-form" data-revision="${esc(state.host.settingsRevision)}"><label class="check"><input type="checkbox" name="enabled" ${info.configured?'checked':''}> Autoriser les appareils associés à se connecter</label><p class="small">${nativeExecutor?'Gardez l’application Android ouverte pour recevoir les commandes. Le partage s’arrête à sa fermeture.':'Un redémarrage de l’agent est nécessaire après ce changement.'} Le partage annonce aussi le nom et le type de cet appareil aux recherches sur le réseau local. Les comptes locaux restent autonomes.</p><button>Enregistrer le partage réseau</button></form>${desktop?.renewAgentIdentity?'<details><summary>Renouveler l’identité de cet agent</summary><p>Les appareils associés devront vérifier la nouvelle empreinte. Le redémarrage est refusé pendant une diffusion ou une opération incompatible.</p><button class="secondary" data-task="renew-identity">Renouveler puis redémarrer</button></details>':''}`);return true;
    }
    if(name==='renew-identity'){
      if(!identity||!desktop?.renewAgentIdentity)throw new Error('Actualisez les informations de cet agent.');
      await desktop.renewAgentIdentity(identity.fingerprint);return true;
    }
    if(name==='local-permissions'){await openList();return true;}
    if(name==='pairing'){modal(`<h2>Associer un appareil de confiance</h2><form id="device-permission-form">${fields(Object.keys(DEVICE_PERMISSIONS))}<p>Le code sera valable cinq minutes, pour un seul appareil.</p><button>Créer le code avec ces permissions</button></form>`);return true;}
    if(name==='device-revoke'){
      const target=devices.find(d=>d.id===button.dataset.deviceId);if(!target)throw new Error('Actualisez la liste des appareils.');
      modal(`<h2>Révoquer ${esc(target.name)} ?</h2><p>Cet appareil devra être associé de nouveau pour envoyer des commandes.</p><button data-task="device-revoke-confirm" data-device-id="${esc(target.id)}">Révoquer l’accès</button><button class="secondary" data-task="local-permissions">Annuler</button>`);return true;
    }
    if(name==='device-revoke-confirm'){
      const target=devices.find(d=>d.id===button.dataset.deviceId);if(!target)throw new Error('Actualisez la liste des appareils.');
      await request('/api/v1/remote/devices/'+encodeURIComponent(target.id),undefined,'DELETE');await openList();return true;
    }
    if(name==='device-permissions-edit'){
      const target=devices.find(d=>d.id===button.dataset.deviceId);if(!target)throw new Error('Actualisez la liste des appareils.');
      modal(`<h2>Permissions · ${esc(target.name)}</h2><form id="device-permission-form" data-device-id="${esc(target.id)}">${fields(target.permissions||Object.keys(DEVICE_PERMISSIONS))}<button>Appliquer les permissions</button></form>`);return true;
    }
    return false;
  }
  async function submit(form) {
    if(form.id==='remote-sharing-form'){await request('/api/v2/settings',{expectedRevision:form.dataset.revision,remoteEnabled:form.elements.enabled.checked},'PUT');await task('transport');return true;}
    if(form.id!=='device-permission-form')return false;
    const permissions=validateDevicePermissions(new FormData(form).getAll('permission'));
    if(form.dataset.deviceId){
      const target=devices.find(d=>d.id===form.dataset.deviceId);if(!target)throw new Error('Appareil inconnu.');
      await request('/api/v1/remote/devices/'+encodeURIComponent(target.id)+'/permissions',{permissions,expectedPermissions:target.permissions||Object.keys(DEVICE_PERMISSIONS)},'PUT');await openList();
    }else{
      const result=await request('/api/v1/remote/pairing',{management:true,permissions},'POST');
      const origin=result.urls?.[0]?new URL(result.urls[0]).origin:'';
      const url=origin?origin+'/mobile/control/?pair='+encodeURIComponent(result.id)+'&code='+encodeURIComponent(result.code)+(result.fingerprint?'&fingerprint='+encodeURIComponent(result.fingerprint):''):'';
      modal(`<h2>Code d’association</h2><p>${esc(permissions.map(p=>DEVICE_PERMISSIONS[p]).join(' · '))}</p><label>Lien à coller sur l’autre appareil<textarea readonly>${esc(url)}</textarea></label><p class="small">Empreinte SHA-256 : ${esc(result.fingerprint||'Transport chiffré indisponible')}</p><p>Code : <b>${esc(result.code)}</b></p><p class="small">Valable cinq minutes, une utilisation. Créez un code distinct pour chaque appareil.</p>`);
    }
    return true;
  }
  return {task,submit};
}
