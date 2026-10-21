// Loaded before the packaged main entry. This test never uses a real profile.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const root=process.env.STREAMDASHBOARD_QA_ROOT;
if(!root||!path.isAbsolute(root)||path.dirname(root)!==os.tmpdir()||!path.basename(root).startsWith('streamdashboard-qa-'))throw Error('Isolated QA directory required');
if(!process.argv.includes('--role=client')||!process.argv.includes('--agent'))throw Error('This test must not enable OBS');
app.setPath('appData',root);
const origin='http://127.0.0.1:48135';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const assert=(condition,message)=>{if(!condition)throw Error(message);};
async function until(work){let last;for(let i=0;i<100;i++){try{return await work();}catch(error){last=error;await delay(100);}}throw last;}
async function request(route,body,method='POST',headers={}){
 const response=await fetch(origin+route,{method:body===undefined?'GET':method,headers:{'content-type':'application/json',...headers},body:body===undefined?undefined:Buffer.isBuffer(body)?body:JSON.stringify(body),signal:AbortSignal.timeout(5000)});
 const value=await response.json();assert(response.ok,'HTTP '+response.status+' on '+route);return value;
}
app.whenReady().then(async()=>{
 const evidence={version:app.getVersion(),platform:process.platform,pid:process.pid,checks:[],passed:false};
 try {
  assert(app.getPath('appData')===root,'AppData isolation failed');
  await until(()=>request('/api/v1/health'));evidence.checks.push('headless-runtime-ready');
  assert(app.getPath('userData')===path.join(root,'StreamDashboard-Next'),'User data isolation failed');
  const installation=JSON.parse(fs.readFileSync(path.join(app.getPath('userData'),'installation-v2.json'),'utf8'));
  assert(!installation.devices.find(d=>d.id===installation.localDeviceId).roles.includes('obs-executor'),'OBS must stay disabled');
  const descriptor=await request('/api/v2/device');assert(descriptor.device.id===installation.localDeviceId,'Wrong runtime identity');
  assert(BrowserWindow.getAllWindows().length===0,'Unexpected window on agent startup');
  app.emit('activate');
  await until(async()=>{const w=BrowserWindow.getAllWindows()[0];assert(w?.webContents.getURL().startsWith('http://127.0.0.1:48134/mobile/control/'),'Dashboard not ready');});
  for(const w of BrowserWindow.getAllWindows())w.close();
  await until(async()=>{assert(BrowserWindow.getAllWindows().length===0,'Dashboard not closed');});
  await request('/api/v1/health');evidence.checks.push('dashboard-close-preserves-runtime');
  const samples=8000*10,wav=Buffer.alloc(44+samples*2);
  wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);
  const sound=await request('/api/v2/sounds/upload?name=Silent-QA&extension=wav',wav,'POST',{'content-type':'application/octet-stream'});
  await request('/api/v1/soundboard/sounds/'+sound.id,{outputId:'device-default',volume:0},'PUT');
  const play=await request('/api/v2/actions',{id:'qa_silent_play',issuedAt:new Date().toISOString(),action:'sound.play',soundId:sound.id});
  assert(play.status==='succeeded','Silent local playback failed: '+play.message);
  assert(BrowserWindow.getAllWindows().every(w=>!w.isVisible()),'Audio exposed a visible window');
  const stop=await request('/api/v2/actions',{id:'qa_silent_stop',issuedAt:new Date().toISOString(),action:'sound.stop'});
  assert(stop.status==='succeeded','Silent playback stop failed');evidence.checks.push('silent-local-audio-without-obs');
  evidence.passed=true;
 } catch(error){evidence.error=String(error?.stack||error);}
 finally {fs.writeFileSync(path.join(root,'agent-evidence.json'),JSON.stringify(evidence,null,2));app.quit();}
});
