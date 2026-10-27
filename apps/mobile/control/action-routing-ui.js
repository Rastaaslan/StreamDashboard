export function createActionRoutingUI({ installationUI, router, workspace, actions, localEndpoint, modal, esc, changed }) {
  let draft;
  function open(id) {
    const action = actions().find(a => a.id === id);
    if (!action) throw new Error('Bouton introuvable.');
    const current = installationUI.current, bound = router.binding(action);
    draft = {actionId:id,workspace:workspace(),revision:current.revision};
    modal(`<h2>Destination · ${esc(action.label)}</h2><p>Le déclencheur reste ici. Choisissez le bouton réellement exécuté sur l’appareil cible.</p><form id="action-route-device"><label>Appareil<select name="deviceId">${current.devices.filter(d => d.enabled && (d.endpoint || (d.id === current.localDeviceId && localEndpoint))).map(d => `<option value="${esc(d.id)}" ${bound?.deviceId===d.id?'selected':''}>${esc(d.name)}</option>`).join('')}</select></label><button>Lire les boutons de cet appareil</button></form><p class="small muted">L’association est conservée si cet appareil est déconnecté. Aucune commande ne sera transférée automatiquement à un autre appareil.</p><button class="secondary" data-task="action-route-clear">Utiliser l’exécution de cet espace</button>`);
  }
  const assertDraft = value => {
    if (draft !== value || value.workspace !== workspace() || value.revision !== installationUI.current.revision) throw new Error('Installation ou espace modifié. Rouvrez la destination du bouton.');
  };
  async function save(definition, deviceId) {
    const value = draft;assertDraft(value);
    const current = installationUI.current;
    const routes = (current.actionRoutes || []).filter(r => r.workspace !== value.workspace || r.actionId !== value.actionId);
    if (definition) routes.push({workspace:value.workspace,actionId:value.actionId,deviceId,definition});
    await installationUI.apply({actionRoutes:routes});draft=undefined;await changed();
  }
  async function submit(form) {
    if (!['action-route-device','action-route-bind'].includes(form.id)) return false;
    const value = draft;assertDraft(value);
    if (form.id === 'action-route-device') {
      const id = form.elements.deviceId.value, target = await router.observe(id,true);assertDraft(value);
      value.deviceId=id;value.actions=target.data.configuration.actions;
      const name=installationUI.current.devices.find(d=>d.id===id).name;
      modal(`<h2>Bouton exécuté sur ${esc(name)}</h2><form id="action-route-bind"><label>Commande<select name="actionId">${value.actions.map(a=>`<option value="${esc(a.id)}">${esc(a.label)} · ${esc(a.type)} · ${esc(a.value)}</option>`).join('')}</select></label><p>Le prochain appui sur ce bouton ou sa macro utilisera cette destination. Une définition modifiée devra être vérifiée à nouveau.</p><button>Enregistrer cette destination</button></form>`);
    } else {
      const definition = value.actions?.find(a=>a.id===form.elements.actionId.value);
      if (!definition) throw new Error('Commande cible introuvable.');
      await save(definition,value.deviceId);
    }
    return true;
  }
  async function task(name,button) {
    if (name === 'action-route') {await installationUI.reload();open(button.dataset.actionId);return true;}
    if (name === 'action-route-clear') {await save();return true;}
    return false;
  }
  return {submit,task};
}
