import {readFile,realpath} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {basename,dirname,join,resolve,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {runExternalWindowsMaintenance,type ExternalMaintenanceRequest} from '../../apps/desktop/src/streamcockpit-external-maintenance.js';

// Isolated process fixture, NOT a CLI installer. Only test-created temp roots
// may be addressed; it cannot discover or access an installed user profile.
const [action,config]=process.argv.slice(2);
if(!['prepare','install','rollback','crash-migrate'].includes(action)||!config||basename(config)!=='migration.json')
  throw Error('TEST_MIGRATION_COMMAND_INVALID');
const root=resolve(dirname(config));
if(dirname(root)!==resolve(tmpdir())||!basename(root).startsWith('sc3-f09-maintenance-')||
  (await realpath(root)).toLowerCase()!==root.toLowerCase())throw Error('TEST_MIGRATION_TEMP_ONLY');
const contained=(p:string)=>typeof p==='string'&&resolve(p).toLowerCase().startsWith(root.toLowerCase()+sep);
const parsed=JSON.parse(await readFile(config,'utf8')) as ExternalMaintenanceRequest;
parsed.action=(action==='crash-migrate'?'install':action) as ExternalMaintenanceRequest['action'];
const o=parsed.options;
for(const p of [parsed.applicationData,parsed.rootUserData,o.journalDirectory,o.packageRoot,o.profileRoot,
  o.preparedPackage,o.preparedProfile,o.backupPackage,o.backupProfile,o.sourcePackage])
  if(!contained(p))throw Error('TEST_MIGRATION_ROOT_INVALID');
o.runtimeStopped=async()=>true;
// Explicit synthetic identity and observations, never production/native proof.
o.attestInstalled=async()=>({...((await readFile(join(o.packageRoot,'StreamDashboard.exe'),'utf8')).startsWith('NEW')?
  o.target.identity:o.rollback.identity),observedAt:Date.now()});
const result=await runExternalWindowsMaintenance(parsed,{
  observeOffline:async()=>({authority:'fixe-independent',session:'MIGRATION_TEST_ONLY',observedAt:Date.now(),obs:'idle',twitch:'offline'}),
  verifyNativeSigner:async path=>({status:'valid',path,signer:o.trust.windowsSigner,observedAt:Date.now()}),
  authorize:async op=>op===parsed.action,noOtherWriters:async()=>{
    const folder=o.profileMigration?.directory==='config'?join(o.preparedProfile,'config'):o.preparedProfile;
    if(action==='crash-migrate'&&existsSync(join(folder,'streamcockpit-moments.sqlite'))&&
      existsSync(join(folder,'streamcockpit-moments.json.pre-sqlite.json')))process.exit(71);
    return true;
  },assessRestartSafety:async()=>({safe:true}),
});
console.log(JSON.stringify(result));
