export function createWizebotManagement({api,esc,modal,getData,refresh,toast,uuid,isOnline=()=>true,getDraft=()=>'',saveDraft=async()=>{}}) {
 let catalog,requestId;
 const labels={running:'En cours',succeeded:'Confirmé',failed:'Échec',uncertain:'À vérifier'};
 const source=()=>`https://${catalog.channel}.streaming.lv/?commands`;
 function show(){
  const actions=getData().configuration.actions;
  modal(`<h2>Mes commandes WizeBot</h2><p class="small">Chaîne : <strong>${esc(catalog.channel||'Twitch à connecter')}</strong>${catalog.fetchedAt?' · Liste lue le '+esc(new Date(catalog.fetchedAt).toLocaleString('fr-FR')):''}</p><p class="small muted">Seules les commandes publiées sur le site WizeBot sont accessibles ici. Les commandes cachées et les paramètres avancés restent dans le panneau WizeBot.</p><div class="inline"><button type="button" data-wiz-refresh>Actualiser depuis WizeBot</button><a href="${esc(source())}" target="_blank" rel="noopener noreferrer">Voir la liste publiée</a></div><form id="wizebot-import-form"><div class="wiz-list">${catalog.items.map(c=>`<section class="wiz-command"><label class="check"><input type="checkbox" name="ids" value="${esc(c.id)}" ${c.aliases.length?'checked':'disabled'}><strong>${esc(c.aliases.join(' · ')||'Déclencheur sans !')}</strong></label><p class="small muted">#${esc(c.id)} · ${esc(c.kind)}${actions.some(a=>a.wizebot?.channel===catalog.channel&&a.wizebot.id===c.id)?' · Déjà dans le Deck':''}</p><p class="wiz-preview">${esc(c.publishedText)}</p><button type="button" class="secondary" data-wiz-edit="${esc(c.id)}" ${c.kind==='SAY'?'':'disabled'}>Modifier la réponse chez WizeBot</button></section>`).join('')||'<p class="empty">Aucune commande publiée chargée. Cliquez sur Actualiser.</p>'}</div><div class="form-actions"><button ${catalog.items.some(c=>c.aliases.length)?'':'disabled'}>Ajouter / actualiser les boutons sélectionnés</button></div></form>${history()}`);
 }
 function history(){return catalog.edits.length?`<details class="spacer" open><summary>Dernières modifications</summary>${catalog.edits.slice(-5).reverse().map(e=>`<div class="receipt ${esc(e.status)}"><strong>${labels[e.status]} · #${esc(e.commandId)}</strong><p>${esc(e.message)}</p><small>${esc(new Date(e.createdAt).toLocaleString('fr-FR'))}</small></div>`).join('')}</details>`:'';}
 async function open(){catalog=await api('/api/v2/wizebot/catalog');show();if(!catalog.fetchedAt){try{catalog=await api('/api/v2/wizebot/refresh',{});show();}catch(e){toast(e.message);}}}
 function edit(id){
  const c=catalog.items.find(c=>c.id===id);if(!c)return;
  const pending=catalog.edits.slice().reverse().find(e=>e.commandId===id&&e.status==='uncertain');requestId=uuid();
  modal(`<h2>${esc(c.aliases.join(' · ')||'#'+c.id)}</h2><p class="small">Remplacer la réponse texte chez WizeBot · #${esc(c.id)}</p><label>Aperçu publié actuel<blockquote class="wiz-preview">${esc(c.publishedText)}</blockquote></label><p class="small muted">Cet aperçu peut masquer des variables par ### ou afficher une description. La nouvelle réponse remplace tout le texte : conservez les variables utiles depuis le panneau WizeBot.</p><form id="wizebot-response-form" data-id="${esc(c.id)}" data-revision="${esc(c.revision)}"><label>Nouvelle réponse complète<textarea name="response" rows="5" required maxlength="${500-('!cmd edit '+c.id+' ').length}" placeholder="Le nouveau message de WizeBot…">${esc(getDraft(catalog.channel,c.id)||'')}</textarea></label><button type="button" class="secondary" data-wiz-copy="${esc(c.id)}" ${c.publishedText.includes('###')?'disabled':''}>Reprendre cet aperçu pour le modifier</button><p class="small">L’enregistrement envoie la commande d’édition dans ton chat Twitch. Active auparavant la gestion des commandes par chat dans WizeBot. Les modifications non confirmées restent « À vérifier ».</p>${pending?`<label class="check"><input type="checkbox" name="retryOf" value="${esc(pending.id)}">J’ai vérifié chez WizeBot et souhaite renvoyer la modification non confirmée.</label>`:''}<div class="form-actions"><button type="button" class="secondary" data-wiz-back>Retour</button><button type="button" class="secondary" data-wiz-draft>Conserver le brouillon</button><button ${isOnline()&&getData().host.chat?.canSend&&getData().host.chat?.connected?'':'disabled'}>Remplacer chez WizeBot</button></div><p id="wiz-edit-result" role="status"></p></form>`);
 }
 async function click(b){
  if(b.hasAttribute('data-wiz-draft')){const f=document.querySelector('#wizebot-response-form');await saveDraft(catalog.channel,f.dataset.id,f.elements.response.value);toast('Brouillon conservé sur cet appareil. Aucun message envoyé.');return true;}
  if(b.hasAttribute('data-wiz-refresh')){b.disabled=true;try{catalog=await api('/api/v2/wizebot/refresh',{});show();}finally{b.disabled=false;}return true;}
  if(b.hasAttribute('data-wiz-back')){show();return true;}
  if(b.dataset.wizEdit){edit(b.dataset.wizEdit);return true;}
  if(b.dataset.wizCopy){document.querySelector('#wizebot-response-form textarea').value=catalog.items.find(c=>c.id===b.dataset.wizCopy).publishedText;return true;}
  return false;
 }
 async function submit(f){
  if(f.id==='wizebot-import-form'){
   const result=await api('/api/v2/wizebot/import',{ids:new FormData(f).getAll('ids'),channel:catalog.channel,expectedRevision:getData().configuration.revision});
   catalog=result.catalog;await refresh(true);show();toast(`${result.added} bouton(s) ajouté(s), ${result.updated} actualisé(s), ${result.existing} déjà présent(s).`);return true;
  }
  if(f.id==='wizebot-response-form'){
   const v=Object.fromEntries(new FormData(f));
   await saveDraft(catalog.channel,f.dataset.id,v.response);
   const result=await api('/api/v2/wizebot/edit',{id:requestId,issuedAt:new Date().toISOString(),channel:catalog.channel,commandId:f.dataset.id,expectedRevision:f.dataset.revision,response:v.response,...(v.retryOf?{retryOf:v.retryOf}:{})});
   document.querySelector('#wiz-edit-result').textContent=`${labels[result.status]} · ${result.message}`;
   catalog=await api('/api/v2/wizebot/catalog');toast(`${labels[result.status]} · ${result.message}`);
   // A fresh form is needed for another edit; retrying this request must retain its id.
   f.dataset.completed='true';f.querySelector('textarea').readOnly=true;f.querySelector('button:not([type=button])').textContent=labels[result.status];
   return true;
  }
  return false;
 }
 return {open,click,submit};
}
