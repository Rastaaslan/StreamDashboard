import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {isNewerWindowsRelease,readAvailableWindowsRelease} from '../apps/desktop/src/streamcockpit-release-availability.js';
import {windowsDistribution} from '../apps/desktop/src/streamcockpit-windows-distribution.js';
import {startUpdater} from '../apps/desktop/src/updater.js';
const mocked=vi.hoisted(()=>({check:vi.fn(),install:vi.fn(),dialog:vi.fn()}));
vi.mock('electron',async()=>{const {EventEmitter}=await import('node:events');return {
 app:{isPackaged:true,getVersion:()=> '3.0.0-alpha.2'},
 autoUpdater:Object.assign(new EventEmitter(),{checkForUpdates:mocked.check,quitAndInstall:mocked.install}),
 dialog:{showMessageBox:mocked.dialog},
}});
const roots:string[]=[];
let stop:ReturnType<typeof startUpdater>|undefined;
const platform=Object.getOwnPropertyDescriptor(process,'platform')!;
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('NODE_ENV','production');Object.defineProperty(process,'platform',{value:'win32',configurable:true})});
afterEach(async()=>{stop?.();stop=undefined;vi.useRealTimers();vi.unstubAllEnvs();Object.defineProperty(process,'platform',platform);for(const root of roots.splice(0))await rm(root,{recursive:true,force:true})});
it.each([
 ['3.0.0-alpha.3','3.0.0-alpha.2',true],['3.0.0-alpha.10','3.0.0-alpha.9',true],
 ['3.0.0-rc.1','3.0.0-alpha.89',true],['3.0.0','3.0.0-rc.8',true],['v3.0.1','3.0.0',true],
 ['3.0.0-alpha.2','3.0.0-alpha.2',false],['2.9.9','3.0.0-alpha.2',false],['invalid','3.0.0',false],
])('compares the distributed application versions %s and %s', (candidate,current,expected)=>{
 expect(isNewerWindowsRelease(candidate,current)).toBe(expected);
});
it('reads public release metadata only; no asset, installer or Squirrel package is downloaded',async()=>{
 const request=vi.fn(async(..._args:any[])=>new Response(JSON.stringify({draft:false,tag_name:'v3.0.0-alpha.3',assets:[{browser_download_url:'https://untrusted.invalid/setup.exe'}]})));
 expect(await readAvailableWindowsRelease('3.0.0-alpha.2',request as any)).toBe('3.0.0-alpha.3');
 expect(request).toHaveBeenCalledOnce();expect(request.mock.calls[0][0]).toBe('https://api.github.com/repos/Rastaaslan/StreamDashboard/releases/latest');
 expect(request.mock.calls[0][1]).toMatchObject({method:'GET',redirect:'error',cache:'no-store'});
 expect(mocked.check).not.toHaveBeenCalled();expect(mocked.install).not.toHaveBeenCalled();
});
it.each([{draft:true,tag_name:'v3.0.0-alpha.3'},{draft:false,tag_name:'v2.0.0'},{draft:false,tag_name:'<img src=x>'}])('untrusted or old availability never becomes an update %j',async payload=>{
 expect(await readAvailableWindowsRelease('3.0.0-alpha.2',vi.fn(async()=>new Response(JSON.stringify(payload))) as any)).toBeUndefined();
});
it('retains live deferral then enters the SAME native prepared flow on explicit operator choice',async()=>{
 vi.useFakeTimers();let safe=false;
 const assess=vi.fn(async()=>({safe})),native=vi.fn(async()=>undefined),available=vi.fn(async()=> '3.0.0-alpha.3');
 mocked.dialog.mockResolvedValue({response:1});
 stop=startUpdater({} as any,{assessRestartSafety:assess} as any,console,async()=>{},undefined,native,available);
 await vi.advanceTimersByTimeAsync(1);expect(mocked.dialog).not.toHaveBeenCalled();
 safe=true;await vi.advanceTimersByTimeAsync(5000);
 expect(mocked.dialog).toHaveBeenCalledOnce();expect(native).toHaveBeenCalledOnce();
 expect(mocked.check).not.toHaveBeenCalled();expect(mocked.install).not.toHaveBeenCalled();
 await vi.advanceTimersByTimeAsync(30*60*1000);expect(native).toHaveBeenCalledOnce();
});
it('disposal during slow availability prevents a later native offer',async()=>{
 vi.useFakeTimers();let finish!:(version:string)=>void;
 const available=vi.fn(()=>new Promise<string>(r=>{finish=r}));
 stop=startUpdater({} as any,{assessRestartSafety:async()=>({safe:true})} as any,console,async()=>{},undefined,vi.fn(),available);
 await vi.advanceTimersByTimeAsync(1);stop();finish('3.0.0-alpha.3');await Promise.resolve();await Promise.resolve();
 expect(mocked.dialog).not.toHaveBeenCalled();expect(mocked.check).not.toHaveBeenCalled();
});
it('recognizes the actual portable directory and does not mistake a Squirrel installation for one',async()=>{
 const root=await mkdtemp(join(tmpdir(),'sc3-distribution-'));roots.push(root);const app=join(root,'app');await mkdir(app);
 expect(await windowsDistribution(app)).toBe('directory');
 await writeFile(join(root,'Update.exe'),'TEST_ONLY_SQUIRREL');
 expect(await windowsDistribution(app)).toBe('squirrel');
});
it('an incomplete app-version installed layout fails closed rather than becoming portable',async()=>{
 const root=await mkdtemp(join(tmpdir(),'sc3-distribution-'));roots.push(root);const app=join(root,'app-3.0.0');await mkdir(app);
 await expect(windowsDistribution(app)).rejects.toThrow('SC3_DISTRIBUTION_UNVERIFIED');
});
