import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {cp,mkdir,readFile,rename,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {nativeMaintenanceFixture,digest} from './streamcockpit-maintenance-fixture.js';
import {directoryReleaseImageHash,directoryReleaseSigningPayload,type SignedDirectoryImage,
 type SignedDirectoryUpgradeOptions} from '../../apps/desktop/src/streamcockpit-upgrade-signed-preparation.js';
import {validateSquirrelNativeState,type SquirrelNativeState} from '../../apps/desktop/src/streamcockpit-squirrel-native.js';
import {AutoModActionIntentSqlite} from '../../apps/server/src/streamcockpit-automod-action-intent-sqlite.js';
export async function squirrelFixture(packageId='StreamDashboard'){
 const f=await nativeMaintenanceFixture(),root=join(f.root,packageId),fromVersion='2.1.0',version='3.0.0-alpha1';
 await mkdir(root);
 const oldRoot=join(root,'app-'+fromVersion),newRoot=join(root,'app-'+version);
 await rename(f.paths.packageRoot,oldRoot);
 const backupInstallation=join(f.root,'squirrel-backup'),feed=join(f.root,'feed');
 await mkdir(feed);await mkdir(join(root,'packages'));
 const updater=Buffer.from('TEST_ONLY_SYNTHETIC_UPDATER');
 await writeFile(join(root,'Update.exe'),updater);await writeFile(join(root,'StreamDashboard.exe'),'OLD_STABLE_STUB');
 const packagePath=packageId+'-'+version+'-full.nupkg',pkg=Buffer.from('TEST_ONLY_AUTHENTICATED_FULL_PACKAGE');
 await writeFile(join(feed,packagePath),pkg);
 const oldName=packageId+'-'+fromVersion+'-full.nupkg',oldBytes=Buffer.from('TEST_ONLY_OLD_FULL_PACKAGE');
 await writeFile(join(root,'packages',oldName),oldBytes);
 await writeFile(join(root,'packages','RELEASES'),createHash('sha1').update(oldBytes).digest('hex')+' '+oldName+' '+oldBytes.length+'\n');
 const automod=join(f.paths.profileRoot,'streamcockpit-automod-action-intents.sqlite');
 new AutoModActionIntentSqlite(automod).reserve('42','retained-before-update','12','ALLOW');
 const profileFiles=await f.inventory(f.paths.profileRoot);
 Object.assign(f.paths,{packageRoot:oldRoot,backupPackage:join(backupInstallation,'app-'+fromVersion)});
 Object.assign(f.request.options,{packageRoot:oldRoot,backupPackage:f.paths.backupPackage,
  squirrel:{sourceFeed:feed,backupInstallation}});
 f.request.options.target.profileFiles=structuredClone(profileFiles);f.request.options.rollback.profileFiles=structuredClone(profileFiles);
 const image:SignedDirectoryImage={...f.request.options.image,squirrel:{packageId,fromVersion,version,
  package:{path:packagePath,sha256:digest(pkg),sha1:createHash('sha1').update(pkg).digest('hex'),bytes:pkg.length},
  updater:{bytes:updater.length,sha256:digest(updater)}}};
 f.request.options.image=image;
 const pair=generateKeyPairSync('ed25519');
 f.trust.publicKeyPem=pair.publicKey.export({format:'pem',type:'spki'}).toString();
 const resign=()=>{
  f.request.options.manifest.sha256=directoryReleaseImageHash(f.request.options.image);
  f.request.options.manifest.signature.value=sign(null,directoryReleaseSigningPayload(f.request.options.manifest,f.request.options.image),pair.privateKey).toString('base64');
 };
 resign();await writeFile(f.requestFile,JSON.stringify(f.request));
 let state:SquirrelNativeState=validateSquirrelNativeState({registry:[
  {name:'InstallLocation',kind:'String',value:root},{name:'DisplayVersion',kind:'String',value:fromVersion},
  {name:'UninstallString',kind:'String',value:'"'+join(root,'Update.exe')+'" --uninstall'},
 ],shortcuts:[{path:join(f.root,'desktop.lnk'),data:Buffer.from('OLD_DESKTOP_LINK').toString('base64')},
  {path:join(f.root,'menu.lnk'),data:null}]},root);
 const oldState=structuredClone(state);
 const native=async(action:'read'|'apply'|'restore',_root:string,preparedFeed:string,_release:unknown,_signer:string,saved?:SquirrelNativeState)=>{
  if(_root!==root)throw Error('TEST_ROOT_CHANGED');
  if(action==='apply'){
   await cp(f.paths.sourcePackage,newRoot,{recursive:true});
   await cp(join(preparedFeed,packagePath),join(root,'packages',packagePath));
   const sha1=createHash('sha1').update(pkg).digest('hex');
   await writeFile(join(root,'packages','RELEASES'),sha1+' '+packagePath+' '+pkg.length+'\n');
   state.registry.find(r=>r.name==='DisplayVersion')!.value=version;
   state.shortcuts[0]!.data=Buffer.from('NEW_DESKTOP_LINK').toString('base64');
  }else if(action==='restore')state=structuredClone(saved!);
  return structuredClone(state);
 };
 const options:SignedDirectoryUpgradeOptions={...f.request.options,trust:f.trust,runtimeStopped:async()=>true,
  attestInstalled:async()=>{
   const updated=state.registry.find(r=>r.name==='DisplayVersion')?.value===version;
   const expected=updated?f.request.options.target:f.request.options.rollback;
   const path=join(updated?newRoot:oldRoot,'StreamDashboard.exe');
   const bytes=await readFile(path);if(digest(bytes)!==expected.packageFiles.find(x=>x.path==='StreamDashboard.exe')!.sha256)return undefined;
   return {...expected.identity,observedAt:Date.now()};
  }};
 return {...f,root: f.root,installationRoot:root,oldRoot,newRoot,feed,backupInstallation,oldState,options,resign,native,
  getState:()=>structuredClone(state),setState:(s:SquirrelNativeState)=>{state=structuredClone(s)}};
}
