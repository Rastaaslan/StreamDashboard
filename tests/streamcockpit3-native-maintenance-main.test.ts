import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const f=vi.hoisted(()=>({paths:{} as Record<string,string>,ready:undefined as (()=>void)|undefined,
 windows:[] as any[],prepare:vi.fn(),launch:vi.fn(),handoff:vi.fn(),cancel:vi.fn(),safe:vi.fn(),configuration:vi.fn(),
 show:vi.fn(),choose:vi.fn(),errorBox:vi.fn(),stop:vi.fn(),info:vi.fn(),updater:vi.fn(),leases:[] as Array<{stop():Promise<void>}>}));
vi.mock('electron',async()=>{
 const {EventEmitter}=await import('node:events');
 const app=Object.assign(new EventEmitter(),{isPackaged:true,getPath:(n:string)=>f.paths[n],setPath:(n:string,v:string)=>{f.paths[n]=v},
  setName:vi.fn(),setAppUserModelId:vi.fn(),requestSingleInstanceLock:()=>true,getAppPath:()=>f.paths.image,getVersion:()=> '2.1.0',isReady:()=>true,
  whenReady:()=>new Promise<void>(r=>{f.ready=r}),quit:vi.fn(()=>app.emit('before-quit',{preventDefault:vi.fn()})),exit:vi.fn(),relaunch:vi.fn()});
 return {app,protocol:{registerSchemesAsPrivileged:vi.fn()},ipcMain:{handle:vi.fn(),on:vi.fn()},shell:{},
  Menu:{buildFromTemplate:(m:unknown)=>m},Tray:class{},nativeImage:{},Notification:{},
  dialog:{showMessageBox:f.show,showOpenDialog:f.choose,showErrorBox:f.errorBox}};
});
vi.mock('../apps/desktop/src/window.js',async()=>{const {EventEmitter}=await import('node:events');return {
 isAllowedExternalAuthUrl:()=>false,isAllowedTwitchUrl:()=>false,
 createDashboardWindow:()=>{const w=Object.assign(new EventEmitter(),{isDestroyed:()=>false,
  webContents:Object.assign(new EventEmitter(),{mainFrame:{url:''}}),setMenu:vi.fn(),
  loadURL:vi.fn(async(url:string)=>{w.webContents.mainFrame.url=url})});f.windows.push(w);return w},
}});
vi.mock('../apps/desktop/src/presentation.js',()=>({presentWindow:vi.fn()}));
vi.mock('../apps/desktop/src/installation-store.js',()=>({InstallationStore:class{
 async recover(){return {version:2,revision:0,localDeviceId:'fixture',runtimeProfile:'root',background:false,configured:true,
  devices:[{id:'fixture',name:'Test',roles:['controller','obs-executor'],enabled:true}]}}
 async read(){return this.recover()}
}}));
vi.mock('../apps/desktop/src/lifecycle.js',()=>({startDesktopRuntime:async()=>({dashboard:{url:'http://127.0.0.1:48133',
 assessRestartSafety:f.safe,maintenanceObservationConfiguration:f.configuration,state:()=>({obs:{streaming:false}})},stop:f.stop})}));
vi.mock('../apps/desktop/src/logger.js',()=>({DesktopLogger:class{file='test-only';info=f.info;async error(){} async flush(){}}}));
vi.mock('../apps/desktop/src/secrets.js',()=>({ElectronSecretStore:class{}}));
vi.mock('../apps/desktop/src/peer-transport.js',()=>({PeerTransport:class{fetch=vi.fn();async close(){}}}));
vi.mock('../apps/controller/src/agent-link.js',()=>({ControllerAgentLink:class{start(){} async stop(){}}}));
vi.mock('../apps/desktop/src/autonomous-executor.js',()=>({AutonomousExecutor:class{async dispose(){}}}));
vi.mock('../apps/desktop/src/dji-background-publisher.js',()=>({DjiBackgroundPublisher:class{start(){}stop(){}}}));
vi.mock('../apps/desktop/src/dji-host-warning-watcher.js',()=>({DjiHostWarningWatcher:class{start(){}stop(){}}}));
vi.mock('../apps/desktop/src/controller.js',()=>({installControllerKeys:()=>()=>{},startControllerAssets:vi.fn()}));
vi.mock('../apps/desktop/src/login-startup.js',()=>({configureLoginStartup:vi.fn()}));
vi.mock('../apps/desktop/src/squirrel.js',()=>({handleSquirrelStartup:()=>false}));
vi.mock('../apps/desktop/src/updater.js',()=>({startUpdater:f.updater}));
vi.mock('../apps/desktop/src/streamcockpit-maintenance-launcher.js',()=>({prepareNativeMaintenanceLaunch:f.prepare}));
vi.mock('../apps/desktop/src/streamcockpit-application-ownership.js',async original=>{
 const actual=await original<typeof import('../apps/desktop/src/streamcockpit-application-ownership.js')>();return {...actual,
  acquireDesktopApplicationOwnership:async(...args:Parameters<typeof actual.acquireDesktopApplicationOwnership>)=>{
   const lease=await actual.acquireDesktopApplicationOwnership(...args);f.leases.push(lease);return lease;
  }};
});
let root='',exceptions:NodeJS.UncaughtExceptionListener[]=[],rejections:NodeJS.UnhandledRejectionListener[]=[];
const observer={obs:{url:'ws://127.0.0.1:9',password:'TEST_ONLY_PASSWORD'},outputs:{twitch:{kind:'main',name:''}},
 twitch:{clientId:'TEST_CLIENT',accessToken:'TEST_ONLY_TOKEN',broadcasterId:'42'}};
beforeEach(async()=>{
 vi.resetModules();vi.resetAllMocks();f.windows=[];f.leases=[];f.updater.mockReturnValue(()=>{});
 root=await mkdtemp(join(tmpdir(),'sc3-main-maintenance-'));f.paths={appData:join(root,'app-data'),userData:join(root,'old'),image:join(root,'image')};
 await mkdir(f.paths.appData);await mkdir(join(f.paths.image,'resources'),{recursive:true});
 await writeFile(join(f.paths.image,'resources/maintenance-trust.json'),JSON.stringify({keyId:'TEST_ONLY',publicKeyPem:'-----BEGIN PUBLIC KEY-----\nTEST_ONLY_NOT_USED',
  applicationId:'test.streamcockpit',windowsSigner:'A'.repeat(40),sourceOrigin:'https://example.test'}));
 f.safe.mockResolvedValue({safe:true});f.configuration.mockResolvedValue(observer);f.info.mockResolvedValue(undefined);f.stop.mockResolvedValue(undefined);
 f.choose.mockResolvedValue({canceled:false,filePaths:[join(root,'request.json')]});f.show.mockResolvedValue({response:1});
 f.prepare.mockResolvedValue({action:'install',releaseId:'TEST_ONLY_RELEASE',version:'3.0.0',fromVersion:'2.1.0',launch:f.launch});
 f.launch.mockResolvedValue({handoff:f.handoff,cancel:f.cancel});
 exceptions=process.listeners('uncaughtException');rejections=process.listeners('unhandledRejection');
 const {app}=await import('electron');app.removeAllListeners();
});
afterEach(async()=>{
 const {app}=await import('electron');app.emit('before-quit',{preventDefault:vi.fn()});await vi.waitFor(()=>expect(app.exit).toHaveBeenCalled());
 for(const l of f.leases)await l.stop();
 for(const l of process.listeners('uncaughtException'))if(!exceptions.includes(l))process.removeListener('uncaughtException',l);
 for(const l of process.listeners('unhandledRejection'))if(!rejections.includes(l))process.removeListener('unhandledRejection',l);
 await rm(root,{recursive:true,force:true});
});
async function boot(){await import('../apps/desktop/src/main.js');f.ready!();await vi.waitFor(()=>expect(f.windows[0]?.loadURL).toHaveBeenCalledTimes(2));
 return ()=>f.windows[0].setMenu.mock.calls[0][0][0].submenu[0].click();}
it('offers existing maintenance only from explicit native menu, then closes through normal runtime cleanup after helper readiness',async()=>{
 const open=await boot(),{app,ipcMain}=await import('electron');expect(f.prepare).not.toHaveBeenCalled();expect(app.quit).not.toHaveBeenCalled();
 open();await vi.waitFor(()=>expect(app.exit).toHaveBeenCalledWith(0));
 expect(f.prepare).toHaveBeenCalledOnce();expect(f.show).toHaveBeenCalledOnce();expect(f.launch).toHaveBeenCalledExactlyOnceWith(observer);
 expect(f.handoff).toHaveBeenCalledOnce();expect(f.stop).toHaveBeenCalledOnce();expect(f.cancel).not.toHaveBeenCalled();
 expect((ipcMain.handle as any).mock.calls.some(([channel]:[string])=>/maintenance/i.test(channel))).toBe(false);
 expect(JSON.stringify(f.show.mock.calls)+JSON.stringify(f.info.mock.calls)).not.toContain('TEST_ONLY_TOKEN');
 expect(f.errorBox).not.toHaveBeenCalled();
});
it.each(['file-cancel','consent-cancel','missing-trust','invalid-contract','initial-live','live-at-consent','no-authority','helper-failure','live-after-ready'])(
 'keeps the existing runtime untouched for %s',async variant=>{
 if(variant==='file-cancel')f.choose.mockResolvedValue({canceled:true,filePaths:[]});
 if(variant==='consent-cancel')f.show.mockResolvedValue({response:0});
 if(variant==='missing-trust')await rm(join(f.paths.image,'resources/maintenance-trust.json'));
 if(variant==='invalid-contract')f.prepare.mockRejectedValue(Error('Bearer TEST_ONLY_TOKEN'));
 if(variant==='initial-live')f.safe.mockResolvedValue({safe:false});
 if(variant==='live-at-consent')f.show.mockImplementation(async()=>{f.safe.mockResolvedValue({safe:false});return {response:1}});
 if(variant==='no-authority')f.configuration.mockResolvedValue(undefined);
 if(variant==='helper-failure')f.launch.mockRejectedValue(Error('Bearer TEST_ONLY_TOKEN'));
 if(variant==='live-after-ready')f.launch.mockImplementation(async()=>{f.safe.mockResolvedValue({safe:false});return {handoff:f.handoff,cancel:f.cancel}});
 const open=await boot(),{app}=await import('electron');open();
 if(variant==='file-cancel')await vi.waitFor(()=>expect(f.choose).toHaveBeenCalledOnce());
 else if(variant==='consent-cancel')await vi.waitFor(()=>expect(f.show).toHaveBeenCalledOnce());
 else await vi.waitFor(()=>expect(f.errorBox).toHaveBeenCalledOnce());
 expect(app.quit).not.toHaveBeenCalled();expect(app.exit).not.toHaveBeenCalled();expect(f.stop).not.toHaveBeenCalled();expect(f.handoff).not.toHaveBeenCalled();
 if(variant==='live-after-ready')expect(f.cancel).toHaveBeenCalledOnce();
 expect(JSON.stringify(f.errorBox.mock.calls)).not.toContain('TEST_ONLY_TOKEN');
});
it('does not overlap two native confirmations or invoke helper after runtime teardown while selection is pending',async()=>{
 let select!:(v:unknown)=>void;f.choose.mockImplementation(()=>new Promise(r=>{select=r}));
 const open=await boot(),{app}=await import('electron');open();open();await vi.waitFor(()=>expect(f.choose).toHaveBeenCalledOnce());
 app.emit('before-quit',{preventDefault:vi.fn()});await vi.waitFor(()=>expect(app.exit).toHaveBeenCalledWith(0));
 select({canceled:false,filePaths:[join(root,'request.json')]});await new Promise(r=>setImmediate(r));
 expect(f.prepare).not.toHaveBeenCalled();expect(f.launch).not.toHaveBeenCalled();
});


it.each(['selection','helper-ready'] as const)('revokes the actual main maintenance flow if its updater is disposed during %s',async phase=>{
 const argv=process.argv;process.argv=[...argv,'--enable-candidate-updater'];
 let current=true,resolveSelection!: (value:unknown)=>void;
 try{
  await boot();expect(f.updater).toHaveBeenCalledOnce();
  const open=f.updater.mock.calls[0][5] as (isCurrent:()=>boolean)=>Promise<void>;
  expect(open).toBeTypeOf('function');
  if(phase==='selection')f.choose.mockImplementation(()=>new Promise(r=>{resolveSelection=r}));
  else f.launch.mockImplementation(async()=>{current=false;return {handoff:f.handoff,cancel:f.cancel}});
  const pending=open(()=>current);
  if(phase==='selection'){
   await vi.waitFor(()=>expect(f.choose).toHaveBeenCalledOnce());current=false;
   resolveSelection({canceled:false,filePaths:[join(root,'request.json')]});
  }
  await pending;const {app}=await import('electron');
  expect(app.quit).not.toHaveBeenCalled();expect(f.stop).not.toHaveBeenCalled();expect(f.handoff).not.toHaveBeenCalled();
  if(phase==='selection'){expect(f.prepare).not.toHaveBeenCalled();expect(f.launch).not.toHaveBeenCalled()}
  else expect(f.cancel).toHaveBeenCalledOnce();
 }finally{process.argv=argv}
});
