import {BrowserWindow,session,net} from 'electron';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import type {AudioPlayback} from '../../server/src/soundboard-runtime.js';
const origin='streamdashboard-audio://player';
const html=`<!doctype html><meta charset="utf-8"><title>StreamDashboard audio</title><script>
const entries=new Map(),active=new Map();
window.sdAudio={
 async play(id,url,volume,sink,mix){
  if(!mix)this.stop();if(active.size>=8)throw Error('Huit sons sont déjà en lecture.');const audio=new Audio(url);audio.volume=volume;
  if(sink&&sink!=='default'){if(!audio.setSinkId)throw Error('Choix de sortie audio indisponible.');await audio.setSinkId(sink);}
  let finish;const done=new Promise(resolve=>{finish=resolve;});
  entries.set(id,done);if(entries.size>32)entries.delete(entries.keys().next().value);
  const settle=result=>{active.delete(id);audio.onended=null;audio.onerror=null;audio.pause();audio.removeAttribute('src');audio.load();finish(result);};
  active.set(id,{audio,settle});audio.onended=()=>settle('ended');audio.onerror=()=>settle('failed');
  try{await audio.play();}catch(error){if(active.has(id))settle('failed');throw Error('Lecture impossible sur cette sortie audio.');}
 },
 wait(id){return entries.get(id)||Promise.resolve('stopped');},
 stop(){for(const entry of [...active.values()])entry.settle('stopped');},
 volume(value){for(const entry of active.values())entry.audio.volume=value;},
 async outputs(){return (await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='audiooutput'&&d.deviceId&&d.deviceId!=='default').map(d=>({id:'device:'+d.deviceId,name:d.label||'Sortie audio '+d.deviceId.slice(0,8),isDefault:false,selectable:true,supportsMixing:true}));}
};
</script>`;

/** Lazy isolated audio renderer; its lifetime belongs to the agent, not the dashboard. */
export class DesktopAudioPlayback implements AudioPlayback {
  readonly available=true;
  readonly supportedFormats=['wav','mp3','ogg','aac','m4a','flac'];
  readonly supportsVolume=true;
  readonly supportsStop=true;
  readonly supportsExplicitOutputSelection=true;
  private window?:BrowserWindow;
  private opening?:Promise<BrowserWindow>;
  private files=new Map<string,string>();
  private closed=false;
  private active=new Set<string>();
  private async player() {
    if(this.closed)throw new Error('Lecteur audio arrêté.');
    if(this.window&&!this.window.isDestroyed())return this.window;
    return this.opening??=(async()=>{
      const partition='sd-audio-'+randomUUID(),scope=session.fromPartition(partition);
      scope.setPermissionRequestHandler((_contents,permission,callback)=>callback(permission==='speaker-selection'));
      scope.protocol.handle('streamdashboard-audio',request=>{
        const url=new URL(request.url);
        if(url.protocol!=='streamdashboard-audio:'||url.hostname!=='player'||url.username||url.password||url.search||url.hash||!['GET','HEAD'].includes(request.method))return new Response('',{status:403});
        if(url.pathname==='/')return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; media-src 'self'; connect-src 'none'; frame-src 'none'; object-src 'none'"}});
        const file=this.files.get(url.pathname.slice(1));
        return file?net.fetch(pathToFileURL(file).toString(),{method:request.method,headers:request.headers}):new Response('',{status:404});
      });
      const window=new BrowserWindow({show:false,skipTaskbar:true,webPreferences:{partition,sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,autoplayPolicy:'no-user-gesture-required'}});
      window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
      window.webContents.on('will-navigate',event=>event.preventDefault());
      window.on('closed',()=>{scope.protocol.unhandle('streamdashboard-audio');if(this.window===window)this.window=undefined;this.files.clear();});
      this.window=window;
      try{await window.loadURL(origin+'/');if(this.closed)throw new Error('Lecteur audio arrêté.');return window;}
      catch(error){window.destroy();throw error;}
    })().finally(()=>{this.opening=undefined;});
  }
  async outputs(refresh=false){
    // Default output is usable before allocating a renderer. Additional outputs
    // are listed when Chromium can enumerate them without microphone access.
    if(refresh)await this.player();
    const extra=this.window&&!this.window.isDestroyed()?await this.window.webContents.executeJavaScript('sdAudio.outputs()').catch(()=>[]):[];
    return [{id:'device-default',name:'Cet appareil · sortie système',isDefault:false,selectable:true,supportsMixing:true},...extra];
  }
  async play(input:Parameters<AudioPlayback['play']>[0]){
    if(input.outputId!=='device-default'&&!input.outputId.startsWith('device:'))throw new Error('Sortie audio locale invalide.');
    if(!Number.isFinite(input.volume)||input.volume<0||input.volume>1)throw new Error('Volume invalide.');
    const window=await this.player(),id=randomUUID();this.files.set(id,input.file);this.active.add(id);
    try{await window.webContents.executeJavaScript(`sdAudio.play(${JSON.stringify(id)},${JSON.stringify(origin+'/'+id)},${input.volume},${JSON.stringify(input.outputId==='device-default'?'default':input.outputId.slice(7))},${input.playbackMode==='mix'})`);}
    catch(error){this.files.delete(id);this.active.delete(id);throw error;}
    const finished=window.webContents.executeJavaScript(`sdAudio.wait(${JSON.stringify(id)})`).then((result:string)=>{if(result==='failed')throw new Error('La lecture audio a échoué sur cet appareil.');}).finally(()=>{this.files.delete(id);this.active.delete(id);});
    return {finished};
  }
  async stop(){if(this.window&&!this.window.isDestroyed())await this.window.webContents.executeJavaScript('sdAudio.stop()');this.active.clear();this.files.clear();}
  async setVolume(value:number){if(!this.active.size||!this.window)throw new Error('Aucune lecture locale en cours.');if(!Number.isFinite(value)||value<0||value>1)throw new Error('Volume invalide.');await this.window.webContents.executeJavaScript(`sdAudio.volume(${value})`);}
  async dispose(){this.closed=true;try{await this.stop();}finally{this.window?.destroy();}}
}
