import { SETUPS, ROLES, associateInstallationDevice, migrateInstallation, createInstallationStore, planInstallationChange } from '../shared/installation.js';
import { randomUuid } from '../shared/planning-engine.js';

export async function createInstallationUI({ device, native, localEndpoint = '', desktop = globalThis.streamDashboardDesktop, storage = localStorage, modal, esc, changed, select, remove, viewers }) {
  let id = storage.getItem('sd2.installation.device-id');
  if (!id) { id = randomUuid(); storage.setItem('sd2.installation.device-id', id); }
  const platform = native ? 'android' : desktop ? 'windows' : 'browser';
  const local = createInstallationStore(storage, () => migrateInstallation({ id, platform, legacy: device, pairedEndpoint: storage.getItem('sd2.server') || '' }));
  let current = desktop?.getInstallation ? await desktop.getInstallation() : local.read();
  let pending;
  const reload = async () => { current = desktop?.getInstallation ? await desktop.getInstallation() : local.read(); return current; };
  const own = () => current.devices.find(d => d.id === current.localDeviceId);
  const apply = async changes => {
    const plan=desktop?.changeInstallation?await desktop.changeInstallation(changes,current.revision):await local.change(changes,current.revision);
    current=plan.next;return plan;
  };
  function open() {
    pending = undefined;
    const device = own();
    modal(`<h2>Mon installation</h2><p>Une application commune. Les rôles indiquent ce que cet appareil exécute.</p><form id="installation-form" data-revision="${current.revision}">
      <label>Installation<select name="preset">${Object.entries(SETUPS).map(([id,label])=>`<option value="${id}" ${id===current.preset?'selected':''}>${esc(label)}</option>`).join('')}</select></label>
      <label>Nom de cet appareil<input name="name" value="${esc(device.name)}" required maxlength="80"></label>
      <fieldset><legend>Responsabilités sur cet appareil</legend>${Object.entries(ROLES).map(([id,label])=>`<label class="check"><input type="checkbox" name="role-${id}" ${device.roles.includes(id)?'checked':''} ${id==='obs-executor'&&!device.capabilities.includes('obs')?'disabled':''}> ${esc(label)}</label>`).join('')}</fieldset>
      ${desktop?`<label class="check"><input type="checkbox" name="background" ${current.background?'checked':''}> Garder l’agent et les macros actifs lorsque la fenêtre est fermée</label><label class="check"><input type="checkbox" name="startAtLogin" ${current.startAtLogin?'checked':''}> Démarrer l’agent sans fenêtre à l’ouverture de ma session Windows</label>`:''}
      <p class="small muted">OBS et ses clips nécessitent un ordinateur associé. Les comptes, chats, sons locaux et plannings restent propres à chaque appareil.</p>
      <button>Prévisualiser le changement</button></form>
      <h3>Appareils connus</h3>${current.devices.map(d=>`<section><p><b>${esc(d.name)}</b> · ${esc(d.platform)} · ${d.enabled?'actif dans la configuration':'retiré'}<br><small>${esc(d.roles.map(r=>ROLES[r]).join(', '))}${d.endpoint?' · '+esc(d.endpoint):''}</small></p>${d.id===current.localDeviceId&&localEndpoint?`<button type="button" class="secondary" data-task="installation-select" data-device-id="${esc(d.id)}">Ouvrir cet appareil</button>`:''}${d.endpoint&&d.platform==='android'&&d.enabled&&viewers?`<button type="button" class="secondary" data-task="installation-viewers" data-device-id="${esc(d.id)}">Ouvrir ses écrans</button>`:''}${d.endpoint?`<button type="button" class="secondary" data-task="installation-select" data-device-id="${esc(d.id)}" ${!d.enabled?'disabled':''}>Ouvrir cet appareil</button><button type="button" class="secondary" data-task="installation-toggle" data-device-id="${esc(d.id)}">${d.enabled?'Retirer':'Réactiver'}</button>`:''}</section>`).join('')}
      <button type="button" class="secondary" data-task="connection">Associer un autre appareil</button>
      <p class="small muted">La liste décrit la configuration ; elle ne certifie pas qu’un appareil est actuellement connecté.</p>
      <button type="button" class="secondary" data-task="installation-restore">Restaurer la configuration précédente</button>`);
  }
  function setupChanged(event) {
    if(event.target?.matches?.('#installation-form [name="preset"]') && own().platform==='windows' && ['single-pc','single-pc-deck'].includes(event.target.value)) {
      event.target.form.elements['role-obs-executor'].checked=true;
    }
  }
  document.addEventListener('change',setupChanged);
  async function submit(form) {
    if (form.id !== 'installation-form') return false;
    const values = Object.fromEntries(new FormData(form));
    const changes = { name:values.name, preset:values.preset, roles:Object.keys(ROLES).filter(r=>values['role-'+r]), background:desktop?Boolean(values.background):false, startAtLogin:desktop?Boolean(values.startAtLogin):false };
    pending = { changes, revision:Number(form.dataset.revision) };
    const plan = planInstallationChange(current,changes,pending.revision);
    modal(`<h2>Vérifier le changement</h2><ul>${plan.summary.map(line=>`<li>${esc(line)}</li>`).join('')}</ul><p>Une sauvegarde de l’installation actuelle sera conservée.</p><button data-task="installation-apply">Appliquer</button><button class="secondary" data-task="device-setup">Revenir aux réglages</button>`);
    return true;
  }
  async function task(name,button) {
    if(name==='installation-viewers'){await reload();const target=current.devices.find(d=>d.id===button?.dataset.deviceId);if(!target?.enabled||target.platform!=='android'||!target.endpoint||!viewers)throw new Error('Android associé indisponible.');await viewers(target);return true;}
    if (['installation-select','installation-toggle'].includes(name)) {
      await reload();
      const target=current.devices.find(d=>d.id===button?.dataset.deviceId);
      if(!target || (target.id===current.localDeviceId?(!localEndpoint||name!=='installation-select'):!target.endpoint))throw new Error('Appareil inconnu.');
      if(name==='installation-select') {
        if(!target.enabled)throw new Error('Réactivez cet appareil avant de le sélectionner.');
        await select(target,()=>apply(target.roles.includes('obs-executor')?{routes:{...current.routes,obs:target.id,...(target.capabilities.includes('clips')?{clips:target.id}:{})}}:{}));
      } else {
        if(target.enabled)await remove?.(target);
        await apply({device:{...target,enabled:!target.enabled}});open();
      }
      return true;
    }
    if (name === 'device-setup') { await reload();open();return true; }
    if (name === 'installation-apply') {
      if (!pending) throw new Error('Prévisualisez le changement avant de l’appliquer.');
      const operation = pending;pending = undefined;
      const plan = desktop?.changeInstallation ? await desktop.changeInstallation(operation.changes,operation.revision) : await local.change(operation.changes,operation.revision);
      current = plan.next; await changed(current,plan.restart); return true;
    }
    if (name === 'installation-restore') {
      if (!confirm('Restaurer les rôles et destinations précédents ? Vos contenus et comptes seront conservés.')) return true;
      const result = desktop?.restoreInstallation ? await desktop.restoreInstallation(current.revision) : { next:await local.restore(current.revision),restart:false };
      current = result.next;await changed(current,result.restart);return true;
    }
    return false;
  }
  async function remember(endpoint,descriptor) {
    await reload();
    await apply(associateInstallationDevice(current,endpoint,descriptor));
  }
  // Import the old Windows association once; its origin-bound credential stays
  // in the encrypted store and the old address remains available for rollback.
  const pairedEndpoint=storage.getItem('sd2.server');
  if(desktop?.changeInstallation&&current.revision===0&&pairedEndpoint&&pairedEndpoint!==localEndpoint&&!current.devices.some(d=>d.endpoint===pairedEndpoint))await remember(pairedEndpoint);
  return { open, submit, task, remember, apply, reload, get current(){return current;} };
}
