/** The settings pages stay nested under Android Plus and Windows Administration.
 * This is presentation only: no service requests, device pairing, or role changes.
 */
const CATEGORIES = Object.freeze([
  {id:'devices',label:'Appareils & Deck',group:'Appareils',description:'FIXE, laptop, Android, associations et permissions',symbol:'▦'},
  {id:'obs',label:'OBS et scènes',group:'Régie',description:'Connexion OBS, modes, scènes, minuteur et micro',symbol:'◉'},
  {id:'platforms',label:'Twitch',group:'Régie',description:'Compte de diffusion et sorties Twitch',symbol:'T'},
  {id:'integrations',label:'Connexions',group:'Comptes et services',description:'Google Agenda, Discord, Streamlabs et WizeBot',symbol:'↗'},
  {id:'profile',label:'Préférences',group:'Appareil',description:'Apparence, sécurité des commandes et stockage',symbol:'⚙'},
]);

export function settingsCategories({native=false,server='' }={}) {
  return CATEGORIES.filter(item=>!(native&&!server&&item.id==='obs')).map(item=>{
    if(item.id==='platforms'&&native&&!server)return {...item,group:'Comptes et services',description:'Compte Twitch local facultatif ; jamais une seconde régie OBS'};
    if(item.id==='profile')return {...item,group:server?'Régie':'Appareil',description:server?'Profil de FIXE et préférences locales explicitement séparées':'Navigation, stockage et préférences de cet appareil'};
    return item;
  });
}

export function settingsCategory(id,environment={}) {
  return settingsCategories(environment).find(item=>item.id===id) || null;
}

export function renderSettingsNavigation({tab='overview',native=false,server='',esc,compact=false}) {
  const categories=settingsCategories({native,server});
  const links=categories.map(item=>
    `<button type="button" data-tab="${item.id}" class="${item.id===tab?'':'secondary'}" ${item.id===tab?'aria-current="page"':''}>${esc(item.symbol)} ${esc(item.label)}</button>`).join('');
  return `<nav class="settings-category-nav" aria-label="Rubriques des paramètres">
    <button type="button" data-tab="overview" class="${tab==='overview'?'':'secondary'}" ${tab==='overview'?'aria-current="page"':''}>Toutes les rubriques</button>
    ${links}
  </nav>`;
}

export function renderSettingsOverview({native=false,server='',online=false,device,esc}) {
  const categories=settingsCategories({native,server});
  const groups=['Appareils','Régie','Comptes et services','Appareil'];
  const byGroup=groups.map(group=>{
    const items=categories.filter(item=>item.group===group);
    if(!items.length)return '';
    return `<section class="settings-category-group" data-settings-group="${esc(group)}">
      <h3>${esc(group)}</h3>
      <div class="settings-category-grid">${items.map(item=>
        `<button type="button" class="secondary settings-category-card" data-tab="${item.id}">
          <strong>${esc(item.symbol)} ${esc(item.label)}</strong>
          <small>${esc(item.description)}</small>
        </button>`).join('')}</div></section>`;
  }).join('');
  const status=server?(online?'Régie joignable : les droits de chaque service restent à vérifier.':'Régie non joignable : aucune action distante autorisée.'):
    device?.role==='control'?'Laptop en mode client : associez FIXE pour contrôler OBS et le minuteur.':
      'Espace local : aucun appareil distant n’est supposé connecté.';
  return `<section class="settings-overview" data-settings-overview>
    <h2>Choisir ce que vous voulez configurer</h2>
    <p class="small muted" role="status">${esc(status)}</p>
    ${byGroup}
    <p class="small muted">Les réglages avancés restent accessibles dans leur rubrique. Changer de rubrique ne modifie aucune connexion ou configuration.</p>
  </section>`;
}
