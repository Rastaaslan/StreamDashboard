import {BrowserWindow} from 'electron';
import type {InstallationDevice} from '../../mobile/shared/installation.js';

/** A lazy agent-owned renderer shares the dashboard's original storage origin.
 * No preload or user-visible window is needed, including after a cold start. */
export class AutonomousExecutor {
 private owner?:BrowserWindow;
 private opening?:Promise<BrowserWindow>;
 private closed=false;
 constructor(private origin:()=>string,private context:()=>Promise<{endpoint:string;device:InstallationDevice}>){ }
 private async renderer(){
  if(this.closed)throw new Error('Agent autonome arrêté.');
  if(this.owner&&!this.owner.isDestroyed()&&!this.opening)return this.owner;
  return this.opening??=(async()=>{
   const owner=new BrowserWindow({show:false,skipTaskbar:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,autoplayPolicy:'no-user-gesture-required'}});
   this.owner=owner;
   owner.webContents.setWindowOpenHandler(()=>({action:'deny'}));
   owner.webContents.on('will-navigate',event=>event.preventDefault());
   owner.on('closed',()=>{if(this.owner===owner)this.owner=undefined;});
   try{await owner.loadURL(this.origin()+'/mobile/control/native-executor.html');if(this.closed)throw new Error('Agent autonome arrêté.');return owner;}
   catch(error){if(!owner.isDestroyed())owner.destroy();throw error;}
  })().finally(()=>{this.opening=undefined;});
 }
 async request(operation:'state'|'command',body?:unknown){
  if(!['state','command'].includes(operation)||JSON.stringify(body??null).length>16000)throw new Error('Requête autonome invalide.');
  const context=await this.context(),owner=await this.renderer();
  return owner.webContents.executeJavaScript(`sdLocalExecutor.request(${JSON.stringify(operation)},${JSON.stringify(body??null)},${JSON.stringify(context)})`);
 }
 async dispose(){this.closed=true;const owner=this.owner;if(!owner||owner.isDestroyed())return;try{await owner.webContents.executeJavaScript('globalThis.sdLocalExecutor?.dispose()');}finally{if(!owner.isDestroyed())owner.destroy();}}
}
