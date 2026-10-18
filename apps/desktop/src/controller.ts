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
  app.use((_req,res,next)=>{res.set({'Content-Security-Policy':"default-src 'self'; connect-src 'self' http:; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});next();});
  app.use('/mobile',express.static(directory));
  return new Promise((resolve,reject)=>{const server=app.listen(48134,'127.0.0.1',()=>resolve(server));server.once('error',reject);});
}
export function installControllerKeys(window: () => BrowserWindow | null, userData: string, uiOrigin: string) {
  const secrets = new ElectronSecretStore(userData);
  let signature = '', pending = false;
  let state: {registered: string[]; unavailable: string[]; lastResult?: unknown} = {registered:[],unavailable:[]};
  const trusted = (event: Electron.IpcMainInvokeEvent) => event.sender === window()?.webContents && new URL(event.senderFrame?.url || 'about:blank').origin === uiOrigin;
  ipcMain.handle('controller:credential:get',async event=>{if(!trusted(event))throw new Error('Interface non autorisée.');return (await secrets.getController())?.credential || '';});
  ipcMain.handle('controller:credential:set',async(event,value:unknown)=>{if(!trusted(event)||typeof value!=='string'||value.length>256)throw new Error('Credential invalide.');await secrets.setController({credential:value});});
  ipcMain.handle('controller:status',event=>{if(!trusted(event))throw new Error('Interface non autorisée.');return state;});
  ipcMain.handle('controller:configure', (event, value: {server:string;credential:string;actions:DeckAction[]}) => {
    if (!trusted(event) || !value || !Array.isArray(value.actions) || value.actions.length>100 || typeof value.credential!=='string' || value.credential.length>256) throw new Error('Configuration de raccourcis invalide.');
    const server = normalizeServer(value.server);
    const nextSignature = JSON.stringify([server,value.credential,value.actions.map(a=>[a.id,a.shortcut,a.type])]);
    if (nextSignature===signature) return state;
    globalShortcut.unregisterAll(); signature=nextSignature; state={registered:[],unavailable:[]};
    for (const action of value.actions) {
      if (!action.shortcut) continue;
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(action.id) || !/^Control\+Alt\+Shift\+F(?:[1-9]|1\d|2[0-4])$/.test(action.shortcut)) throw new Error('Association de raccourci invalide.');
      const registered=globalShortcut.register(action.shortcut,()=>{
        if(pending)return;
        if(action.type==='live.stop') { window()?.webContents.send('controller:receipt',{status:'failed',message:'Confirmez l’arrêt depuis le bouton du tableau de bord.'}); return; }
        pending=true;
        void (async()=>{
          try {
            const response=await fetch(`${server}/api/v2/actions`,{method:'POST',headers:{'Content-Type':'application/json',...(value.credential?{Authorization:`Device ${value.credential}`}:{})},body:JSON.stringify({id:randomUUID(),issuedAt:new Date().toISOString(),action:action.id}),signal:AbortSignal.timeout(65_000)});
            const result=await response.json() as {error?:{message?:string};status?:string;message?:string};
            if(!response.ok)throw new Error(result.error?.message||'Commande refusée par la régie.');
            state.lastResult=result;window()?.webContents.send('controller:receipt',result);
          } catch(error) {const result={status:'uncertain',message:error instanceof Error?error.message:'Hôte indisponible. Aucune commande conservée pour la reconnexion.'};state.lastResult=result;window()?.webContents.send('controller:receipt',result);}
          finally{setTimeout(()=>{pending=false;},250);}
        })();
      });
      (registered?state.registered:state.unavailable).push(action.shortcut);
    }
    return state;
  });
  return ()=>{globalShortcut.unregisterAll();for(const name of ['controller:configure','controller:status','controller:credential:get','controller:credential:set'])ipcMain.removeHandler(name);};
}
