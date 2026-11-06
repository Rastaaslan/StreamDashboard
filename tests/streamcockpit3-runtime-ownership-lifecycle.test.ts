import {afterEach,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {SqliteUpgradeJournal} from '../apps/desktop/src/streamcockpit-upgrade-journal.js';
import {startDesktopRuntime} from '../apps/desktop/src/lifecycle.js';

const fake=vi.hoisted(()=>({appData:'',userData:'',packageRoot:'',start:vi.fn(),stop:vi.fn(),audioStop:vi.fn(),launch:vi.fn()}));
vi.mock('electron',()=>({app:{getPath:(name:string)=>name==='appData'?fake.appData:fake.userData,
  getAppPath:()=>fake.packageRoot,isPackaged:false,getVersion:()=> '2.1.0'}}));
vi.mock('../apps/server/src/index.js',()=>({startDashboardServer:fake.start}));
vi.mock('../apps/desktop/src/secrets.js',()=>({ElectronSecretStore:class {async getGoogleClientSecret(){return ''}}}));
vi.mock('../apps/desktop/src/audio-player.js',()=>({DesktopAudioPlayback:class {dispose=fake.audioStop}}));
vi.mock('../apps/desktop/src/obs-launcher.js',()=>({launchObsIfRequested:fake.launch}));
const roots:string[]=[];
afterEach(async()=>{vi.clearAllMocks();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true})});
const onWindows=process.platform==='win32'?it:it.skip;
async function fixture(){
  const root=await mkdtemp(join(tmpdir(),'sc3-runtime-lifecycle-'));roots.push(root);
  fake.appData=join(root,'app-data');fake.userData=join(root,'profile');fake.packageRoot=join(root,'image');
  for(const dir of [fake.appData,fake.userData,fake.packageRoot])await mkdir(dir);
  const digest=createHash('sha256').update(resolve(fake.userData).toLowerCase()).digest('hex');
  const coordination=join(fake.appData,'StreamCockpit-maintenance',digest);
  await mkdir(coordination,{recursive:true});
  fake.launch.mockResolvedValue({detail:'synthetic OBS disabled'});
  fake.stop.mockResolvedValue(undefined);fake.audioStop.mockResolvedValue(undefined);
  fake.start.mockResolvedValue({stop:fake.stop,state:()=>({settings:{}})});
  return {root,coordination,logger:{info:vi.fn().mockResolvedValue(undefined),warn:vi.fn().mockResolvedValue(undefined),error:vi.fn().mockResolvedValue(undefined)}};
}
onWindows('refuses actual Desktop startup before any runtime/provider/OBS launch when maintenance owns the installation',async()=>{
  const f=await fixture(),store=new SqliteUpgradeJournal(f.coordination);
  await store.exclusive(async()=>{
    let started:Awaited<ReturnType<typeof startDesktopRuntime>>|undefined,error:unknown;
    try{started=await startDesktopRuntime(f.logger as never,undefined,false,false)}catch(e){error=e}
    finally{await started?.stop()}
    expect(error).toBeInstanceOf(Error);
    expect(fake.start).not.toHaveBeenCalled();expect(fake.launch).not.toHaveBeenCalled();
  });
});

onWindows.each([false,true])('keeps the same root-profile lock through server and audio disposal (controller=%s)',async controller=>{
 const f=await fixture();let release!:()=>void;
 const pending=new Promise<void>(yes=>{release=yes});
 fake.audioStop.mockReturnValue(pending);
 const runtime=await startDesktopRuntime(f.logger as never,undefined,controller,false);
 const store=new SqliteUpgradeJournal(f.coordination);
 try{
  await expect(store.exclusive(async()=>true)).rejects.toThrow('BUSY');
  const stopping=runtime.stop();expect(runtime.stop()).toBe(stopping);
  await vi.waitFor(()=>expect(fake.audioStop).toHaveBeenCalledTimes(1));
  await expect(store.exclusive(async()=>true)).rejects.toThrow('BUSY');
  release();await stopping;
  await expect(store.exclusive(async()=>true)).resolves.toBe(true);
  expect(fake.stop).toHaveBeenCalledTimes(1);
 }finally{release();await runtime.stop()}
});
onWindows('does not acquire or launch a runtime after pre-cancelled startup',async()=>{
 const f=await fixture(),abort=new AbortController();abort.abort(Error('cancelled'));
 await expect(startDesktopRuntime(f.logger as never,abort.signal,false,false)).rejects.toThrow('cancelled');
 expect(fake.start).not.toHaveBeenCalled();expect(fake.launch).not.toHaveBeenCalled();
 await expect(new SqliteUpgradeJournal(f.coordination).exclusive(async()=>true)).resolves.toBe(true);
});
