import ts from 'typescript';
import path from 'node:path';
import {readFile,mkdir,copyFile,writeFile,rm,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const root=path.resolve('apps'), destination=path.resolve('.build/public');
const selected=new Set();
function resolveAsset(from,value){
  if(!value||value.startsWith('#')||/^(data:|https?:|blob:|ws:|wss:)/.test(value))return;
  const clean=value.split(/[?#]/)[0];
  const result=clean.startsWith('/')?path.resolve(root,clean.startsWith('/mobile/')?clean.slice(1):'web'+clean):path.resolve(path.dirname(from),clean);
  if(!result.startsWith(root+path.sep))throw new Error('Asset outside application: '+value);
  return result;
}
async function collect(file){
  if(selected.has(file))return;
  selected.add(file);const bytes=await readFile(file),text=bytes.toString();
  const links=[];
  if(file.endsWith('.js')){
    const source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
    const visit=node=>{
      if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier))links.push(node.moduleSpecifier.text);
      if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword&&node.arguments[0]&&ts.isStringLiteral(node.arguments[0]))links.push(node.arguments[0].text);
      ts.forEachChild(node,visit);
    };visit(source);
  }
  if(file.endsWith('.html'))for(const match of text.matchAll(/(?:src|href)=["']([^"']+)["']/g))links.push(match[1]);
  if(file.endsWith('.css'))for(const match of text.matchAll(/(?:url\(\s*["']?|@import\s+["'])([^"')\s;]+)["']?\)?/g))links.push(match[1]);
  for(const link of links){if(!link.startsWith('.')&&!link.startsWith('/')&&!/\.(js|css|png|html|woff2?)(?:$|[?#])/.test(link))continue;const resolved=resolveAsset(file,link);if(resolved)await collect(resolved);}
}
for(const entry of ['mobile/control/index.html','mobile/control/native-executor.html','web/overlay/timer/index.html','web/index.html','mobile/icon-192.png','mobile/icon-512.png'])await collect(path.join(root,entry));
const includeLegacy=process.argv.includes('--include-legacy')||process.env.SD_INCLUDE_LEGACY_UI==='1';
if(includeLegacy){
  const walk=async dir=>{for(const entry of await readdir(dir,{withFileTypes:true})){const full=path.join(dir,entry.name);if(entry.isDirectory())await walk(full);else if(!full.endsWith('.d.ts')&&!full.endsWith('control-sw.js'))selected.add(full);}};
  await walk(path.join(root,'mobile'));await walk(path.join(root,'web'));
}
const paths=[...selected].filter(file=>file.includes(path.sep+'mobile'+path.sep)).map(file=>'/'+path.relative(root,file).split(path.sep).join('/')).sort();
const version=JSON.parse(await readFile('package.json','utf8')).version;
const signature=createHash('sha256');for(const file of [...selected].sort())signature.update(await readFile(file));
const cache='streamdashboard-control-'+version+'-'+signature.digest('hex').slice(0,12);
const worker=`// Generated from the production entry graph. Never cache APIs or credentials.\nconst CACHE=${JSON.stringify(cache)},FILES=${JSON.stringify(paths)},ALLOWED=new Set(FILES);\nself.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES)).then(()=>self.skipWaiting())));\nself.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>(key.startsWith('streamdashboard-control-')||key.startsWith('streamdashboard-mobile-'))&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));\nself.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin||url.search)return;const pathname=url.pathname==='/mobile/control/'?'/mobile/control/index.html':url.pathname;if(!ALLOWED.has(pathname))return;event.respondWith(caches.open(CACHE).then(async cache=>{const saved=await cache.match(pathname);return saved||fetch(event.request);}));});\n`;
await writeFile(path.join(root,'mobile/control-sw.js'),worker);
selected.add(path.join(root,'mobile/control-sw.js'));
await rm(destination,{recursive:true,force:true});
const manifest=[];
for(const file of [...selected].sort()){
  const relative=path.relative(root,file),target=path.join(destination,relative);
  await mkdir(path.dirname(target),{recursive:true});await copyFile(file,target);
  manifest.push({path:relative.split(path.sep).join('/'),sha256:createHash('sha256').update(await readFile(file)).digest('hex')});
}
if(!includeLegacy){
  const redirect='<!doctype html><html lang="fr"><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=/mobile/control/"><title>StreamDashboard</title><a href="/mobile/control/">Ouvrir StreamDashboard</a></html>';
  for(const file of ['mobile/index.html']){const target=path.join(destination,file);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,redirect);manifest.push({path:file,sha256:createHash('sha256').update(redirect).digest('hex')});}
}
await writeFile(path.join(destination,'manifest.json'),JSON.stringify({version,profile:includeLegacy?'compatibility':'production',files:manifest},null,2)+'\n');
console.log('Public assets: '+manifest.length+' files ('+(includeLegacy?'compatibility':'production')+'), declarations and unused previews excluded from production.');
