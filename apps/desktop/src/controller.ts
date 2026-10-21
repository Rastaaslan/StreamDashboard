import { globalShortcut, ipcMain, type BrowserWindow } from 'electron';
import express from 'express';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { DeckAction, ControllerConfiguration } from '../../../packages/contracts/src/control.js';
import { normalizeServer } from '../../mobile/runtime.js';
import { ElectronSecretStore } from './secrets.js';

/** Client-only runtime: static UI and global keys. No OBS connection or local business state. */
export async function startControllerAssets(directory: string): Promise<Server> {
  const app = express();
  app.use((_req,res,next)=>{res.set({'Content-Security-Policy':"default-src 'self'; media-src 'self' blob:; connect-src 'self' http: https:; img-src 'self' data: blob: https://static-cdn.jtvnw.net; style-src 'self'; frame-src https://player.twitch.tv https://www.twitch.tv https://www.youtube.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});next();});
  app.use('/mobile',express.static(directory));
  return new Promise((resolve,reject)=>{const server=app.listen(48134,'127.0.0.1',()=>resolve(server));server.once('error',reject);});
}
import { actionDefinition } from '../../mobile/shared/action-definition.js';
interface ControllerResult { status: string; message?: string; error?: { code?: string; message?: string } }
const shortcutPattern = /^Control\+Alt\+Shift\+F(?:[1-9]|1\d|2[0-4])$/;
const actionTypes = new Set<DeckAction['type']>(['mic.toggle','scene.set','mode.set','timer.add','sound.play','sound.stop','alert.play','chat.send','wizebot.command','replay.save','replay.start','replay.stop','live.start','live.stop']);

export function installControllerKeys(window: () => BrowserWindow | null, userData: string, uiOrigin: string) {
  const secrets = new ElectronSecretStore(userData);
  let signature = '', generation = 0, disposed = false;
  let configuration: ControllerConfiguration | undefined;
  let pending: { generation: number; controller: AbortController } | undefined;
  let cooldownUntil = 0;
  let retryTimer: NodeJS.Timeout | undefined;
  let restoreTimer: NodeJS.Timeout | undefined;
  let userConfigured = false;
  let persistence: Promise<unknown> = Promise.resolve();
  let persistenceSignature: string | undefined;
  let state: { registered: string[]; unavailable: string[]; lastResult?: ControllerResult } = { registered: [], unavailable: [] };

  const trusted = (event: Electron.IpcMainInvokeEvent) => {
    const owner = window(), frame = event.senderFrame;
    if (!owner || owner.isDestroyed() || !frame || event.sender !== owner.webContents || frame !== owner.webContents.mainFrame) return false;
    try { return new URL(frame.url).origin === uiOrigin; } catch { return false; }
  };
  const publish = (result: ControllerResult, currentGeneration = generation) => {
    if (disposed || currentGeneration !== generation) return;
    state.lastResult = result;
    // Execution and receipt storage never depend on a visible/focused renderer.
    // A closing/reloading renderer must not crash the main process after dispatch.
    try {
      const owner = window();
      if (owner && !owner.isDestroyed() && !owner.webContents.isDestroyed()) owner.webContents.send('controller:receipt', result);
    } catch { /* The native status endpoint keeps the result for the next view. */ }
  };
  const dispatch = (action: DeckAction, target: ControllerConfiguration, currentGeneration: number) => {
    if (disposed || currentGeneration !== generation) return;
    const destination = target.destinations?.[action.id], definition = destination?.definition || action;
    const server = destination?.server || target.server, credential = destination?.credential ?? target.credential;
    if (definition.type === 'live.stop') {
      publish({ status: 'failed', message: 'Confirmez l’arrêt depuis le bouton du tableau de bord.' });
      return;
    }
    if (pending || Date.now() < cooldownUntil) {
      publish({ status: 'failed', message: 'Une macro est déjà en cours. Cet appui est ignoré et ne sera pas exécuté plus tard.' });
      return;
    }
    const flight = { generation: currentGeneration, controller: new AbortController() };
    pending = flight;
    void (async () => {
      try {
        if (destination) {
          const observed = await fetch(`${server}/api/v2/device`, {headers:credential?{Authorization:`Device ${credential}`}:{},signal:AbortSignal.any([flight.controller.signal,AbortSignal.timeout(8_000)])});
          const descriptor = await observed.json() as {device?:{id?:string}};
          if (!observed.ok || descriptor.device?.id !== destination.deviceId) throw new Error('Identité de la destination non confirmée. Renouvelez son association.');
        }
        const response = await fetch(`${server}/api/v2/actions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(credential ? { Authorization: `Device ${credential}` } : {}) },
          body: JSON.stringify({ id: randomUUID(), issuedAt: new Date().toISOString(), action: definition.id, expectedAction: definition, trigger: 'keyboard' }),
          // The server serializes commands and can still be confirming a slow action.
          // Timeout is never followed by a retry or a queued keyboard command.
          signal: AbortSignal.any([flight.controller.signal, AbortSignal.timeout(120_000)]),
        });
        const result = await response.json() as ControllerResult;
        if (!response.ok) {
          const code = result?.error?.code || '';
          const refused = code !== 'ACTION_UNCERTAIN' && (response.status === 401 || response.status === 403 || ['REVISION_CONFLICT','CONFIRM_REQUIRED','CHECKLIST_INCOMPLETE','REMOTE_SCOPE_DENIED'].includes(code));
          publish({ status: refused ? 'failed' : 'uncertain', message: result?.error?.message || (refused ? 'Commande refusée par la régie.' : 'Commande non confirmée par la régie. Vérifiez son résultat.') }, currentGeneration);
          return;
        }
        if (!result || typeof result.status !== 'string') throw new Error('Réponse de la régie illisible. Vérifiez le résultat de la commande.');
        publish(result, currentGeneration);
      } catch (error) {
        publish({ status: 'uncertain', message: error instanceof Error ? error.message : 'Hôte indisponible. Aucune commande conservée pour la reconnexion.' }, currentGeneration);
      } finally {
        if (pending === flight) {
          pending = undefined;
          cooldownUntil = Date.now() + 250;
        }
      }
    })();
  };
  const cancelRetry = () => { if (retryTimer) clearTimeout(retryTimer); retryTimer = undefined; };
  const retryUnavailable = () => {
    cancelRetry();
    if (disposed || !configuration) return;
    const target = configuration, currentGeneration = generation;
    for (const shortcut of [...state.unavailable]) {
      const action = target.actions.find(value => value.shortcut === shortcut);
      if (!action) continue;
      let registered = false;
      try { registered = globalShortcut.register(shortcut, () => dispatch(action, target, currentGeneration)); } catch { /* A conflicting accelerator remains visibly unavailable. */ }
      if (registered) {
        state.unavailable = state.unavailable.filter(value => value !== shortcut);
        state.registered.push(shortcut);
      }
    }
    if (state.unavailable.length) {
      // Retry conflicts in the main process, including while the window is minimized.
      retryTimer = setTimeout(retryUnavailable, 5_000);
      retryTimer.unref();
    }
  };
  const configure = (value: ControllerConfiguration) => {
    if (!value || typeof value.server !== 'string' || value.server.length > 2048 || !Array.isArray(value.actions) || value.actions.length > 100 || typeof value.credential !== 'string' || value.credential.length > 256) throw new Error('Configuration de raccourcis invalide.');
    const ids = new Set<string>(), shortcuts = new Set<string>();
    // Validate the entire replacement before touching the working registrations.
    for (const action of value.actions) {
      if (!action || typeof action.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(action.id) || ids.has(action.id) || !actionTypes.has(action.type) || typeof action.shortcut !== 'string' || (action.shortcut && (!shortcutPattern.test(action.shortcut) || shortcuts.has(action.shortcut)))) throw new Error('Association de raccourci invalide.');
      ids.add(action.id); if (action.shortcut) shortcuts.add(action.shortcut);
    }
    const actions = value.actions.filter(action => action.shortcut).map(action => ({ ...action }));
    const destinations: NonNullable<ControllerConfiguration['destinations']> = {};
    if (value.destinations !== undefined && (!value.destinations || typeof value.destinations !== 'object' || Array.isArray(value.destinations))) throw new Error('Destinations invalides.');
    for (const action of actions) {
      const destination = value.destinations?.[action.id];
      if (!destination) continue;
      if (typeof destination.credential !== 'string' || destination.credential.length > 256 || !/^[A-Za-z0-9_-]{1,100}$/.test(destination.deviceId) || !actionDefinition(destination.definition) || !actionTypes.has(destination.definition.type)) throw new Error('Destination de macro invalide.');
      destinations[action.id] = {...structuredClone(destination), server:normalizeServer(destination.server)};
    }
    // Clearing the workspace must work without an address. Previously normalization
    // threw first, silently leaving the previous host's global shortcuts active.
    const server = actions.some(a=>!destinations[a.id]) ? normalizeServer(value.server) : '';
    const target = actions.length ? { server, credential: value.credential, actions, ...(Object.keys(destinations).length?{destinations}:{}) } : undefined;
    const nextSignature = target ? JSON.stringify([server, target.credential, actions, target.destinations]) : '';
    if (nextSignature === signature) { retryUnavailable(); return state; }
    generation++;
    pending?.controller.abort(); pending = undefined; cooldownUntil = 0;
    cancelRetry(); globalShortcut.unregisterAll(); signature = nextSignature; configuration = target;
    state = { registered: [], unavailable: actions.map(action => action.shortcut) };
    retryUnavailable();
    return state;
  };

  ipcMain.handle('controller:credential:get', async event => { if (!trusted(event)) throw new Error('Interface non autorisée.'); return (await secrets.getController())?.credential || ''; });
  ipcMain.handle('controller:credential:set', async (event, value: unknown) => { if (!trusted(event) || typeof value !== 'string' || value.length > 256) throw new Error('Credential invalide.'); await secrets.setController({ credential: value }); });
  ipcMain.handle('controller:device-credential:get', async (event, server: string) => { if (!trusted(event)) throw new Error('Interface non autorisée.'); return secrets.getControllerDevice(normalizeServer(server)); });
  ipcMain.handle('controller:device-credential:set', async (event, server: string, credential: string) => { if (!trusted(event) || typeof credential !== 'string' || credential.length > 256) throw new Error('Association invalide.'); await secrets.setControllerDevice(normalizeServer(server),credential); });
  ipcMain.handle('controller:status', event => { if (!trusted(event)) throw new Error('Interface non autorisée.'); return state; });
  ipcMain.handle('controller:configure', (event, value: ControllerConfiguration) => {
    if (!trusted(event)) throw new Error('Interface non autorisée.');
    const result = configure(value);
    userConfigured = true; clearTimeout(restoreTimer);
    // The secure store is owned by the native process, never by the renderer.
    const saved = configuration ? structuredClone(configuration) : undefined;
    const nextPersistenceSignature = JSON.stringify(saved) || '';
    // Rendering a receipt calls configure again. Repeating a rejected disk write
    // here would create a native receipt / renderer refresh loop and delay quit.
    if(nextPersistenceSignature !== persistenceSignature) {
      persistenceSignature = nextPersistenceSignature;
      persistence = persistence.then(() => secrets.setControllerBindings(saved)).catch(() => {
        publish({ status: 'failed', message: 'Les macros fonctionnent pour cette session, mais leur restauration au prochain démarrage n’a pas pu être enregistrée. Déverrouillez le stockage sécurisé puis relancez l’application.' });
      });
    }
    return result;
  });
  const stop = () => {
    disposed = true; generation++;
    pending?.controller.abort(); pending = undefined;
    clearTimeout(restoreTimer); cancelRetry(); globalShortcut.unregisterAll();
    for (const name of ['controller:configure','controller:status','controller:credential:get','controller:credential:set','controller:device-credential:get','controller:device-credential:set']) ipcMain.removeHandler(name);
  };
  // A cold headless start arms only mappings confirmed by the current executor.
  // No persisted command is replayed and no stale mapping is silently activated.
  const restore = async () => {
    if (disposed || userConfigured) return;
    try {
      const saved = await secrets.getControllerBindings();
      if (!saved || disposed || userConfigured) return;
      const observations = new Map<string, Promise<DeckAction[]>>();
      const read = (server:string, credential:string, deviceId?:string) => {
        const key = JSON.stringify([server,credential,deviceId]);
        if (!observations.has(key)) observations.set(key,(async()=>{
          const headers: Record<string,string> = credential ? { Authorization: `Device ${credential}` } : {};
          if (deviceId) {
            const response=await fetch(`${server}/api/v2/device`,{headers,signal:AbortSignal.timeout(8_000)});
            const value=await response.json() as {device?:{id?:string}};
            if(!response.ok||value.device?.id!==deviceId)throw new Error('Device changed');
          }
          const response=await fetch(`${server}/api/v2/state`,{headers,signal:AbortSignal.timeout(8_000)});
          if(!response.ok)throw new Error('Executor unavailable');
          const value=await response.json() as {configuration?:{actions?:DeckAction[]}};
          if(!Array.isArray(value.configuration?.actions))throw new Error('Invalid executor state');
          return value.configuration.actions;
        })());
        return observations.get(key)!;
      };
      let retry=false;
      const confirmed=(await Promise.all(saved.actions.map(async action=>{
        const target=saved.destinations?.[action.id], definition=target?.definition||action;
        try {
          const current=await read(normalizeServer(target?.server||saved.server),target?.credential??saved.credential,target?.deviceId);
          return current.some(item=>actionDefinition(item)===actionDefinition(definition))?action:null;
        } catch { retry=true;return null; }
      }))).filter((action):action is DeckAction=>action!==null);
      if (disposed || userConfigured) return;
      configure({ ...saved, actions: confirmed });
      if (confirmed.length !== saved.actions.length) publish({ status: 'failed', message: 'Certaines macros sont indisponibles ou ont changé. Les autres appareils restent utilisables.' });
      if(retry){restoreTimer=setTimeout(()=>{void restore();},5_000);restoreTimer.unref();}
    } catch {
      if (!disposed && !userConfigured) { restoreTimer = setTimeout(() => { void restore(); }, 5_000); restoreTimer.unref(); }
    }
  };
  return Object.assign(stop, { restore, flush: () => persistence });
}
