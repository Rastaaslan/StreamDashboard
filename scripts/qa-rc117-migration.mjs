// Read-only audit of a real legacy profile. All migration writes target a new
// temporary copy on the same machine. Never starts Electron, OBS or providers.
import {mkdtemp,mkdir,readdir,lstat,readFile,writeFile,copyFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {InstallationStore} from '../dist/apps/desktop/src/installation-store.js';
const source=process.argv[2];
if(!source||!path.isAbsolute(source)||path.basename(source)!=='StreamDashboard-Next')throw Error('Explicit absolute RC11.7 profile path required.');
try{await lstat(path.join(source,'installation-v2.json'));throw Error('This profile already contains a Next 2.1 installation.');}catch(error){if(error.code!=='ENOENT')throw error;}
const roots=['device-role.json','migration-receipt.json','config','secure','device-runtime/config','device-runtime/secure'];
const hash=data=>createHash('sha256').update(data).digest('hex');
const directory=await mkdtemp(path.join(os.tmpdir(),'streamdashboard-rc117-audit-')),copy=path.join(directory,'profile'),entries=[];
async function capture(relative){
 const file=path.join(source,relative);let stat;try{stat=await lstat(file);}catch(error){if(error.code==='ENOENT')return;throw error;}
 if(stat.isSymbolicLink())throw Error('Profile contains a link; audit stopped.');
 if(stat.isDirectory()){for(const name of await readdir(file))await capture(relative+'/'+name);return;}
 if(!stat.isFile())return;const bytes=await readFile(file),destination=path.join(copy,relative);await mkdir(path.dirname(destination),{recursive:true});await copyFile(file,destination);
 if(hash(await readFile(destination))!==hash(bytes))throw Error('Profile changed during snapshot.');entries.push({path:relative,bytes:bytes.length,sha256:hash(bytes)});
}
for(const root of roots)await capture(root);
if(!entries.some(entry=>entry.path==='device-role.json'))throw Error('No legacy role file found.');
const store=new InstallationStore(copy),before=await store.read(),device=before.devices.find(value=>value.id===before.localDeviceId);
const roles=device.roles.includes('obs-executor')?device.roles.filter(value=>value!=='obs-executor'):[...device.roles,'obs-executor'];
const changed=await store.change({roles,preset:'custom'},before.revision,async()=>{}),restored=await store.restore(changed.next.revision,async()=>{});
const reopened=await new InstallationStore(copy).read();
const identityPersistent=reopened.localDeviceId===before.localDeviceId&&reopened.runtimeProfile===before.runtimeProfile;
const rolesRoundTrip=JSON.stringify(restored.next.devices)===JSON.stringify(before.devices);
const backup=path.join(copy,'backups','rc117-before-next21');let originalsUnchanged=true,copyUnchanged=true,backupExact=true;
for(const entry of entries){
 originalsUnchanged&&=hash(await readFile(path.join(source,entry.path)))===entry.sha256;
 copyUnchanged&&=hash(await readFile(path.join(copy,entry.path)))===entry.sha256;
 backupExact&&=hash(await readFile(path.join(backup,'files',entry.path)))===entry.sha256;
}
const report={date:new Date().toISOString(),machine:os.hostname(),scope:'configuration-copy-and-topology-migration',directory,files:entries.length,bytes:entries.reduce((sum,entry)=>sum+entry.bytes,0),runtimeProfile:before.runtimeProfile,identityPersistent,rolesRoundTrip,originalsUnchanged,copyUnchanged,backupExact,passed:identityPersistent&&rolesRoundTrip&&originalsUnchanged&&copyUnchanged&&backupExact,externalEffects:false,limits:['No Electron/browser database migration or authenticated provider startup','No live, OBS command or real chat effect','No complete hardware topology qualification']};
await writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
