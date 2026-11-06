import {readFile,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename,dirname,join,resolve,sep} from 'node:path';
import {runExternalWindowsMaintenance,type ExternalMaintenanceRequest} from '../../apps/desktop/src/streamcockpit-external-maintenance.js';

const [action,config]=process.argv.slice(2);
if(!['prepare','install','rollback'].includes(action)||!config||basename(config)!=='qa-external.json')
  throw Error('QA_CHILD_COMMAND_INVALID');
const folder=resolve(dirname(config)),temp=resolve(tmpdir());
if(dirname(folder)!==temp||!basename(folder).startsWith('sc3-signed-prep-'))
  throw Error('QA_CHILD_TEMP_ONLY');
const contained=(value:string)=>typeof value==='string'&&
  resolve(value).toLowerCase().startsWith(folder.toLowerCase()+sep);
const raw=JSON.parse(await readFile(config,'utf8')) as ExternalMaintenanceRequest;
if(raw.action!==action||!contained(raw.applicationData)||!contained(raw.rootUserData))
  throw Error('QA_CHILD_ROOT_INVALID');
const options=raw.options;
for(const value of [options.journalDirectory,options.packageRoot,options.profileRoot,
  options.preparedPackage,options.preparedProfile,options.backupPackage,
  options.backupProfile,options.sourcePackage])
  if(!contained(value))throw Error('QA_CHILD_ROOT_INVALID');
if((await realpath(folder)).toLowerCase()!==folder.toLowerCase())
  throw Error('QA_CHILD_REPARSE_ROOT');
options.runtimeStopped=async()=>true;
// Test-only synthetic identity, NOT a Windows Authenticode query.
options.attestInstalled=async()=>{
 const bytes=await readFile(join(options.packageRoot,'StreamCockpit.exe'),'utf8');
 return {...(bytes.startsWith('NEW')?options.target.identity:options.rollback.identity),observedAt:Date.now()};
};
const result=await runExternalWindowsMaintenance(raw,{
 observeOffline:async()=>({authority:'fixe-independent',session:'TEST_ONLY_SESSION',
   observedAt:Date.now(),obs:'idle',twitch:'offline'}),
 verifyNativeSigner:async path=>({status:'valid',path,signer:options.trust.windowsSigner,observedAt:Date.now()}),
 authorize:async op=>op===action,
 noOtherWriters:async()=>true,
 assessRestartSafety:async()=>({safe:true}),
});
process.stdout.write(JSON.stringify(result)+'\n');
