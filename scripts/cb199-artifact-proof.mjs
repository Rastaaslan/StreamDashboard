import {readdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const [directory,output]=process.argv.slice(2);
if(!directory||!output)throw new Error('Usage: node scripts/cb199-artifact-proof.mjs CANDIDATE_DIR MANIFEST_OUTSIDE_CANDIDATE');
const root=path.resolve(directory);
if(path.resolve(output).startsWith(root+path.sep))throw new Error('Manifest must stay outside the candidate directory.');
async function walk(relative=''){
 const rows=[];
 for(const entry of (await readdir(path.join(root,relative),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
  const name=path.posix.join(relative,entry.name);if(entry.isSymbolicLink())throw new Error('Artifact symlink refused');
  if(entry.isDirectory())rows.push(...await walk(name));else{const bytes=await readFile(path.join(root,name));rows.push({path:name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
 }
 return rows;
}
const manifest=JSON.parse(await readFile('package.json','utf8'));
await writeFile(output,JSON.stringify({version:manifest.version,created:new Date().toISOString(),distributed:false,files:await walk()},null,2)+'\n');
