import {mkdir,readdir,lstat,readFile,writeFile,copyFile,rename,open} from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

interface Entry {path:string;bytes:number;sha256:string}
interface Backup {format:'StreamDashboard-RC11.7-backup';version:1;createdAt:string;files:Entry[]}
const digest=(data:Buffer)=>createHash('sha256').update(data).digest('hex');
const absent=(error:unknown)=>(error as NodeJS.ErrnoException).code==='ENOENT';
const roots=['device-role.json','migration-receipt.json','config','secure','device-runtime/config','device-runtime/secure'];
const relativeFile=(name:string)=>typeof name==='string'&&name.length<500&&!/[\\:\x00]/.test(name)&&!name.split('/').some(part=>!part||part==='.'||part==='..')&&!path.isAbsolute(name);
async function inspect(root:string,relative:string,found:string[]){
 const file=path.join(root,relative);let stat;
 try{stat=await lstat(file);}catch(error){if(absent(error))return;throw error;}
 if(stat.isSymbolicLink())throw Error('Sauvegarde RC11.7 : lien de fichier inattendu. Aucune migration appliquée.');
 if(stat.isDirectory())for(const name of await readdir(file))await inspect(root,relative+'/'+name,found);
 else if(stat.isFile()){if(found.length>=10000)throw Error('Trop de fichiers de configuration à sauvegarder.');found.push(relative);}
}
/** Immutable, byte-exact configuration and encrypted-identity checkpoint made
 * before the new topology is created. No browser database or audio is migrated:
 * those continue to use their original profile and paths. */
export async function ensureRc117Backup(directory:string):Promise<string|undefined>{
 const target=path.join(directory,'backups','rc117-before-next21'),manifestFile=path.join(target,'manifest.json');
 let existing:Backup|undefined;
 try{existing=JSON.parse(await readFile(manifestFile,'utf8'));}catch(error){if(!absent(error))throw error;}
 if(existing){
  if(existing.format!=='StreamDashboard-RC11.7-backup'||existing.version!==1||!Array.isArray(existing.files)||!existing.files.length||existing.files.length>10000)throw Error('Sauvegarde RC11.7 incompatible. Conservez les fichiers avant de poursuivre.');
  await inspect(target,'files',[]);
  for(const entry of existing.files){if(!relativeFile(entry.path))throw Error('Chemin de sauvegarde invalide.');const file=path.join(target,'files',entry.path);if((await lstat(file)).isSymbolicLink())throw Error('Lien dans la sauvegarde RC11.7.');const bytes=await readFile(file);if(bytes.length!==entry.bytes||digest(bytes)!==entry.sha256)throw Error('Sauvegarde RC11.7 altérée. Aucune migration appliquée.');}
  return target;
 }
 const names:string[]=[];for(const root of roots)await inspect(directory,root,names);
 if(!names.length)return;
 const staging=target+'.pending-'+randomUUID();await mkdir(staging,{recursive:true,mode:0o700});
 const files:Entry[]=[];
 for(const name of names.sort()){
  const source=path.join(directory,name),bytes=await readFile(source),destination=path.join(staging,'files',name);
  await mkdir(path.dirname(destination),{recursive:true,mode:0o700});await copyFile(source,destination);
  const copied=await readFile(destination);if(digest(copied)!==digest(bytes))throw Error('Les données RC11.7 changent pendant la sauvegarde. Fermez leur application avant de réessayer.');
  const handle=await open(destination,'r+');try{await handle.sync();}finally{await handle.close();}
  files.push({path:name,bytes:bytes.length,sha256:digest(bytes)});
 }
 // Confirm the snapshot as a whole before advertising it as complete.
 const after:string[]=[];for(const root of roots)await inspect(directory,root,after);
 if(JSON.stringify(after.sort())!==JSON.stringify(names))throw Error('La liste des fichiers RC11.7 a changé. Sauvegarde non validée.');
 for(const entry of files)if(digest(await readFile(path.join(directory,entry.path)))!==entry.sha256)throw Error('Configuration RC11.7 modifiée pendant la sauvegarde. Aucune migration appliquée.');
 const manifest:Backup={format:'StreamDashboard-RC11.7-backup',version:1,createdAt:new Date().toISOString(),files};
 await writeFile(path.join(staging,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
 const handle=await open(path.join(staging,'manifest.json'),'r+');try{await handle.sync();}finally{await handle.close();}
 await rename(staging,target);return target;
}
