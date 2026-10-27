import { actionDefinition, actionCapability } from './action-definition.js';
// One installation contract for Windows, Android and browser controllers.
// This document contains topology only. Tokens, cookies and user content stay
// in their existing device stores; changing roles never moves or deletes them.
export const SETUPS = Object.freeze({
  'single-pc': 'Mono-PC Windows',
  'single-pc-deck': 'Mono-PC Windows + Android Deck',
  'dual-pc': 'Double-PC Windows',
  'dual-pc-deck': 'Double-PC Windows + Android Deck',
  'android-only': 'Android autonome',
  custom: 'Configuration personnalisée',
});
export const ROLES = Object.freeze({
  controller: 'Pilotage', 'obs-executor': 'Exécution OBS',
  display: 'Visionneuses et chats', services: 'Services et planning', audio: 'Audio local',
});
const idPattern = /^[a-zA-Z0-9_-]{1,100}$/;
const common = ['cloud', 'planning', 'chat', 'viewer', 'audio', 'storage'];
export const roleForCapability = capability => ({obs:'obs-executor',clips:'obs-executor','global-keys':'controller',audio:'audio',cloud:'services',planning:'services',chat:'display',viewer:'display'})[capability];
export function deviceRoleAvailable(device, capability) {
  const role=roleForCapability(capability);return !role || device.roles.includes(role);
}
export function installationRequiresRestart(before, after) {
  const left=before.devices.find(d=>d.id===before.localDeviceId),right=after.devices.find(d=>d.id===after.localDeviceId);
  return left.platform==='windows' && Object.keys(ROLES).some(role=>left.roles.includes(role)!==right.roles.includes(role));
}
export const capabilitiesFor = platform => [...common, ...(platform === 'windows' ? ['obs', 'clips', 'global-keys'] : [])];
const copy = value => structuredClone(value);
const fail = message => { throw new Error(message); };
export function installationEndpoint(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) fail('Adresse d’appareil invalide.');
  return url.origin;
}
export function validateInstallation(input) {
  if (!input || input.version !== 2 || !Number.isSafeInteger(input.revision) || input.revision < 0 || !Object.hasOwn(SETUPS, input.preset)) fail('Configuration d’installation incompatible.');
  if (!Array.isArray(input.devices) || !input.devices.length || input.devices.length > 64 || !idPattern.test(input.localDeviceId)) fail('Liste d’appareils invalide.');
  const ids = new Set();
  for (const device of input.devices) {
    if (!device || !idPattern.test(device.id) || ids.has(device.id) || !['windows', 'android', 'browser'].includes(device.platform)) fail('Identité d’appareil invalide ou dupliquée.');
    ids.add(device.id);
    if (typeof device.name !== 'string' || !device.name.trim() || device.name.length > 80) fail('Nom d’appareil requis (80 caractères maximum).');
    if (!Array.isArray(device.roles) || device.roles.some(role => !Object.hasOwn(ROLES, role)) || new Set(device.roles).size !== device.roles.length) fail('Rôles invalides.');
    if (!Array.isArray(device.capabilities) || device.capabilities.some(c => !capabilitiesFor(device.platform).includes(c))) fail('Capacités incompatibles avec cet appareil.');
    if (device.roles.includes('obs-executor') && !device.capabilities.includes('obs')) fail('Cet appareil ne peut pas exécuter OBS.');
    if (device.endpoint !== undefined) installationEndpoint(device.endpoint);
    if (typeof device.enabled !== 'boolean') fail('Disponibilité configurée invalide.');
  }
  const local = input.devices.find(d => d.id === input.localDeviceId);
  if (!local || !local.enabled) fail('L’appareil courant doit rester présent et actif.');
  if (!['root', 'device-runtime', 'native', 'browser'].includes(input.runtimeProfile)) fail('Profil local invalide.');
  if (typeof input.background !== 'boolean' || typeof input.configured !== 'boolean') fail('Options d’installation invalides.');
  if (input.startAtLogin !== undefined && typeof input.startAtLogin !== 'boolean') fail('Option de démarrage invalide.');
  if (input.startAtLogin && local.platform !== 'windows') fail('Le démarrage automatique concerne Windows.');
  if (!input.routes || typeof input.routes !== 'object' || Array.isArray(input.routes)) fail('Destinations invalides.');
  for (const [capability, id] of Object.entries(input.routes)) {
    if (![...common, 'obs', 'clips', 'global-keys'].includes(capability) || !ids.has(id)) fail('Destination inconnue.');
    const target = input.devices.find(d => d.id === id);
    if (!target.capabilities.includes(capability)) fail('La destination ne possède pas la capacité requise.');
  }
  if (input.actionRoutes !== undefined) {
    if (!Array.isArray(input.actionRoutes) || input.actionRoutes.length > 1000) fail('Associations de boutons invalides.');
    const keys = new Set();
    for (const route of input.actionRoutes) {
      if (!route || typeof route.workspace !== 'string' || !route.workspace || route.workspace.length > 2048 || !idPattern.test(route.actionId) || !ids.has(route.deviceId) || !actionDefinition(route.definition)) fail('Destination de bouton invalide.');
      const key = JSON.stringify([route.workspace, route.actionId]);
      if (keys.has(key)) fail('Destination de bouton dupliquée.');
      keys.add(key);
      const target = input.devices.find(d => d.id === route.deviceId);
      if (!target.capabilities.includes(actionCapability(route.definition.type))) fail('Bouton incompatible avec la destination.');
      if (JSON.stringify(route.definition).length > 4000) fail('Définition de bouton trop longue.');
    }
  }
  return copy(input);
}
export function migrateInstallation({ id, platform, legacy = {}, pairedEndpoint = '' }) {
  if (!idPattern.test(id)) fail('Identifiant local requis.');
  const executesObs = platform === 'windows' && legacy.role !== 'control';
  const local = { id, platform, name: String(legacy.name || (platform === 'android' ? 'Mon téléphone' : 'Mon ordinateur')).slice(0, 80),
    roles: ['controller', 'display', 'services', 'audio', ...(executesObs ? ['obs-executor'] : [])], capabilities: capabilitiesFor(platform), enabled: true };
  const devices = [local], routes = Object.fromEntries(common.map(c => [c, id]));
  if (executesObs) { routes.obs = id; routes.clips = id; }
  if (platform === 'windows') routes['global-keys'] = id;
  if (pairedEndpoint) {
    devices.push({ id: 'legacy-paired', name: 'Appareil associé RC11.7', platform: 'windows', roles: ['obs-executor'], capabilities: ['obs', 'clips', 'audio'], enabled: true, endpoint: installationEndpoint(pairedEndpoint) });
    routes.obs = 'legacy-paired'; routes.clips = 'legacy-paired';
  }
  return validateInstallation({ version: 2, revision: 0, configured: legacy.configured === true,
    localDeviceId: id, preset: platform === 'android' ? pairedEndpoint ? 'single-pc-deck' : 'android-only' : pairedEndpoint || !executesObs ? 'dual-pc' : 'single-pc',
    runtimeProfile: platform === 'windows' ? legacy.role === 'control' ? 'device-runtime' : 'root' : platform === 'android' ? 'native' : 'browser',
    background: false, devices, routes, migration: { source: 'RC11.7', preservedLegacyRole: legacy.role || null } });
}
export function planInstallationChange(current, changes, expectedRevision) {
  const before = validateInstallation(current);
  if (expectedRevision !== before.revision) fail('Installation modifiée ailleurs. Actualisez avant de réessayer.');
  const next = copy(before), local = next.devices.find(d => d.id === next.localDeviceId);
  if(changes.restore){
    if(Object.keys(changes).length!==1)fail('Prévisualisez la restauration séparément des autres changements.');
    const saved=readInstallationBackup(changes.restore,before);
    Object.assign(next,{preset:saved.preset,background:saved.background,startAtLogin:saved.startAtLogin||false,routes:copy(saved.routes),actionRoutes:copy(saved.actionRoutes||[])});
    // Devices learned since the backup remain recorded, disabled and reversible.
    next.devices=[...saved.devices.map(device=>({...before.devices.find(old=>old.id===device.id),...copy(device)})),...before.devices.filter(device=>!saved.devices.some(old=>old.id===device.id)).map(device=>({...device,enabled:false}))];
  }
  if (changes.preset !== undefined) next.preset = changes.preset;
  if (changes.name !== undefined) local.name = String(changes.name).trim();
  if (changes.roles !== undefined) local.roles = copy(changes.roles);
  if (changes.background !== undefined) next.background = changes.background;
  if (changes.startAtLogin !== undefined) next.startAtLogin = changes.startAtLogin;
  if (changes.routes !== undefined) next.routes = copy(changes.routes);
  if (changes.actionRoutes !== undefined) next.actionRoutes = copy(changes.actionRoutes);
  // A preset is a description of the installation, never fabricated hardware.
  if (next.preset === 'android-only' && local.platform !== 'android') fail('Le mode Android autonome se choisit sur un appareil Android.');
  if (changes.device) {
    const item = copy(changes.device), index = next.devices.findIndex(d => d.id === item.id);
    if (item.id === next.localDeviceId) fail('Utilisez les réglages de cet appareil pour modifier ses rôles.');
    if (index < 0) next.devices.push(item); else next.devices[index] = { ...next.devices[index], ...item };
  }
  if (changes.disableDeviceId) {
    const item = next.devices.find(d => d.id === changes.disableDeviceId);
    if (!item || item.id === next.localDeviceId) fail('Cet appareil ne peut pas être retiré.');
    item.enabled = false; // Keep identity, routes and associations for reversal.
  }
  if (changes.roles && !changes.routes) {
    for (const capability of ['obs', 'clips']) {
      if (local.roles.includes('obs-executor')) next.routes[capability] = local.id;
      else if (next.routes[capability] === local.id) delete next.routes[capability];
    }
  }
  next.configured = true; next.revision++;
  const restart = installationRequiresRestart(before, next);
  return { next: validateInstallation(next), restart, summary: [
    `Installation : ${SETUPS[next.preset]}`,
    `Cet appareil : ${next.devices.find(d=>d.id===next.localDeviceId).name} · ${next.devices.find(d=>d.id===next.localDeviceId).roles.map(r => ROLES[r]).join(', ') || 'aucun rôle'}`,
    restart ? 'Redémarrage de l’application nécessaire après vérification d’OBS.' : 'Application des réglages sans redémarrage.',
    next.startAtLogin ? 'L’agent démarrera sans fenêtre à l’ouverture de votre session Windows.' : 'Démarrage automatique désactivé.',
    'Les données, comptes et associations existants sont conservés.',
    ...Object.entries(next.routes).flatMap(([capability,id])=>{const target=next.devices.find(d=>d.id===id);return target&&(!target.enabled||!deviceRoleAvailable(target,capability))?[`${capability} indisponible : ${target.name} ou son rôle est désactivé.`]:[];}),
  ] };
}

/** Portable topology document, intentionally excluding tokens, pins, cookies
 * and runtime state. Restoring it still goes through the normal revision gate. */
export function installationBackup(current,now=()=>new Date().toISOString()){
 const value=validateInstallation(current);
 const actionRoutes=(value.actionRoutes||[]).map(route=>{const action=route.definition;return {workspace:route.workspace,actionId:route.actionId,deviceId:route.deviceId,definition:{id:action.id,type:action.type,value:action.value,label:String(action.label||''),color:String(action.color||''),shortcut:String(action.shortcut||''),...(action.wizebot?{wizebot:{channel:action.wizebot.channel||'',id:action.wizebot.id||''}}:{})}};});
 const installation={version:2,revision:value.revision,localDeviceId:value.localDeviceId,preset:value.preset,runtimeProfile:value.runtimeProfile,configured:value.configured,background:value.background,startAtLogin:value.startAtLogin||false,routes:copy(value.routes),actionRoutes,devices:value.devices.map(device=>({...publicInstallationDevice({...device,enabled:true}),enabled:device.enabled,...(device.endpoint?{endpoint:device.endpoint}:{})}))};
 return {format:'StreamDashboard-installation',version:1,savedAt:now(),installation};
}
export function readInstallationBackup(document,current){
 if(document?.format!=='StreamDashboard-installation'||document.version!==1)fail('Fichier de sauvegarde d’installation incompatible.');
 const saved=validateInstallation(document.installation);
 if(saved.localDeviceId!==current.localDeviceId||saved.runtimeProfile!==current.runtimeProfile)fail('Cette sauvegarde appartient à un autre appareil. Associez cet appareil pour transférer les responsabilités.');
 const own=saved.devices.find(device=>device.id===saved.localDeviceId),actual=current.devices.find(device=>device.id===current.localDeviceId);
 if(own.platform!==actual.platform||JSON.stringify([...own.capabilities].sort())!==JSON.stringify([...actual.capabilities].sort()))fail('Les capacités locales de cette sauvegarde ne correspondent pas à cet appareil.');
 // Recreate from the public topology shape, ignoring private or future fields
 // supplied by a file. Existing local extension fields remain in current.
 return installationBackup(saved).installation;
}
export function resolveCapability(installation, capability, observations = {}, targetId) {
  const selected = targetId || installation.routes[capability];
  if (!selected) return { status: 'unavailable', reason: 'no-target', message: 'Choisissez un appareil compatible.' };
  const device = installation.devices.find(d => d.id === selected);
  const result = (status, reason, message) => ({ status, reason, message, deviceId: selected });
  if (!device || !device.enabled) return result('unavailable', 'disabled', 'Appareil retiré ou désactivé.');
  if (!device.capabilities.includes(capability)) return result('unavailable', 'unsupported', 'Fonction incompatible avec cet appareil.');
  const observed = observations[selected];
  // Peer roles are an association-time description, not a local override of
  // that peer's current roles. An authenticated fresh observation supersedes it.
  const effective = device.id !== installation.localDeviceId && observed?.roles ? {...device,roles:observed.roles} : device;
  if (['obs', 'clips'].includes(capability) && !effective.roles.includes('obs-executor')) return result('unavailable', 'agent-stopped', 'Le rôle d’exécution OBS est arrêté.');
  if (!deviceRoleAvailable(effective, capability)) return result('unavailable', 'role-stopped', 'Le rôle « '+ROLES[roleForCapability(capability)]+' » est désactivé sur cet appareil.');
  if (observed?.roles && !deviceRoleAvailable({...device,roles:observed.roles},capability)) return result('unavailable','role-stopped','Le rôle requis est arrêté sur l’appareil cible.');
  if (!observed) return result('unknown', 'not-observed', 'Connexion de cet appareil non vérifiée.');
  if (observed.connected !== true) return result('unavailable', 'offline', 'Appareil déconnecté. Aucune commande ne sera mise en attente.');
  if (observed.permissions && !observed.permissions.includes(capability)) return result('unavailable', 'permission', 'Permission manquante sur cet appareil.');
  if (['obs', 'clips'].includes(capability) && observed.obsConnected !== true) return result('unavailable', 'obs-disconnected', 'OBS n’est pas connecté sur cet appareil.');
  return result('available', 'ready', 'Disponible');
}

// Browser/Android writes use Web Locks when offered; revision checks still
// protect stale dialogs. Backups precede the single current-document write.
export function createInstallationStore(storage, initialize, lock = work => globalThis.navigator?.locks ? navigator.locks.request('sd-installation-v2', work) : work()) {
  const key = 'sd2.installation.v2', backup = key + '.backup', journal = key + '.pending';
  const erase = name => storage.removeItem ? storage.removeItem(name) : storage.setItem(name, '');
  const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
  const read = () => {
    const raw = storage.getItem(key), pending = storage.getItem(journal);
    const transaction = pending ? JSON.parse(pending) : null;
    const current = raw ? validateInstallation(JSON.parse(raw)) : validateInstallation(transaction?.before || initialize());
    if (!transaction) return current;
    if (transaction.version !== 1) fail('Journal de transition incompatible.');
    const before = validateInstallation(transaction.before), next = validateInstallation(transaction.next);
    if (before.localDeviceId !== current.localDeviceId || next.localDeviceId !== current.localDeviceId || before.runtimeProfile !== current.runtimeProfile || next.runtimeProfile !== current.runtimeProfile || next.revision !== before.revision + 1) fail('Journal de transition d’un autre appareil.');
    const committed = same(current,next);
    if (!committed && !same(current,before)) fail('Configuration modifiée depuis l’interruption. Récupération suspendue.');
    if (committed) storage.setItem(backup,JSON.stringify(before));
    else if (transaction.backupBefore) storage.setItem(backup,JSON.stringify(validateInstallation(transaction.backupBefore)));
    else erase(backup);
    if (!raw) storage.setItem(key,JSON.stringify(current));
    erase(journal);
    return current;
  };
  const commit = (current,next) => {
    const old = storage.getItem(backup);
    storage.setItem(journal,JSON.stringify({version:1,before:current,next,backupBefore:old?validateInstallation(JSON.parse(old)):null}));
    storage.setItem(backup,JSON.stringify(current));
    storage.setItem(key,JSON.stringify(next));
    try { erase(journal); } catch { /* The committed document selects recovery. */ }
  };
  const change = (changes, revision) => lock(async () => {
    const current = read(), plan = planInstallationChange(current, changes, revision);
    commit(current,plan.next);
    return plan;
  });
  const restore = revision => lock(async () => {
    const current = read();
    if (current.revision !== revision) fail('Installation modifiée ailleurs.');
    const raw = storage.getItem(backup); if (!raw) fail('Aucune configuration précédente disponible.');
    const next = validateInstallation(JSON.parse(raw));
    if (next.localDeviceId !== current.localDeviceId || next.runtimeProfile !== current.runtimeProfile) fail('Sauvegarde d’un autre appareil.');
    next.revision = current.revision + 1;
    commit(current,next);
    return next;
  });
  return { read, change, restore };
}

// Only these fields may cross a device boundary. Unknown local fields may hold
// future private settings and are intentionally absent from discovery replies.
export function publicInstallationDevice(device) {
  const {id,name,platform,roles,capabilities,enabled}=device;
  const clean={id,name,platform,roles,capabilities,enabled};
  validateInstallation({version:2,revision:0,localDeviceId:id,preset:'custom',runtimeProfile:'browser',background:false,configured:true,devices:[clean],routes:{}});
  return copy(clean);
}
export function associateInstallationDevice(current, endpoint, advertised) {
  const origin=installationEndpoint(endpoint),previous=current.devices.find(d=>d.endpoint===origin);
  const device=advertised?publicInstallationDevice(advertised):{id:previous?.id||'legacy-'+Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join(''),name:previous?.name||'Appareil associé RC11.7',platform:'windows',roles:['obs-executor'],capabilities:['obs','clips','audio'],enabled:true};
  if(device.id===current.localDeviceId)fail('Cet appareil est déjà votre appareil local.');
  const routes={...current.routes};
  if(device.capabilities.includes('obs')&&device.roles.includes('obs-executor')){routes.obs=device.id;if(device.capabilities.includes('clips'))routes.clips=device.id;}
  return {device:{...device,endpoint:origin},...(previous&&previous.id!==device.id?{disableDeviceId:previous.id}:{}),routes};
}
