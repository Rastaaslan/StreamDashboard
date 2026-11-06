/** Only display durable host-reported progress; no retry buttons or automatic continuation. */
export function renderMacroProgress(receipt,escape){
 if(!Array.isArray(receipt?.macroSteps)||receipt.macroSteps.length<2||
    receipt.macroSteps.length>5)return '';
 const labels={pending:'Non lancée',running:'Transmise, résultat à confirmer',
   succeeded:'Confirmée',uncertain:'À vérifier sur FIXE'};
 const rows=receipt.macroSteps.map((step,index)=>{
  if(!step||typeof step.id!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(step.id)||
      !Object.prototype.hasOwnProperty.call(labels,step.status))return '';
  return '<li>'+escape(String(index+1)+'. '+step.id)+' — '+escape(labels[step.status])+'</li>';
 }).join('');
 return rows?'<ol aria-label="Étapes de la séquence" class="macro-sequence-progress" style="overflow-wrap:anywhere">'+rows+'</ol>':'';
}

/** Reuses the existing action editor's value field; no second configuration store. */
export function mountMacroSequenceEditor(form,actions){
 const type=form.elements.namedItem('type'),value=form.elements.namedItem('value'),shortcut=form.elements.namedItem('shortcut');
 if(!type||!value)return;
 const doc=form.ownerDocument,box=doc.createElement('fieldset');box.dataset.macroSteps='';
 const legend=doc.createElement('legend');legend.textContent='Étapes de la séquence OBS';box.append(legend);
 const note=doc.createElement('p');note.textContent='Choisissez 2 à 5 boutons existants, dans l’ordre. Une confirmation est demandée au lancement ; aucune étape n’est répétée automatiquement.';box.append(note);
 const eligible=actions.filter(a=>a.id!==form.dataset.id&&['scene.set','mode.set','mic.toggle','timer.add','alert.play'].includes(a.type));
 const ids=type.value==='macro.sequence'?value.value.split(',').map(v=>v.trim()):[];
 const selectors=[];
 for(let i=0;i<5;i++){
  const label=doc.createElement('label');label.textContent='Étape '+(i+1);const select=doc.createElement('select');select.setAttribute('aria-label','Étape OBS '+(i+1));select.style.maxWidth='100%';
  const empty=doc.createElement('option');empty.value='';empty.textContent=i<2?'Choisir un bouton':'Aucune étape supplémentaire';select.append(empty);
  for(const action of eligible){const option=doc.createElement('option');option.value=action.id;option.textContent=action.label;select.append(option)}
  if(ids[i]&&!eligible.some(a=>a.id===ids[i])){const missing=doc.createElement('option');missing.value=ids[i];missing.textContent='Bouton absent : '+ids[i];select.append(missing)}
  select.value=ids[i]||'';label.append(select);box.append(label);selectors.push(select);
 }
 value.closest('label')?.after(box);
 const serialize=()=>{
  if(type.value!=='macro.sequence')return;
  const chosen=selectors.map(s=>s.value).filter(Boolean);value.value=chosen.join(',');
  for(const select of selectors)select.setCustomValidity(select.value&&(!eligible.some(a=>a.id===select.value)||chosen.filter(id=>id===select.value).length>1)?'Choisissez des boutons disponibles et distincts.':'');
 };
 const paint=()=>{
  const active=type.value==='macro.sequence';box.hidden=!active;const label=value.closest('label');if(label)label.hidden=active;
  selectors.forEach((s,i)=>{s.disabled=!active;s.required=active&&i<2;if(!active)s.setCustomValidity('')});
  if(shortcut){shortcut.disabled=active;if(active)shortcut.value=''}
  if(active)serialize();
 };
 type.addEventListener('change',paint);for(const select of selectors)select.addEventListener('change',serialize);
 paint();
}
