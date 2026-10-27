import {it,expect,afterEach} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {ensureRc117Backup} from '../apps/desktop/src/migration-backup.js';
import {InstallationStore} from '../apps/desktop/src/installation-store.js';
const roots:string[]=[];afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
async function fixture(){const root=await mkdtemp(path.join(os.tmpdir(),'sd-rc117-backup-'));roots.push(root);await mkdir(path.join(root,'device-runtime/config'),{recursive:true});await mkdir(path.join(root,'secure'));await writeFile(path.join(root,'device-role.json'),JSON.stringify({name:'Legacy',role:'control'}));await writeFile(path.join(root,'device-runtime/config/dashboard.json'),' {"unknownFutureField":{"value":42}}\n');await writeFile(path.join(root,'secure/credentials.dat'),Buffer.from([0,255,1,2,3]));return root;}
it('backs up exact legacy data and encrypted bytes before creating the universal identity',async()=>{
 const root=await fixture(),store=new InstallationStore(root),installation=await store.read();
 const backup=path.join(root,'backups/rc117-before-next21');
 for(const relative of ['device-role.json','device-runtime/config/dashboard.json','secure/credentials.dat'])expect(await readFile(path.join(backup,'files',relative))).toEqual(await readFile(path.join(root,relative)));
 const manifest=JSON.parse(await readFile(path.join(backup,'manifest.json'),'utf8'));expect(manifest.files).toHaveLength(3);expect(installation.runtimeProfile).toBe('device-runtime');
 await writeFile(path.join(root,'device-runtime/config/dashboard.json'),'{}');expect(await ensureRc117Backup(root)).toBe(backup);
 expect(await readFile(path.join(backup,'files/device-runtime/config/dashboard.json'),'utf8')).toContain('unknownFutureField');
});
it('refuses a damaged completed backup before writing a new installation',async()=>{
 const root=await fixture(),backup=(await ensureRc117Backup(root))!;await writeFile(path.join(backup,'files/device-role.json'),'{}');
 await expect(new InstallationStore(root).read()).rejects.toThrow('altérée');await expect(readFile(path.join(root,'installation-v2.json'))).rejects.toMatchObject({code:'ENOENT'});
});
it('does not follow a configuration symlink or create a checkpoint for an empty first install',async()=>{
 const root=await fixture();await symlink(path.join(root,'device-role.json'),path.join(root,'device-runtime/config/link.json'));
 await expect(ensureRc117Backup(root)).rejects.toThrow('lien');const empty=await mkdtemp(path.join(os.tmpdir(),'sd-empty-'));roots.push(empty);expect(await ensureRc117Backup(empty)).toBeUndefined();
});
