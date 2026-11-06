import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {prepareNativeMaintenanceLaunch} from '../apps/desktop/src/streamcockpit-maintenance-launcher.js';
import {nativeMaintenanceFixture,digest} from './helpers/streamcockpit-maintenance-fixture.js';
const fake=vi.hoisted(()=>({spawn:vi.fn(),signature:vi.fn()}));
vi.mock('node:child_process',async original=>({...await original<typeof import('node:child_process')>(),spawn:fake.spawn}));
vi.mock('../apps/desktop/src/streamcockpit-windows-authenticode.js',async original=>({
 ...await original<typeof import('../apps/desktop/src/streamcockpit-windows-authenticode.js')>(),inspectWindowsAuthenticode:fake.signature,
}));
const roots:string[]=[];let child:any,mode='ready',body='';
beforeEach(()=>{
 vi.clearAllMocks();mode='ready';body='';
 fake.signature.mockImplementation(async(path:string)=>{const bytes=await readFile(path);return {path,observedAt:Date.now(),status:'valid',
  signer:'A'.repeat(40),sha256:digest(bytes),version:bytes.toString().startsWith('NEW')?'3.0.0':'2.1.0'}});
 fake.spawn.mockImplementation(()=>{
  child=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),exitCode:null,signalCode:null,
   unref:vi.fn(),kill:vi.fn(()=>{child.signalCode='SIGTERM';child.emit('exit',null,'SIGTERM');return true})});
  child.stdin.on('data',(b:Buffer)=>{body+=b.toString('utf8')});
  child.stdin.on('finish',()=>setImmediate(()=>{
   if(mode==='exit'){child.exitCode=1;child.emit('exit',1);return}
   child.stdout.write(mode==='invalid'?'TEST_ONLY_TOKEN\n':JSON.stringify({kind:'ready',releaseId:JSON.parse(body).request.options.manifest.id})+'\n');
  }));return child;
 });
});
afterEach(async()=>{vi.unstubAllEnvs();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true})});
async function fixture(){const f=await nativeMaintenanceFixture();roots.push(f.root);
 const current={applicationData:f.request.applicationData,rootUserData:f.request.rootUserData,packageRoot:f.paths.packageRoot,version:'2.1.0'};
 return {...f,current};
}
it('launches the authenticated staged runtime outside active files, with credentials only in stdin and no forced old-app exit',async()=>{
 const f=await fixture();vi.stubEnv('NODE_OPTIONS','TEST_ONLY_INJECTION');vi.stubEnv('PRIVATE_TEST_VALUE','TEST_ONLY_TOKEN');
 const plan=await prepareNativeMaintenanceLaunch(f.requestFile,f.trust,f.current);
 expect(fake.spawn).not.toHaveBeenCalled();
 const handle=await plan.launch(f.observer),[executable,args,options]=fake.spawn.mock.calls[0];
 expect(executable).toBe(join(f.paths.sourcePackage,'StreamDashboard.exe'));
 expect(args).toEqual([join(f.paths.sourcePackage,'resources/streamcockpit-maintenance.cjs'),'--stdio-v1']);
 expect(options).toMatchObject({shell:false,windowsHide:true,detached:true,env:{ELECTRON_RUN_AS_NODE:'1'}});
 expect(options.env).not.toHaveProperty('NODE_OPTIONS');expect(options.env).not.toHaveProperty('PRIVATE_TEST_VALUE');
 expect(JSON.stringify(fake.spawn.mock.calls)).not.toContain('TEST_ONLY_TOKEN');
 expect(JSON.parse(body)).toMatchObject({schemaVersion:1,parentPid:process.pid,observer:f.observer,
  consent:{action:'prepare',releaseId:f.request.options.manifest.id}});
 expect(JSON.parse(body).request.options).not.toHaveProperty('trust');
 expect(JSON.parse(body).request.options).not.toHaveProperty('runtimeStopped');
 handle.handoff();expect(child.unref).toHaveBeenCalledOnce();expect(child.kill).not.toHaveBeenCalled();
 await expect(plan.launch(f.observer)).rejects.toThrow('ALREADY_REQUESTED');
});
it('can cancel a ready helper before normal app exit without submitting an installation',async()=>{
 const f=await fixture(),plan=await prepareNativeMaintenanceLaunch(f.requestFile,f.trust,f.current),handle=await plan.launch(f.observer);
 handle.cancel();handle.cancel();expect(child.kill).toHaveBeenCalledOnce();expect(()=>handle.handoff()).toThrow('HELPER_NOT_READY');
});
it.each(['packageRoot','rootUserData','applicationData','version']as const)('rejects a substituted installed %s before creating a helper',async key=>{
 const f=await fixture(),current={...f.current,[key]:key==='version'?'9.0.0':join(f.root,'other')};
 await expect(prepareNativeMaintenanceLaunch(f.requestFile,f.trust,current)).rejects.toThrow('INSTALLED_TARGET_MISMATCH');
 expect(fake.spawn).not.toHaveBeenCalled();
});
it.each(['exit','invalid'])('does not claim a handoff when helper reports %s',async value=>{
 const f=await fixture();mode=value;const plan=await prepareNativeMaintenanceLaunch(f.requestFile,f.trust,f.current);
 await expect(plan.launch(f.observer)).rejects.toThrow('HELPER_NOT_READY');
 expect(child.kill).toHaveBeenCalled();
});
it('rejects a helper which exited after ready instead of allowing a false handoff',async()=>{
 const f=await fixture(),plan=await prepareNativeMaintenanceLaunch(f.requestFile,f.trust,f.current),handle=await plan.launch(f.observer);
 child.exitCode=1;child.emit('exit',1);expect(()=>handle.handoff()).toThrow('HELPER_NOT_READY');handle.cancel();
});
