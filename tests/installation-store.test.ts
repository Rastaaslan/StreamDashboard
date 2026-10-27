import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { InstallationStore } from '../apps/desktop/src/installation-store.js';
const dirs: string[]=[];
afterEach(async()=>{await Promise.all(dirs.splice(0).map(p=>rm(p,{recursive:true,force:true})));});
it('migrates RC11.7 once and keeps its local identity and original profile after OBS role changes',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'sd-installation-'));dirs.push(dir);
  const legacy=JSON.stringify({version:1,role:'control',name:'Existing'});
  await writeFile(path.join(dir,'device-role.json'),legacy);
  const store=new InstallationStore(dir),initial=await store.read();
  expect(initial.runtimeProfile).toBe('device-runtime');
  expect((await store.read()).localDeviceId).toBe(initial.localDeviceId);
  const changed=await store.change({roles:['controller','services','obs-executor'],preset:'single-pc'},0,async()=>{});
  expect(changed.restart).toBe(true);expect(changed.next.runtimeProfile).toBe('device-runtime');
  expect(await readFile(path.join(dir,'device-role.json'),'utf8')).toBe(legacy);
  const restored=await store.restore(1,async()=>{});expect(restored.next.devices).toEqual(initial.devices);
});
it('serializes simultaneous writers and checks real restart safety before any commit',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'sd-installation-'));dirs.push(dir);
  const store=new InstallationStore(dir);await store.read();
  await expect(store.change({roles:['controller']},0,async()=>{throw Error('OBS active');})).rejects.toThrow('OBS active');
  expect((await store.read()).revision).toBe(0);
  await store.recover(async()=>{});
  const results=await Promise.allSettled([store.change({name:'A'},0,async()=>{}),store.change({name:'B'},0,async()=>{})]);
  expect(results.map(r=>r.status)).toEqual(['fulfilled','rejected']);
  expect((await store.read()).devices[0].name).toBe('A');
});

it('concurrent first readers share one durable identity and independent snapshots',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'sd-installation-'));dirs.push(dir);
 const store=new InstallationStore(dir,'control');
 const values=await Promise.all(Array.from({length:12},()=>store.read()));
 expect(new Set(values.map(v=>v.localDeviceId)).size).toBe(1);
 expect(values[0].runtimeProfile).toBe('device-runtime');
 values[0].devices[0].name='Changed locally';
 expect(values[1].devices[0].name).not.toBe('Changed locally');
 expect((await store.read()).localDeviceId).toBe(values[0].localDeviceId);
});

for (const committed of [false,true]) it(`recovers a ${committed?'committed':'interrupted'} change with the original identity`,async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'sd-transition-'));dirs.push(dir);
 const store=new InstallationStore(dir,'control'),before=await store.read();
 const next={...structuredClone(before),revision:1,startAtLogin:true,preset:'custom'};
 await writeFile(store.file+'.pending',JSON.stringify({version:1,before,next,backupBefore:null}));
 if(committed)await writeFile(store.file,JSON.stringify(next));
 const effects:boolean[]=[];const recovered=await new InstallationStore(dir).recover(async value=>{effects.push(!!value.startAtLogin);});
 expect(effects).toEqual([committed]);expect(recovered.localDeviceId).toBe(before.localDeviceId);expect(recovered.runtimeProfile).toBe('device-runtime');
 await expect(readFile(store.file+'.pending')).rejects.toMatchObject({code:'ENOENT'});
 await store.recover(async()=>{throw Error('No transition should remain');});
});
it('keeps failed recovery retryable and refuses to overwrite the pending transition',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'sd-transition-'));dirs.push(dir);
 const store=new InstallationStore(dir);await store.read();
 await expect(store.change({startAtLogin:true},0,async()=>{throw Error('OS unavailable');})).rejects.toThrow('OS unavailable');
 await expect(store.recover(async()=>{throw Error('OS still unavailable');})).rejects.toThrow('OS still unavailable');
 await expect(store.change({name:'Should not overwrite'},0,async()=>{})).rejects.toThrow('transition interrompue');
 expect((await store.read()).revision).toBe(0);await store.recover(async()=>{});
 expect((await store.change({name:'Recovered'},0,async()=>{})).next.revision).toBe(1);
});
it('retains the original rollback target after an interrupted restore',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'sd-transition-'));dirs.push(dir);
 const store=new InstallationStore(dir),first=await store.read();
 await store.change({name:'Second'},0,async()=>{});
 await expect(store.restore(1,async()=>{throw Error('interrupted');})).rejects.toThrow('interrupted');
 await store.recover(async()=>{});
 expect(JSON.parse(await readFile(store.file+'.backup','utf8'))).toEqual(first);
 expect((await store.restore(1,async()=>{})).next.devices[0].name).toBe(first.devices[0].name);
});
it('refuses a foreign recovery journal before touching OS settings',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'sd-transition-'));dirs.push(dir);
 const store=new InstallationStore(dir),before=await store.read();
 const next={...structuredClone(before),revision:1};next.devices[0].id='foreign';next.localDeviceId='foreign';next.routes={};
 await writeFile(store.file+'.pending',JSON.stringify({version:1,before,next,backupBefore:null}));
 await expect(store.recover(async()=>{throw Error('Must not reach OS');})).rejects.toThrow('autre installation');
 expect(await store.read()).toEqual(before);
});
