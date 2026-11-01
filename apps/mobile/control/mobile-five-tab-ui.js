/** Five-tab StreamCockpit mobile presentation.
 * Receives an already synchronized host snapshot; never creates a timer or
 * dispatches OBS, Twitch or soundboard commands on its own.
 */
const service=(name,value,detail,state='neutral')=>
  `<div class="cockpit-status-card" data-state="${state}" aria-label="${name} : ${value}">
    <span class="service-name">${name}</span><strong>${value}</strong><small>${detail}</small></div>`;
const link=(title,caption,attrs)=>
  `<button type="button" class="secondary" ${attrs}><span>${title}<small>${caption}</small></span></button>`;

export function renderMobileHome({data,online,server,live,esc,now=Date.now()}){
  const host=data?.host||{},state=host.state||{},obs=state.obs||{};
  const connected=Boolean(online&&server);
  const twitch=live.destinations?.twitch||{};
  // OBS output is not proof of a public Twitch broadcast. Distinguish them.
  const twitchConfirmed=connected&&twitch.live===true;
  const obsEmitting=connected&&obs.connected===true&&obs.streaming===true;
  const uncertain=connected&&live.unconfirmed===true;
  const streamState=!connected?'Indisponible':twitchConfirmed?'Twitch en direct':
    obsEmitting?'OBS diffuse · Twitch à vérifier':uncertain?'À confirmer':'Hors ligne';
  const timer=state.timer||{};
  const timerSeconds=connected&&timer.running&&timer.deadline?
    Math.max(0,(timer.deadline-now)/1000):timer.remaining??0;
  const timerValue=Math.max(0,Math.ceil(Number.isFinite(timerSeconds)?timerSeconds:0));
  const timerClock=[Math.floor(timerValue/3600),Math.floor(timerValue/60)%60,timerValue%60]
    .map(value=>String(value).padStart(2,'0')).join(':');
  const timerLabel=!server?'Régie non associée':!online?'Hôte indisponible':
    timer.running?'En cours sur la régie':timer.remaining<=0?'Terminé':
      timer.remaining<timer.duration?'En pause':'Prêt à démarrer';
  const twitchState=!connected?'Non vérifié':twitch.live===true?'Confirmé en direct':
    twitch.live===false?'Hors ligne confirmé':'État non confirmé';
  const obsState=!connected?'Non vérifié':!obs.connected?'Déconnecté':
    obs.streamingKnown===false?'Sortie inconnue':obs.streaming?'En émission':'Prêt';
  const micName=host.settings?.primaryMicInput||'';
  const mic=obs.inputs?.[micName];
  const micState=!connected?'Non vérifié':!obs.connected?'OBS indisponible':
    !micName?'Non configuré':!mic?'Source non trouvée':mic.muted?'Micro coupé':'Micro présent';
  const items=Array.isArray(host.occurrences)&&host.occurrences.length?host.occurrences:host.planning||[];
  const next=items.filter(item=>Number.isFinite(Date.parse(item.startAtUtc||item.startAt||'')) &&
      Date.parse(item.startAtUtc||item.startAt)>now)
    .sort((a,b)=>Date.parse(a.startAtUtc||a.startAt)-Date.parse(b.startAtUtc||b.startAt))[0];
  const nextWhen=next?new Date(next.startAtUtc||next.startAt).toLocaleString('fr-FR',
    {weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'';
  const friendlyHost=esc(host.hostname||'Régie non associée');
  return `<div class="cockpit-screen" data-screen="home">
    <section class="cockpit-hero">
      <span class="cockpit-kicker">LE STREAMCOCKPIT · ACCUEIL</span>
      <h1>${twitchConfirmed?'Twitch en direct':obsEmitting?'Sortie OBS active · Twitch à confirmer':uncertain?'État du live à confirmer':'Votre régie, au même endroit.'}</h1>
      <p>${friendlyHost} · ${connected?'Régie maîtresse connectée':'Régie non joignable ou non associée'}. Les commandes ne partent jamais d'une seconde régie Android.</p>
      <div class="cockpit-hero-status">
        <span class="cockpit-chip" data-tone="${twitchConfirmed?'live':obsEmitting||uncertain||!connected?'warn':'neutral'}">${streamState}</span>
        <span class="cockpit-chip">⏱ Minuteur du fixe</span>
      </div>
    </section>
    ${!connected?'<div class="cockpit-offline" role="status">Régie indisponible : états non confirmés, commandes de diffusion désactivées. Vérifiez l’association et le réseau.</div>':''}
    <section class="cockpit-shared-timer" aria-label="Minuteur partagé du PC de stream">
      <div class="cockpit-shared-timer-heading"><span>⏱ Minuteur du fixe</span><small>Régie maîtresse</small></div>
      <div class="cockpit-shared-timer-row">
        <div><strong data-timer-clock>${timerClock}</strong><p data-timer-status>${timerLabel}</p></div>
        <button type="button" class="secondary" data-task="open-mobile-timer" ${connected?'':'disabled'}>Gérer ›</button>
      </div>
    </section>
    <h2 class="cockpit-section-title">État des services</h2>
    <div class="cockpit-status-grid">
      ${service('◉ OBS Studio',obsState,connected&&obs.scene?'Scène : '+esc(obs.scene):'État fourni par le PC de stream',connected&&obs.connected&&obs.streamingKnown!==false?'good':'warn')}
      ${service('T · Twitch',twitchState,'Publication et confirmation séparées',twitch.live===true?'good':!connected||twitch.live==null?'warn':'neutral')}
      ${service('🎙 Micro OBS',esc(micState),micName?'Source : '+esc(micName):'Configuration requise',connected&&mic&&!mic.muted?'good': 'warn')}
      ${service('▦ Régie maîtresse',connected?'Connectée':'Hors ligne',friendlyHost,connected?'good':'warn')}
    </div>
    <h2 class="cockpit-section-title">Raccourcis</h2>
    <div class="cockpit-cta-grid">
      <button type="button" data-open-pane="live:control"><b>◉ Diffusion</b><span>Live, scènes, minuteur</span></button>
      <button type="button" class="secondary" data-page="planning"><b>▤ Planning</b><span>Votre prochaine session</span></button>
      <button type="button" class="secondary" data-page="sounds"><b>♫ Soundboard</b><span>Sons sur la régie</span></button>
      <button type="button" class="secondary" data-open-pane="sounds:actions"><b>▦ Deck adaptatif</b><span>Macros contextuelles</span></button>
    </div>
    <section class="cockpit-next"><b>Prochain rendez-vous</b>
      <p>${next?esc(next.title||'Session planifiée')+' · '+esc(nextWhen):
        'Aucun prochain live confirmé dans le planning synchronisé.'}</p>
      <button type="button" class="secondary" data-page="planning">Ouvrir le planning →</button>
    </section>
    <div class="cockpit-next"><b>Dernières commandes</b>
      <p>${(data?.receipts||[]).length?esc((data.receipts||[]).at(-1).message||'Reçu consultable dans l’activité'):
        'Aucun reçu d’exécution. L’état du live reste indépendant des commandes envoyées.'}</p>
      <button type="button" class="secondary" data-page="activity">Ouvrir l’activité →</button>
    </div>
  </div>`;
}

export function renderMobilePlus({data,online,server,esc}){
  const host=data?.host||{};
  const chat=host.chat||{};
  const relay=host.djiBatteryRelay;
  const djiAge=relay?.receivedAt?Date.now()-Date.parse(relay.receivedAt):Infinity;
  const djiOk=relay?.status==='ok'&&relay.observation?.status==='ok'&&djiAge>=0&&djiAge<90_000;
  return `<div class="cockpit-screen" data-screen="plus">
    <section class="cockpit-hero">
      <span class="cockpit-kicker">LE STREAMCOCKPIT · PLUS</span>
      <h1>Votre atelier de régie</h1>
      <p>Configuration, intégrations Twitch-only et diagnostics. Les actions sensibles conservent leurs confirmations.</p>
      <div class="cockpit-hero-status">
        <span class="cockpit-chip" data-tone="${online&&server?'live':'warn'}">${online&&server?'Fixe connecté':'Fixe non confirmé'}</span>
        <span class="cockpit-chip">${esc(host.hostname||'Aucune régie')}</span>
      </div>
    </section>
    <h2 class="cockpit-section-title">Commandes et événements</h2>
    <div class="cockpit-link-grid">
      ${link('▦ Deck & macros','Actions, scènes, micro, clips et raccourcis','data-open-pane="sounds:actions"')}
      ${link('⚡ WizeBot',chat.connected&&chat.canSend?'Chat Twitch autorisé':'Commandes disponibles après connexion Twitch','data-open-pane="sounds:wizebot"')}
      ${link('♥ Streamlabs','Événements et alertes de votre compte','data-open-pane="sounds:streamlabs"')}
      ${link('🛡 Modération Twitch','Ban, timeout et suppression dans le chat Live, selon vos droits','data-open-pane="live:chat"')}
      ${link('✦ Activité & alertes','Historique Streamlabs et événements','data-page="activity"')}
      ${link('🎙 Spotify / Micro / DJI',djiOk?'Relais DJI récent':'Batterie DJI non vérifiée · pas de pourcentage inventé','data-open-pane="live:micro"')}
    </div>
    <h2 class="cockpit-section-title">Mes outils</h2>
    <div class="cockpit-link-grid">
      ${link('Centre de santé','Observations horodatées · lecture seule','data-page="health"')}
      ${link('🎚 Mixeur OBS','Gains et muets observés sur le fixe · lecture seule','data-page="mixer"')}
      ${link('✦ Moments marquants','Consulter un journal de session existant · lecture seule','data-page="moments"')}
      ${link('⚙ Configuration','OBS, Twitch, Google Agenda, services','data-page="settings"')}
      ${link('☷ Gestion','Bibliothèque audio, actions, planning','data-page="manage"')}
      ${link('◉ Appareils et connexion','Association et empreinte de la régie','data-task="connection"')}
      ${link('♧ Mes comptes','Connexions indépendantes de l’appareil','data-task="device-accounts"')}
      ${link('↺ Synchronisation','État des modifications et conflits','data-task="sync-status"')}
    </div>
  </div>`;
}
