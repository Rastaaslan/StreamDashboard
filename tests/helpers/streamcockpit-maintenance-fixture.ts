import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {mkdtemp,mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {join,relative,sep,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {directoryReleaseImageHash,directoryReleaseSigningPayload,type DirectoryReleaseTrust} from '../../apps/desktop/src/streamcockpit-upgrade-signed-preparation.js';
import {runtimeUpgradeDirectory} from '../../apps/desktop/src/streamcockpit-runtime-ownership.js';
import type {PreparedMaintenanceRequest,MaintenanceEnvelope} from '../../apps/desktop/src/streamcockpit-maintenance-cli.js';
import type {UpgradeReadbackFile} from '../../apps/desktop/src/streamcockpit-upgrade-readback.js';
export const digest=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
export async function nativeMaintenanceFixture(){
 const root=await mkdtemp(join(tmpdir(),'sc3-native-closure-'));
 const applicationData=join(root,'appdata'),rootUserData=join(root,'profile');
 const paths={packageRoot:join(root,'installed'),profileRoot:rootUserData,sourcePackage:join(root,'source'),
  journalDirectory:runtimeUpgradeDirectory(applicationData,rootUserData),preparedPackage:join(root,'stage'),
  preparedProfile:join(root,'prepared-profile'),backupPackage:join(root,'backup-app'),backupProfile:join(root,'backup-data')};
 for(const p of [applicationData,rootUserData,paths.packageRoot,paths.sourcePackage,paths.journalDirectory])await mkdir(p,{recursive:true});
 const write=async(folder:string,file:string,bytes:string)=>{const path=join(folder,file);await mkdir(dirname(path),{recursive:true});await writeFile(path,bytes)};
 for(const [folder,kind] of [[paths.packageRoot,'OLD'],[paths.sourcePackage,'NEW']]){
  await write(folder,'StreamDashboard.exe',kind+'_SYNTHETIC_NOT_EXECUTABLE');
  await write(folder,'resources/app.asar',kind+'_SYNTHETIC_NOT_ASAR');
  await write(folder,'resources/streamcockpit-maintenance.cjs',kind+'_TEST_ONLY_NOT_RUN');
 }
 await write(rootUserData,'config/dashboard.json','{"schemaVersion":6,"associations":{"phone":"synthetic"},"profiles":{"fixe":"master"}}');
 const inventory=async(folder:string):Promise<UpgradeReadbackFile[]>=>{
  const files:UpgradeReadbackFile[]=[];
  const walk=async(dir:string)=>{for(const entry of await readdir(dir,{withFileTypes:true})){
   const path=join(dir,entry.name);if(entry.isDirectory())await walk(path);
   else{const b=await readFile(path);files.push({path:relative(folder,path).split(sep).join('/'),bytes:b.length,sha256:digest(b)})}
  }};await walk(folder);return files.sort((a,b)=>a.path.localeCompare(b.path));
 };
 const identity=(version:string)=>({version,revision:(version.startsWith('3')?'a':'b').repeat(40),applicationId:'test.streamcockpit',signer:'A'.repeat(40)});
 const profileFiles=await inventory(rootUserData);
 const target={identity:identity('3.0.0-alpha.1'),packageFiles:await inventory(paths.sourcePackage),profileFiles};
 const rollback={identity:identity('2.1.0'),packageFiles:await inventory(paths.packageRoot),profileFiles:structuredClone(profileFiles)};
 const image={identity:target.identity,packageFiles:target.packageFiles};
 // Ephemeral test-only signing keys. Never written to disk or used as OS trust.
 const pair=generateKeyPairSync('ed25519');
 const trust:DirectoryReleaseTrust={keyId:'TEST_ONLY',publicKeyPem:pair.publicKey.export({format:'pem',type:'spki'}).toString(),
  applicationId:target.identity.applicationId,windowsSigner:'A'.repeat(40),sourceOrigin:'https://example.test'};
 const request:PreparedMaintenanceRequest={action:'prepare',applicationData,rootUserData,options:{...paths,target,rollback,image,
  manifest:{id:'test-native-closure',version:target.identity.version,fromVersion:rollback.identity.version,target:'desktop',
   source:'https://example.test/release',sha256:directoryReleaseImageHash(image),schema:{from:6,to:6},signature:{keyId:'TEST_ONLY',value:'TEST_PENDING'}}}};
 request.options.manifest.signature.value=sign(null,directoryReleaseSigningPayload(request.options.manifest,image),pair.privateKey).toString('base64');
 const observer={obs:{url:'ws://127.0.0.1:9',password:'TEST_ONLY_OBS'},outputs:{twitch:{kind:'main',name:''}},
  twitch:{clientId:'TEST_ONLY_CLIENT',accessToken:'TEST_ONLY_TOKEN',broadcasterId:'42'}};
 const envelope:MaintenanceEnvelope={schemaVersion:1,request,trust,observer,parentPid:0,consent:{action:'prepare',releaseId:request.options.manifest.id}};
 const requestFile=join(root,'prepared-request.json');await writeFile(requestFile,JSON.stringify(request));
 return {root,paths,trust,request,requestFile,envelope,inventory,write,observer};
}
