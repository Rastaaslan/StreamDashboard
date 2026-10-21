import {expect,it,vi} from 'vitest';
import {configureLoginStartup} from '../apps/desktop/src/login-startup.js';
it('registers only the packaged user agent, confirms Windows state and diagnoses refusal',()=>{
 const app={isPackaged:true,setLoginItemSettings:vi.fn(),getLoginItemSettings:vi.fn(()=>({openAtLogin:true}))};
 configureLoginStartup(app as any,true,'C:/Apps/StreamDashboard.exe','win32');
 expect(app.setLoginItemSettings).toHaveBeenCalledWith({name:'StreamDashboardNextAgent',path:'C:/Apps/StreamDashboard.exe',args:['--agent'],openAtLogin:true});
 expect(()=>configureLoginStartup(app as any,false,'C:/Apps/StreamDashboard.exe','win32')).toThrow('pas confirmé');
 expect(()=>configureLoginStartup({...app,isPackaged:false} as any,true,'app','win32')).toThrow('installée');
});
