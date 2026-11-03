import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024}).trim();
export function streamCockpitBuildInfo(){
  const sourceCommit=git(['rev-parse','--verify','HEAD']);
  if(!/^[a-f0-9]{40}$/.test(sourceCommit))throw Error('SC3_BUILD_SOURCE_COMMIT_INVALID');
  const paths=git(['ls-files','-z','--','apps','integrations','packages','scripts','resources','package.json','package-lock.json','forge.config.cjs','tsconfig.json','tsconfig.runtime.json','tsconfig.browser-js.json']).split('\0').filter(Boolean).sort();
  const hash=createHash('sha256');
  for(const file of paths){hash.update(file+'\0');hash.update(readFileSync(resolve(root,file)))}
  return {schemaVersion:1,product:'Le StreamCockpit',version:JSON.parse(readFileSync(resolve(root,'package.json'),'utf8')).version,
    sourceCommit,sourceTreeSha256:hash.digest('hex'),sourceTreeDirty:git(['status','--porcelain=v1','--untracked-files=normal'])!==''};
}
