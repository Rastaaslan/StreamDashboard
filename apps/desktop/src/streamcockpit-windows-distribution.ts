import {lstat,realpath} from 'node:fs/promises';
import {basename,dirname,join,resolve} from 'node:path';
/** Read only. An app-version Squirrel installation must never be treated as
 * a portable folder by the existing copy/swap maintenance path. */
export async function windowsDistribution(packageRoot:string):Promise<'directory'|'squirrel'>{
 const root=resolve(packageRoot),parent=dirname(root);
 for(const file of [join(parent,'Update.exe'),join(parent,'packages','RELEASES')]){
  try{
   const stat=await lstat(file);
   if(!stat.isFile()||stat.isSymbolicLink()||resolve(await realpath(file)).toLowerCase()!==file.toLowerCase())
    throw Error('SC3_DISTRIBUTION_UNVERIFIED');
   return 'squirrel';
  }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
 }
 if(/^app-\d/i.test(basename(root)))throw Error('SC3_DISTRIBUTION_UNVERIFIED');
 return 'directory';
}
