import { callDeviceBridge } from './device-bridge.js';

export function accountDiagnostic(code) {
  return ({
    GOOGLE_API_10:'Configuration Google de cette application Android refusée. Le package et le certificat de cet APK sont à vérifier dans le projet Google de l’éditeur.',
    GOOGLE_API_7:'Connexion réseau à Google impossible. Vérifiez Internet puis réessayez.',
    GOOGLE_API_15:'Google n’a pas répondu à temps. Réessayez.',
    TIMEOUT:'Google n’a pas répondu à temps. Réessayez.',
    GOOGLE_API_16:'Autorisation Google annulée.',
    CANCELED:'Autorisation Google annulée.',
    SCOPES:'Certaines permissions demandées n’ont pas été accordées. Réautorisez le service concerné.',
    REAUTH_REQUIRED:'Une nouvelle autorisation Google est nécessaire.',
    ACCOUNT_SELECTION_REQUIRED:'Choisissez le compte de ce service pour conserver séparément Google Agenda et YouTube.',
    ACCOUNT_MISMATCH:'Le compte renvoyé ne correspond pas au compte choisi. Reconnectez ce service.',
    ACCOUNT_SAVE_FAILED:'Connexion acquise, mais le compte n’a pas pu être sauvegardé. Reconnectez ce service avant de fermer l’application.',
    GOOGLE_PLAY_SERVICES:'Services Google Play indisponibles. Vérifiez leur mise à jour sur ce téléphone.',
    AUTH:'Google n’a pas confirmé l’autorisation. Réessayez et relevez le message affiché par Google.'
  })[code] || (code?.startsWith('GOOGLE_API_')?'Google a refusé l’autorisation. Transmettez le code ci-dessous pour identifier la cause.':'');
}

export function nativeGoogleAccounts(status) {
  const youtube = {connected:!!status.youtubeAuthorized,configured:status.configured,authorizing:status.authorizing};
  const google = {...status,connected:!!(status.connected&&status.calendarAuthorized)};
  if(status.authorizationError) {
    if(status.authorizationProvider==='youtube'){youtube.code=status.code;delete google.code;}
  } else if(status.code==='GOOGLE_PLAY_SERVICES') youtube.code=status.code;
  return {google,youtube};
}
// This adapter always addresses THIS device, independently of the selected regie.
// OAuth tokens are confined to Android Keystore or the desktop secret store.
export function createDeviceAccounts({bridge=globalThis.StreamDashboardProviders,request,modal,esc,toast,openExternal}) {
  let states={},pending,visible=false,polling=false;
  const names={twitch:'Twitch',google:'Google Calendar',youtube:'YouTube'};
  async function call(method,payload={}) {
    if(typeof bridge?.[method]!=='function')throw new Error('Cette version ne prend pas en charge la connexion sur cet appareil.');
    const value=await callDeviceBridge(bridge,method,payload);
    if(value.ok===false)throw new Error(value.message||value.code||'Connexion refusée.');
    return value;
  }
  async function read() {
    if(bridge){
      states.twitch=await call('twitchStatus');states.google=await call('googleStatus');
      if(typeof bridge.youtubeStatus==='function')states.youtube=await call('youtubeStatus');
      else Object.assign(states,nativeGoogleAccounts(states.google));
      pending=states.twitch.pending;
    }else{
      const [state,youtube]=await Promise.all([request('/api/v1/state'),request('/api/v2/youtube')]);
      states={twitch:state.twitch,google:state.google,youtube};pending=state.twitch.deviceAuthorization;
    }
  }
  function draw(){
    const googleBusy=states.google?.authorizing||states.youtube?.authorizing;
    modal(`<div data-device-accounts><h2>Comptes de cet appareil</h2><p>Connectez vos comptes ici, même si les autres appareils sont éteints. Chaque connexion reste sur cet appareil. Google Agenda et YouTube peuvent utiliser deux adresses différentes.</p>${Object.entries(names).map(([p,name])=>{const s=states[p]||{};return `<section class="panel spacer"><h3>${name}</h3><p>${s.connected?'Connecté'+(s.account?' · '+esc(s.account):''):'Non connecté'}${s.channelName?' · Chaîne : '+esc(s.channelName):''}${s.error?' · '+esc(s.error):''}</p>${s.code?`<p role="status">${esc(accountDiagnostic(s.code))} <code>${esc(s.code)}</code></p>`:''}${s.authorizing?'<p role="status">Terminez l’autorisation dans la fenêtre Google du téléphone.</p>':''}<button data-account-connect="${p}" ${s.authorizing||(bridge&&p!=='twitch'&&googleBusy)?'disabled':''}>${s.connected?(bridge&&p!=='twitch'&&typeof bridge.youtubeStatus==='function'?'Changer de compte / réautoriser':'Réautoriser'):'Connecter'}</button><button class="secondary" data-account-test="${p}">Vérifier</button>${s.connected?`<button class="secondary" data-account-logout="${p}">Déconnecter</button>`:''}</section>`;}).join('')}${pending?authorization(pending):''}<p class="small muted">Les connexions de la régie se gèrent séparément dans Configuration → Diffusion et Intégrations. La connexion à un compte ne démarre aucun live.</p><button class="secondary spacer" data-account-refresh>Actualiser les états</button></div>`);
  }
  function authorization(value){const url=value.url||value.authorizationUrl||value.verification_uri||value.verificationUri;let allowed=false;try{const u=new URL(url);allowed=u.protocol==='https:'&&['www.twitch.tv','twitch.tv','accounts.google.com'].includes(u.hostname)&&!u.username&&!u.password;}catch{}
    return `<section class="panel spacer"><h3>Autorisation sur cet appareil</h3><p>${esc(value.user_code||value.userCode||'Terminez la connexion dans le navigateur de cet appareil.')}</p>${allowed?`<a href="${esc(url)}" target="_blank" rel="noopener">Ouvrir l’autorisation ↗</a>`:''}</section>`;
  }
  async function open(){visible=true;await read();draw();}
  async function click(button){
    const provider=button.dataset.accountConnect||button.dataset.accountTest||button.dataset.accountLogout;
    if(!provider&&!button.hasAttribute('data-account-refresh'))return false;
    button.disabled=true;
    try{
      if(button.hasAttribute('data-account-refresh')){await open();return true;}
      if(button.dataset.accountConnect){
        const value=bridge?await call(provider+'Authorize'):await request({twitch:'/api/v1/twitch/device',google:'/api/v1/google/oauth/start',youtube:'/api/v2/youtube/connect'}[provider],{});
        if(value.nativeAuthorization)await read();else pending=value;
        draw();const url=value.url||value.authorizationUrl||value.verification_uri||value.verificationUri;
        if(url)await openExternal?.(url);
        return true;
      }
      if(button.dataset.accountLogout){
        if(bridge){
          if(provider==='youtube'&&typeof bridge.youtubeLogout!=='function')throw new Error('Mettez à jour l’application pour déconnecter YouTube séparément.');
          await call(provider+'Logout');
        }
        else await request({twitch:'/api/v1/twitch/disconnect',google:'/api/v1/google/disconnect',youtube:'/api/v2/youtube/disconnect'}[provider],{});
        await open();return true;
      }
      if(bridge){const result=await call(provider+'Test');states[provider]={...states[provider],...result};draw();toast(result.tested?'Compte vérifié sur cet appareil.':accountDiagnostic(result.code)||result.code||'Autorisation à vérifier.');}
      else {await open();toast('État des comptes actualisé sur cet appareil.');}
      return true;
    }finally{button.disabled=false;}
  }
  // DCF polling is explicit, throttled natively, and never invokes a stream action.
  async function poll(){
    if(!bridge||polling)return;
    polling=true;
    try{const status=await call('twitchStatus');if(!status.pending)return;const value=await call('twitchPoll');if(value.connected){toast('Twitch connecté sur cet appareil.');if(document.querySelector('[data-device-accounts]'))await open();}}
    catch(e){if(visible&&document.querySelector('[data-device-accounts]'))toast(e.message);}
    finally{polling=false;}
  }
  globalThis.addEventListener('provider-auth',()=>{if(document.querySelector('[data-device-accounts]'))void open().catch(e=>toast(e.message));});
  return {open,click,poll};
}
