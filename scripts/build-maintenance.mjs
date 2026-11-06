import {build} from 'esbuild';
import {mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {resolve,join,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';

/** A plain native-process entry beside app.asar, not a second updater engine.
 * The signed new image supplies its own Electron Node runtime; no system Node
 * installation, network download, key generation or install is performed here. */
export async function buildMaintenance(output=resolve('.build/maintenance')){
 const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
 await mkdir(output,{recursive:true});
 const entry="import {maintenanceMain} from './apps/desktop/src/streamcockpit-maintenance-cli.ts'; void maintenanceMain();";
 const result=await build({stdin:{contents:entry,resolveDir:root,sourcefile:'maintenance-entry.ts'},
  bundle:true,platform:'node',format:'cjs',target:'node22',write:false,metafile:true,
  external:['bufferutil','utf-8-validate'],define:{'process.env.NODE_ENV':'"production"'},
  logLevel:'silent'});
 // Fail packaging instead of shipping an Electron-only or credential-store
 // dependency into the helper's Node process. Built-in node:sqlite is retained.
 if(Object.keys(result.metafile.inputs).some(p=>/secrets\.ts$|main\.ts$|updater\.ts$/.test(p))||
  result.metafile.outputs['<stdout>']?.imports.some(x=>x.path==='electron'))throw Error('MAINTENANCE_BUNDLE_DEPENDENCY_INVALID');
 await writeFile(join(output,'streamcockpit-maintenance.cjs'),result.outputFiles[0].contents);
 const policy=process.env.SC3_MAINTENANCE_TRUST_FILE;
 const target=join(output,'maintenance-trust.json');
 if(policy){
  if(!isAbsolute(policy))throw Error('MAINTENANCE_PUBLIC_POLICY_PATH_INVALID');
  const bytes=await readFile(policy);if(bytes.length>16384)throw Error('MAINTENANCE_PUBLIC_POLICY_INVALID');
  const t=JSON.parse(bytes.toString('utf8'));
  if(!t||Object.keys(t).sort().join('|')!=='applicationId|keyId|publicKeyPem|sourceOrigin|windowsSigner'||
   typeof t.publicKeyPem!=='string'||!t.publicKeyPem.startsWith('-----BEGIN PUBLIC KEY-----')||
   !/^[A-F0-9]{40}$/.test(t.windowsSigner))throw Error('MAINTENANCE_PUBLIC_POLICY_INVALID');
  await writeFile(target,JSON.stringify(t,null,2)+'\n');
 }else await rm(target,{force:true}); // Generated staging only; no installed trust is touched.
 return {entry:join(output,'streamcockpit-maintenance.cjs'),productionPolicyIncluded:Boolean(policy)};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const result=await buildMaintenance();console.log('Maintenance entry built; public production policy included: '+result.productionPolicyIncluded);
}
