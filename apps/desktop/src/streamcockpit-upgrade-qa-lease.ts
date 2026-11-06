import {randomUUID} from 'node:crypto';
import {open,lstat,readFile,realpath,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename,dirname,join,resolve} from 'node:path';

/**
 * Lab-only cross-process admission gate for a detached QA upgrade.
 * This is NOT a host-writer pause: unregistered writers and installed apps
 * are outside its coverage. An orphaned lock always needs manual inspection.
 */
const fail=(code:string)=>new Error('SC3_QA_LEASE_'+code);
export async function withExclusiveQaUpgradeLease<T>(
  workspace:string,operation:()=>Promise<T>,
):Promise<T>{
  const root=resolve(workspace),temp=resolve(tmpdir());
  if(dirname(root)!==temp||!basename(root).startsWith('sc3-upgrade-qa-')||
    basename(root).length>120)throw fail('WORKSPACE_DENIED');
  const rootStat=await lstat(root);
  if(!rootStat.isDirectory()||rootStat.isSymbolicLink()||await realpath(root)!==root)
    throw fail('WORKSPACE_DENIED');
  const lock=join(root,'upgrade-qa-exclusive.lock');
  const token=randomUUID();
  let handle;
  try{handle=await open(lock,'wx',0o600)}
  catch(error){
    if((error as NodeJS.ErrnoException).code==='EEXIST')throw fail('ALREADY_OWNED');
    throw error;
  }
  // An uncertain lock write must leave evidence for supervised recovery.
  try{await handle.writeFile(token,'utf8');await handle.sync()}
  finally{await handle.close()}
  const owned=await lstat(lock);
  if(!owned.isFile()||owned.isSymbolicLink()||owned.nlink!==1||
    await readFile(lock,'utf8')!==token)throw fail('OWNERSHIP_UNCERTAIN');
  let completed=false;
  try{
    const result=await operation();
    completed=true;
    return result;
  }finally{
    // Never silently reclaim a lock after an incomplete migration or when a
    // different process replaced it. Crash recovery is intentionally manual.
    if(completed){
      const current=await lstat(lock);
      if(!current.isFile()||current.isSymbolicLink()||current.ino!==owned.ino||
        current.nlink!==1||await readFile(lock,'utf8')!==token)
        throw fail('OWNERSHIP_UNCERTAIN');
      await unlink(lock);
    }
  }
}
