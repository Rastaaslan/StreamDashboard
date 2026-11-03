import {readFile,readdir} from 'node:fs/promises';
import {resolve,relative,sep} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const matrix=JSON.parse(await readFile(resolve(root,'docs/streamcockpit-3/feature-matrix.json'),'utf8'));
const deferred=matrix.releaseScope?.deferred;
if(!Array.isArray(deferred)||!deferred.some(x=>x.id==='CLIPFORGE'&&x.targetVersion==='4.0'&&x.productionEnabled===false)||
  !deferred.some(x=>x.id==='SC31-LAYOUT-001'&&x.targetVersion==='3.1'))
  throw Error('SC3_RELEASE_SCOPE_INVALID');
const f04=matrix.features.find(x=>x.id==='F04');
if(!f04||/clipforge|ffmpeg|vertical/i.test(f04.acceptance))throw Error('SC3_F04_MUST_EXCLUDE_VIDEO_PROCESSING');
async function walk(dir){
  const files=[];
  for(const item of await readdir(dir,{withFileTypes:true})){
    const file=resolve(dir,item.name);
    if(item.isDirectory())files.push(...await walk(file));else files.push(file);
  }
  return files;
}
if(process.argv.includes('--built')){
  for(const file of await walk(resolve(root,'dist'))){
    const path=relative(root,file).split(sep).join('/');
    if(/streamcockpit-clipforge/i.test(path))throw Error('SC3_DEFERRED_RUNTIME_SHIPPED: '+path);
    if(/\.[cm]?js$/.test(file)&&/from\s*['"][^'"]*streamcockpit-clipforge/i.test(await readFile(file,'utf8')))
      throw Error('SC3_DEFERRED_RUNTIME_IMPORTED: '+path);
  }
  for(const file of await walk(resolve(root,'.build/public'))){
    if(/\.(?:js|html)$/.test(file)&&/clipforge/i.test(await readFile(file,'utf8')))
      throw Error('SC3_DEFERRED_UI_SHIPPED: '+relative(root,file));
  }
}
console.log('3.0 scope PASS: F00–F10 retained; ClipForge V4 and modular layout V3.1 deferred'+(process.argv.includes('--built')?'; production JavaScript/UI checked.':'.'));
