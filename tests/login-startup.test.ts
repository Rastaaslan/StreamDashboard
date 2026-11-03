import {expect,it,vi} from 'vitest';
import {configureLoginStartup} from '../apps/desktop/src/login-startup.js';
it('registers only the packaged user agent, confirms Windows state and diagnoses refusal',()=>{
 const app={isPackaged:true,setLoginItemSettings:vi.fn(),getLoginItemSettings:vi.fn(()=>({openAtLogin:true}))};
 configureLoginStartup(app as any,true,'C:/Apps/StreamDashboard.exe','win32');
 expect(app.setLoginItemSettings).toHaveBeenCalledWith({name:'StreamDashboardNextAgent',path:'C:/Apps/StreamDashboard.exe',args:['--agent'],openAtLogin:true});
 expect(()=>configureLoginStartup(app as any,false,'C:/Apps/StreamDashboard.exe','win32')).toThrow('pas confirmé');
 expect(()=>configureLoginStartup({...app,isPackaged:false} as any,true,'app','win32')).toThrow('installée');
});

it('isolated packaged QA never changes the real user startup entry or claims login registration',()=>{
 const app={isPackaged:true,setLoginItemSettings:vi.fn(),getLoginItemSettings:vi.fn()};
 const before=[...process.argv];process.argv.push('--qa-profile=C:/Temp/streamdashboard-qa-fixture');
 vi.stubEnv('NODE_ENV','test');
 try{
  configureLoginStartup(app as any,false,'C:/QA/App.exe','win32');
  expect(app.setLoginItemSettings).not.toHaveBeenCalled();expect(app.getLoginItemSettings).not.toHaveBeenCalled();
  expect(()=>configureLoginStartup(app as any,true,'C:/QA/App.exe','win32')).toThrow('profil QA isolé');
 }finally{process.argv.splice(0,process.argv.length,...before);vi.unstubAllEnvs()}
});
