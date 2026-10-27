// Builds a reviewable Windows directory from already installed dependencies and
// an operator-provided Electron archive. Never runs the application or installs it.
import {cp,mkdir,readFile,writeFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {packager} from '@electron/packager';
execFileSync(process.execPath,['scripts/build-proof.mjs','--verify'],{stdio:'inherit'});
const require=createRequire(import.meta.url),config=require('../forge.config.cjs');
const zipDir=process.argv[2];
if(!zipDir)throw new Error('Provide the directory containing the matching Electron win32-x64 ZIP.');
const manifest=JSON.parse(await readFile('package.json','utf8'));
await stat(path.join(zipDir,`electron-v${manifest.devDependencies.electron}-win32-x64.zip`));
const stage=path.resolve('.build/windows-stage-'+Date.now());await mkdir(stage,{recursive:true});
for(const name of ['dist','resources'])await cp(name,path.join(stage,name),{recursive:true,dereference:true});
await mkdir(path.join(stage,'apps'),{recursive:true});
for(const name of ['mobile','web'])await cp('.build/public/'+name,path.join(stage,'apps',name),{recursive:true,dereference:true});
const copied=new Set();
async function dependency(name){
 if(copied.has(name))return;copied.add(name);
 const source=path.resolve('node_modules',name),pkg=JSON.parse(await readFile(path.join(source,'package.json'),'utf8'));
 await cp(source,path.join(stage,'node_modules',name),{recursive:true,dereference:true});
 for(const child of Object.keys(pkg.dependencies||{}))await dependency(child);
}
for(const name of Object.keys(manifest.dependencies))await dependency(name);
await writeFile(path.join(stage,'package.json'),JSON.stringify({...manifest,devDependencies:undefined,scripts:undefined},null,2));
const output=await packager({...config.packagerConfig,dir:stage,out:process.argv[3]||path.resolve('out','cb199-'+Date.now()),platform:'win32',arch:'x64',electronZipDir:path.resolve(zipDir),prune:false});
if(output.length!==1)throw new Error('No new Windows package was produced; choose a new output directory.');
console.log(output.join('\n'));
