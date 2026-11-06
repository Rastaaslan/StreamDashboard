import {afterEach,expect,it,vi} from 'vitest';
import {spawn,type ChildProcess} from 'node:child_process';
import {mkdtemp,mkdir,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {startWithRuntimeUpgradeOwnership,runtimeUpgradeDirectory} from '../apps/desktop/src/streamcockpit-runtime-ownership.js';
import {SqliteUpgradeJournal} from '../apps/desktop/src/streamcockpit-upgrade-journal.js';
import {createDurableDesktopUpgradePlanner} from '../apps/desktop/src/streamcockpit-upgrade.js';
import {createWindowsDirectoryUpgradePlanner} from '../apps/desktop/src/streamcockpit-upgrade-directory.js';
import type {UpgradeManifest} from '../packages/core/src/streamcockpit-upgrade.js';

const roots:string[]=[],children:ChildProcess[]=[];
const onWindows=process.platform==='win32'?it:it.skip;
const manifest:UpgradeManifest={id:'runtime-exclusion',version:'3.0.0',fromVersion:'2.1.0',target:'desktop',
 source:'https://example.test/unused',sha256:'a'.repeat(64),signature:{keyId:'test',value:'SYNTHETIC'},schema:{from:1,to:1}};
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(yes=>{resolve=yes});return{promise,resolve}};
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'sc3-runtime-ownership-'));roots.push(root);
 const directory=join(root,'journal');await mkdir(directory);return{root,directory,store:new SqliteUpgradeJournal(directory)};
}
afterEach(async()=>{
 for(const child of children.splice(0))if(child.exitCode===null&&child.signalCode===null){
  const exited=new Promise<void>(yes=>child.once('close',()=>yes()));child.kill();await exited;
 }
 for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});
});
function child(mode:string,root:string){
 const proc=spawn(process.execPath,['--import','tsx',resolve('tests/fixtures/streamcockpit3-runtime-ownership-process.ts'),mode,root],
  {cwd:process.cwd(),windowsHide:true,stdio:['pipe','pipe','pipe']});children.push(proc);
 let output='',error='';proc.stdout!.on('data',data=>{output+=String(data)});proc.stderr!.on('data',data=>{error+=String(data)});
 const exit=new Promise<number|null>((yes,no)=>{proc.once('error',no);proc.once('close',yes)});
 return{proc,exit,output:()=>output,wait:async(text:string)=>{
  await vi.waitFor(()=>{if(proc.exitCode!==null)throw Error(error+'\n'+output);expect(output).toContain(text)},{timeout:15000,interval:25});
 },send:(text:string)=>proc.stdin!.write(text+'\n')};
}
function planner(directory:string){
 const effects={verify:vi.fn(async()=>true),stage:vi.fn(async()=>({reference:'stage'})),
  backup:vi.fn(async()=>({reference:'backup'})),migrate:vi.fn(async()=>({reference:'migration'})),
  install:vi.fn(async()=>({reference:'installed'})),rollback:vi.fn(async()=>({reference:'restored'})),reconcile:vi.fn(async()=>undefined)};
 return {effects,value:createDurableDesktopUpgradePlanner(directory,effects,{assessRestartSafety:async()=>({safe:true})})};
}
onWindows('serializes startup, all accepted shutdown work and subsequent maintenance with the same real SQLite mutex',async()=>{
 const f=await fixture(),opening=deferred(),draining=deferred();let entered=false;
 const starting=startWithRuntimeUpgradeOwnership(f.directory,'2.1.0',async()=>{entered=true;await opening.promise;return {stop:()=>draining.promise}});
 try{
  await vi.waitFor(()=>expect(entered).toBe(true));
  await expect(f.store.exclusive(async()=>undefined)).rejects.toThrow('BUSY');
  opening.resolve();const runtime=await starting;
  const competing=planner(f.directory);
  await expect(competing.value.register(manifest,'not-executed')).rejects.toThrow('BUSY');
  expect(competing.effects.stage).not.toHaveBeenCalled();
  const stopping=runtime.stop();expect(runtime.stop()).toBe(stopping);
  await expect(f.store.exclusive(async()=>undefined)).rejects.toThrow('BUSY');
  draining.resolve();await stopping;
  await expect(competing.value.register(manifest,'not-executed')).resolves.toMatchObject({phase:'downloaded'});
 }finally{opening.resolve();draining.resolve();await(await starting).stop()}
});
onWindows.each(['stage','backup','migrate','install','rollback']as const)('refuses boot with pending %s without rewriting or replaying the upgrade',async operation=>{
 const f=await fixture(),p=planner(f.directory);await p.value.register(manifest,'fixture');
 await f.store.exclusive(async()=>{const saved=(await f.store.read())!;saved.pending={operation,key:manifest.id+':'+operation};await f.store.write(saved)});
 const file=join(f.directory,'streamcockpit-upgrade-journal.sqlite'),before=await readFile(file),start=vi.fn(async()=>({stop:async()=>undefined}));
 await expect(startWithRuntimeUpgradeOwnership(f.directory,'2.1.0',start)).rejects.toThrow('RECOVERY_REQUIRED');
 expect(start).not.toHaveBeenCalled();expect(await readFile(file)).toEqual(before);
});
onWindows('enforces the completed target version and the restored version before starting a runtime',async()=>{
 const f=await fixture(),p=planner(f.directory);await p.value.register(manifest,'fixture');await p.value.install();
 const start=vi.fn(async()=>({stop:async()=>undefined}));
 await expect(startWithRuntimeUpgradeOwnership(f.directory,'2.1.0',start)).rejects.toThrow('VERSION_MISMATCH');
 const updated=await startWithRuntimeUpgradeOwnership(f.directory,'3.0.0',start);await updated.stop();
 await p.value.rollback();
 await expect(startWithRuntimeUpgradeOwnership(f.directory,'3.0.0',start)).rejects.toThrow('VERSION_MISMATCH');
 const restored=await startWithRuntimeUpgradeOwnership(f.directory,'2.1.0',start);await restored.stop();
 expect(start).toHaveBeenCalledTimes(2);
});
onWindows('blocks the actual directory-upgrade factory even when its injected stopped flag wrongly says true',async()=>{
 const f=await fixture(),entry={path:'synthetic',bytes:1,sha256:'a'.repeat(64)};
 const expectation=(version:string)=>({identity:{version,revision:'b'.repeat(40),applicationId:'fixture',signer:'SYNTHETIC'},packageFiles:[entry],profileFiles:[entry]});
 const prep={stage:vi.fn(async()=>({reference:'unused'})),verify:vi.fn(async()=>true),backup:vi.fn(async()=>({reference:'unused'})),migrate:vi.fn(async()=>({reference:'unused'}))};
 const directory=createWindowsDirectoryUpgradePlanner({manifest,journalDirectory:f.directory,
  packageRoot:join(f.root,'app'),profileRoot:join(f.root,'profile'),preparedPackage:join(f.root,'prepared-app'),preparedProfile:join(f.root,'prepared-profile'),
  backupPackage:join(f.root,'backup-app'),backupProfile:join(f.root,'backup-profile'),target:expectation('3.0.0'),rollback:expectation('2.1.0'),
  runtimeStopped:async()=>true,attestInstalled:async()=>undefined},prep,{assessRestartSafety:async()=>({safe:true})});
 await directory.register(manifest,'fixture');
 const runtime=await startWithRuntimeUpgradeOwnership(f.directory,'2.1.0',async()=>({stop:async()=>undefined}));
 try{await expect(directory.install()).rejects.toThrow('BUSY');expect(prep.stage).not.toHaveBeenCalled()}
 finally{await runtime.stop()}
});
onWindows('excludes a real HTTP child runtime, including the interval after listener close but before full stop completion',async()=>{
 const f=await fixture(),running=child('runtime',f.root);await running.wait('READY http://127.0.0.1:');
 const url=running.output().match(/READY (http:\/\/127\.0\.0\.1:\d+)/)![1]!;
 expect((await fetch(url+'/')).ok).toBe(true);
 await expect(f.store.exclusive(async()=>undefined)).rejects.toThrow('BUSY');
 running.send('stop');await running.wait('DRAINED');
 await expect(f.store.exclusive(async()=>undefined)).rejects.toThrow('BUSY');
 running.send('release');expect(await running.exit).toBe(0);
 await expect(f.store.exclusive(async()=>true)).resolves.toBe(true);
},20000);
onWindows('refuses startup while an independent maintenance process owns the installation',async()=>{
 const f=await fixture(),maintenance=child('maintenance',f.root);await maintenance.wait('READY');
 const start=vi.fn(async()=>({stop:async()=>undefined}));
 await expect(startWithRuntimeUpgradeOwnership(f.directory,'2.1.0',start)).rejects.toThrow('BUSY');
 expect(start).not.toHaveBeenCalled();maintenance.send('release');expect(await maintenance.exit).toBe(0);
 const runtime=await startWithRuntimeUpgradeOwnership(f.directory,'2.1.0',start);await runtime.stop();
},20000);
onWindows.each(['fail-start','fail-stop'])('retains exclusion after %s until that isolated process exits',async mode=>{
 const f=await fixture(),failed=child(mode,f.root);await failed.wait('FAILED_HELD');
 await expect(f.store.exclusive(async()=>undefined)).rejects.toThrow('BUSY');
 failed.send('release');expect(await failed.exit).toBe(0);
 await expect(f.store.exclusive(async()=>true)).resolves.toBe(true);
},20000);
onWindows('OS release after real child-process exit does not reset the durable upgrade journal',async()=>{
 const f=await fixture(),p=planner(f.directory);await p.value.register(manifest,'fixture');
 const before=await f.store.exclusive(()=>f.store.read());
 const runtime=child('runtime',f.root);await runtime.wait('READY');runtime.send('crash');expect(await runtime.exit).toBe(71);
 expect(await f.store.exclusive(()=>f.store.read())).toEqual(before);
},20000);
onWindows('uses a version-independent coordinator outside root profile and rejects unsafe roots and versions',async()=>{
 const f=await fixture();
 const coord=runtimeUpgradeDirectory(join(f.root,'app-data'),join(f.root,'profile'));
 expect(coord).toContain('StreamCockpit-maintenance');
 expect(coord.startsWith(join(f.root,'profile'))).toBe(false);
 expect(runtimeUpgradeDirectory(join(f.root,'app-data'),join(f.root,'PROFILE'))).toBe(coord);
 for(const bad of ['relative','\\\\server\\share','C:\\temp:stream'])expect(()=>runtimeUpgradeDirectory(bad,f.root)).toThrow('PATH_INVALID');
 await expect(startWithRuntimeUpgradeOwnership(f.directory,'invalid',async()=>({stop:async()=>undefined}))).rejects.toThrow('VERSION_INVALID');
});
