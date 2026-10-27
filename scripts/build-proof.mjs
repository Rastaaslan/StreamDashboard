import {createHash} from 'node:crypto';
import {readFile,readdir,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
async function files(root){const out=[];for(const entry of await readdir(root,{withFileTypes:true})){const file=path.join(root,entry.name);if(entry.isDirectory())out.push(...await files(file));else if(/\.(?:[cm]?js|ts|cts|json|css|html|png|ico|b64)$/.test(file))out.push(file);}return out;}
const inputs=['package.json','package-lock.json','forge.config.cjs','tsconfig.json','tsconfig.runtime.json','tsconfig.browser-js.json',...(await Promise.all(['apps','packages','integrations','scripts','resources'].map(files))).flat()].sort();
const hash=createHash('sha256');for(const file of inputs){hash.update(file+'\0');hash.update(await readFile(file));}
const sourceHash=hash.digest('hex'),file='.build/build-proof.json';
const outputFiles=[],outputs=createHash('sha256');for(const output of (await Promise.all(['dist','.build/public'].map(files))).flat().sort()){const bytes=await readFile(output);outputs.update(output+'\0');outputs.update(bytes);outputFiles.push({path:output,sha256:createHash('sha256').update(bytes).digest('hex')});}
const outputHash=outputs.digest('hex');
if(process.argv.includes('--verify')){
  const saved=JSON.parse(await readFile(file));if(saved.sourceHash!==sourceHash||saved.outputHash!==outputHash)throw new Error('Sources changed since build. Run npm run build before packaging.');
  console.log('Build proof matches current sources.');
}else{await mkdir('.build',{recursive:true});await writeFile(file,JSON.stringify({sourceHash,outputHash,outputs:outputFiles,createdAt:new Date().toISOString()},null,2)+'\n');}
