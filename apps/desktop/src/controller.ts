import { globalShortcut, ipcMain, type BrowserWindow } from 'electron';
import express from 'express';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { DeckAction } from '../../../packages/contracts/src/control.js';
import { normalizeServer } from '../../mobile/runtime.js';
import { ElectronSecretStore } from './secrets.js';

/** Client-only runtime: static UI and global keys. No OBS connection or local business state. */
export async function startControllerAssets(directory: string): Promise<Server> {
  const app = express();
  app.use((_req,res,next)=>{res.set({'Content-Security-Policy':"default-src 'self'; media-src 'self' blob:; connect-src 'self' http: https://static-cdn.jtvnw.net; img-src 'self' data: blob: https://static-cdn.jtvnw.net; style-src 'self'; frame-src https://player.twitch.tv https://www.twitch.tv https://www.youtube.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});next();});
  app.use('/mobile',express.static(directory));
  return new Promise((resolve,reject)=>{const server=app.listen(48134,'127.0.0.1',()=>resolve(server));server.once('error',reject);});
}
interface ControllerConfiguration { server: string; credential: string; actions: DeckAction[] }
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
    if (action.type === 'live.stop') {
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
        const response = await fetch(`${target.server}/api/v2/actions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(target.credential ? { Authorization: `Device ${target.credential}` } : {}) },
          body: JSON.stringify({ id: randomUUID(), issuedAt: new Date().toISOString(), action: action.id, trigger: 'keyboard' }),
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
    // Clearing the workspace must work without an address. Previously normalization
    // threw first, silently leaving the previous host's global shortcuts active.
    const server = actions.length ? normalizeServer(value.server) : '';
    const target = actions.length ? { server, credential: value.credential, actions } : undefined;
    const nextSignature = target ? JSON.stringify([server, target.credential, actions.map(action => [action.id, action.shortcut, action.type])]) : '';
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
  ipcMain.handle('controller:status', event => { if (!trusted(event)) throw new Error('Interface non autorisée.'); return state; });
  ipcMain.handle('controller:configure', (event, value: ControllerConfiguration) => {
    if (!trusted(event)) throw new Error('Interface non autorisée.');
    return configure(value);
  });
  return () => {
    disposed = true; generation++;
    pending?.controller.abort(); pending = undefined;
    cancelRetry(); globalShortcut.unregisterAll();
    for (const name of ['controller:configure','controller:status','controller:credential:get','controller:credential:set']) ipcMain.removeHandler(name);
  };
}
