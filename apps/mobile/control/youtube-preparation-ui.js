import { randomUuid } from '../shared/planning-engine.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/** Provider mutations always use the live connection, never the offline replay queue. */
export async function openYouTubePreparation(root,{request,metadata,expectedRevision,isCurrent,remember,previous,select}) {
  root.innerHTML='<h2>Nouvelle diffusion YouTube</h2><p role="status">Vérification de la chaîne et des flux réutilisables…</p>';
  const [channels,streams]=await Promise.all([request('/api/v2/youtube/channels'),request('/api/v2/youtube/streams')]);
  if(!isCurrent())return;
  if(channels.items?.length!==1)throw new Error('Connectez une seule chaîne YouTube pour créer la diffusion.');
  const channel=channels.items[0],available=(streams.items||[]).filter(item=>item.channelId===channel.id);
  const localDate=new Date(Date.now()+300000);localDate.setMinutes(localDate.getMinutes()-localDate.getTimezoneOffset());
  root.innerHTML=`<h2>Nouvelle diffusion YouTube</h2><p>Chaîne : <b>${esc(channel.title)}</b></p><p class="small muted">La préparation crée la diffusion et lui associe un flux déjà configuré dans OBS. Elle ne lance pas le direct. Vous choisirez ensuite si elle devient la cible de Dashboard.</p>${!available.length?'<p class="warn">Aucun flux réutilisable trouvé. Configurez une première fois un flux dans YouTube Studio et sa clé dans OBS, puis revenez ici.</p>':''}<form data-youtube-prepare>
  <label>Titre YouTube<input name="title" required maxlength="100" value="${esc(metadata.title)}"></label>
  <label>Description YouTube<textarea name="description" maxlength="5000">${esc(metadata.description)}</textarea></label>
  <label>Catégorie YouTube<input name="youtubeCategoryId" required pattern="[0-9]{1,6}" value="${esc(metadata.youtubeCategoryId||'20')}"></label>
  <label>Tags, séparés par une virgule<input name="tags" value="${esc((metadata.tags||[]).join(', '))}"></label>
  <label>Début prévu<input name="scheduledStartTime" type="datetime-local" required value="${localDate.toISOString().slice(0,16)}"></label>
  <label>Visibilité<select name="privacyStatus"><option value="unlisted">Non répertoriée</option><option value="private">Privée</option><option value="public">Publique</option></select></label>
  <label>Public<select name="madeForKids" aria-label="Public de la diffusion" required><option value="">Choisir…</option><option value="false">Pas conçue pour les enfants</option><option value="true">Conçue pour les enfants</option></select></label>
  <label>Flux configuré dans OBS<select name="streamId" required><option value="">Choisir le flux correspondant à la sortie YouTube d’OBS…</option>${available.map(item=>`<option value="${esc(item.id)}">${esc(item.title||item.id)} · ${esc(item.id)}</option>`).join('')}</select></label>
  <p class="small muted">La clé de stream reste dans OBS. Le démarrage et l’arrêt automatiques sont désactivés pour cette nouvelle diffusion.</p>
  <button type="submit" ${!available.length?'disabled':''}>Créer et préparer la diffusion</button></form>
  <div data-prepare-result role="status"></div>${previous?'<button type="button" class="secondary" data-prepare-previous>Relire le résultat de la dernière préparation</button>':''}`;
  const form=root.querySelector('form'),result=root.querySelector('[data-prepare-result]');let busy=false,attempt;
  const renderReceipt=receipt=>{
    const line=document.createElement('p');line.textContent=receipt.message;result.replaceChildren(line);
    if(receipt.broadcastId&&/^[A-Za-z0-9_-]{11}$/.test(receipt.broadcastId)){
      const link=document.createElement('a');link.href='https://studio.youtube.com/video/'+receipt.broadcastId+'/livestreaming';link.target='_blank';link.rel='noopener noreferrer';link.textContent='Vérifier cette diffusion dans YouTube Studio';result.append(link);
      if(receipt.status==='succeeded'&&receipt.channelId===channel.id){
        const choose=document.createElement('button');choose.type='button';choose.textContent='Utiliser pour le prochain lancement';choose.addEventListener('click',async()=>{
          if(!isCurrent()||busy)return;busy=true;choose.disabled=true;
          try{await select(receipt);}catch(error){line.textContent=error.message;}finally{busy=false;choose.disabled=false;}
        });result.append(choose);
      }
    }
  };
  const send=async value=>{
    if(!isCurrent()||busy)return;
    busy=true;form.querySelector('button').disabled=true;
    try{
      await remember(value);if(!isCurrent())return;
      result.textContent='Préparation en cours…';const receipt=await request('/api/v2/youtube/prepare',value,'POST');
      if(isCurrent())renderReceipt(receipt);
    }catch(error){if(isCurrent())result.textContent=error.message+' Résultat non confirmé : utilisez « Vérifier le résultat » avant toute nouvelle création.';}
    finally{
      busy=false;
      if(isCurrent()){form.querySelector('button').disabled=false;form.querySelector('button').textContent='Vérifier le résultat';}
    }
  };
  form.addEventListener('submit',event=>{
    event.preventDefault();event.stopPropagation();if(busy||!isCurrent())return;
    if(!attempt){
      const v=Object.fromEntries(new FormData(form));
      attempt={id:randomUuid(),expectedRevision,channelId:channel.id,streamId:v.streamId,scheduledStartTime:new Date(v.scheduledStartTime).toISOString(),privacyStatus:v.privacyStatus,madeForKids:v.madeForKids==='true',metadata:{...metadata,title:v.title,description:v.description,youtubeCategoryId:v.youtubeCategoryId,tags:v.tags.split(',').map(t=>t.trim()).filter(Boolean)}};
      // Freeze the exact request for a retry after an ambiguous response.
      form.querySelectorAll('input,select,textarea').forEach(input=>{input.disabled=true;});
    }
    void send(attempt);
  });
  root.querySelector('[data-prepare-previous]')?.addEventListener('click',()=>{attempt=previous;form.querySelectorAll('input,select,textarea').forEach(input=>{input.disabled=true;});void send(previous);});
}
