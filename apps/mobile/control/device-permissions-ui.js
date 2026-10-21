import {DEVICE_PERMISSIONS,validateDevicePermissions} from '../shared/device-permissions.js';
export function createDevicePermissionsUI({request,modal,esc}) {
  let devices=[];
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
    modal(`<h2>Appareils autorisés sur cet appareil</h2><p>Les permissions sont vérifiées par l’exécuteur, pour chaque requête.</p>${devices.filter(d=>!d.revokedAt).map(d=>`<section><b>${esc(d.name)}</b><p class="small">${esc((d.permissions||Object.keys(DEVICE_PERMISSIONS)).map(p=>DEVICE_PERMISSIONS[p]).join(' · '))}</p><button class="secondary" data-task="device-permissions-edit" data-device-id="${esc(d.id)}">Modifier les permissions</button></section>`).join('')||'<p>Aucun appareil associé.</p>'}<button data-task="pairing">Créer un code d’association</button>`);
  }
  async function task(name,button) {
    if(name==='local-permissions'){await openList();return true;}
    if(name==='pairing'){modal(`<h2>Associer un appareil de confiance</h2><form id="device-permission-form">${fields(Object.keys(DEVICE_PERMISSIONS))}<p>Le code sera valable cinq minutes, pour un seul appareil.</p><button>Créer le code avec ces permissions</button></form>`);return true;}
    if(name==='device-permissions-edit'){
      const target=devices.find(d=>d.id===button.dataset.deviceId);if(!target)throw new Error('Actualisez la liste des appareils.');
      modal(`<h2>Permissions · ${esc(target.name)}</h2><form id="device-permission-form" data-device-id="${esc(target.id)}">${fields(target.permissions||Object.keys(DEVICE_PERMISSIONS))}<button>Appliquer les permissions</button></form>`);return true;
    }
    return false;
  }
  async function submit(form) {
    if(form.id!=='device-permission-form')return false;
    const permissions=validateDevicePermissions(new FormData(form).getAll('permission'));
    if(form.dataset.deviceId){
      const target=devices.find(d=>d.id===form.dataset.deviceId);if(!target)throw new Error('Appareil inconnu.');
      await request('/api/v1/remote/devices/'+encodeURIComponent(target.id)+'/permissions',{permissions,expectedPermissions:target.permissions||Object.keys(DEVICE_PERMISSIONS)},'PUT');await openList();
    }else{
      const result=await request('/api/v1/remote/pairing',{management:true,permissions},'POST');
      const origin=result.urls?.[0]?new URL(result.urls[0]).origin:'';
      const url=origin?origin+'/mobile/control/?pair='+encodeURIComponent(result.id)+'&code='+encodeURIComponent(result.code):'';
      modal(`<h2>Code d’association</h2><p>${esc(permissions.map(p=>DEVICE_PERMISSIONS[p]).join(' · '))}</p><label>Lien à coller sur l’autre appareil<textarea readonly>${esc(url)}</textarea></label><p>Code : <b>${esc(result.code)}</b></p><p class="small">Valable cinq minutes, une utilisation. Créez un code distinct pour chaque appareil.</p>`);
    }
    return true;
  }
  return {task,submit};
}
