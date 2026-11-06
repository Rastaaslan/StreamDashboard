import {appendFile,readFile,writeFile} from 'node:fs/promises';
import {basename,dirname,join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {SqliteUpgradeJournal} from '../../apps/desktop/src/streamcockpit-upgrade-journal.js';
import {createDurableDesktopUpgradePlanner} from '../../apps/desktop/src/streamcockpit-upgrade.js';
import {migrateUpgradeData,type UpgradeAdapters,type UpgradeJournal,type UpgradeManifest,type UpgradeOperation} from '../../packages/core/src/streamcockpit-upgrade.js';

// Standalone child-process fixture. It cannot address a profile/installation:
// only a direct OS-temp directory created and removed by the test may be used.
const [mode,argument]=process.argv.slice(2),root=resolve(argument??'');
if(dirname(root)!==resolve(tmpdir())||!basename(root).startsWith('sc3-upgrade-journal-test-'))
  throw Error('TEST_WORKSPACE_REQUIRED');
const manifest:UpgradeManifest={id:'durable-upgrade-test',version:'3.0.0',fromVersion:'2.1.0',
  target:'desktop',source:'https://example.test/release',sha256:'a'.repeat(64),
  signature:{keyId:'synthetic',value:'not-a-production-signature'},schema:{from:1,to:2}};
const initial:UpgradeJournal={manifest,artifact:'synthetic-local-package',phase:'downloaded',
  events:[{sequence:1,phase:'downloaded',message:'Declared in isolated test'}],installed:false,rolledBack:false};
const store=new SqliteUpgradeJournal(root);
if(mode==='hold'){
  await store.exclusive(async()=>{
    if(!await store.read())await store.write(initial);
    process.stdout.write('READY\n');
    await new Promise<void>(resolve=>process.stdin.once('data',data=>{
      if(String(data).trim()==='crash')process.exit(71); // No finally or clean lock release.
      resolve();
    }));
  });
  process.stdin.destroy();
  console.log(JSON.stringify({released:true}));
}else if(mode==='contend'){
  try{console.log(JSON.stringify(await store.exclusive(async()=>({entered:true,journal:await store.read()}))))}
  catch(error){console.log(JSON.stringify({entered:false,error:error instanceof Error?error.message:'unknown'}))}
}else{
  const crashOperation=mode?.startsWith('crash:')?mode.slice(6):undefined;
  const confirmedCrash=mode==='confirmed-crash';
  const original={schemaVersion:1,associations:{phone:'synthetic-pairing'},profiles:{fixe:'master'},unknown:{retain:true}};
  await writeFile(join(root,'active.json'),JSON.stringify(original),{flag:'wx'});
  const active=join(root,'active.json'),backup=join(root,'backup.json'),migrated=join(root,'migrated.json');
  const effect=async(operation:UpgradeOperation,key:string,apply:()=>Promise<void>)=>{
    // A DIFFERENT SQLite connection must see the committed intent BEFORE the
    // effect, even while the cross-process coordinator holds its mutex.
    const db=new DatabaseSync(join(root,'streamcockpit-upgrade-journal.sqlite'),{readOnly:true});
    try{
      const row=db.prepare('SELECT payload FROM upgrade_journal WHERE id=1').get() as {payload:string};
      const journal=JSON.parse(row.payload) as UpgradeJournal;
      if(journal.pending?.key!==key||journal.pending.operation!==operation)throw Error('INTENT_NOT_COMMITTED');
    }finally{db.close()}
    await apply();
    await appendFile(join(root,operation+'.effects'),'effect\n');
    const receipt={reference:operation+'-readback'};
    if(crashOperation===operation)process.exit(71);
    await writeFile(join(root,operation+'.receipt.json'),JSON.stringify(receipt),{flag:'wx'});
    if(confirmedCrash&&operation==='install')process.exit(71);
    return receipt;
  };
  const effects:Omit<UpgradeAdapters,'exclusive'|'read'|'write'|'requireSafe'>={
    verify:async()=>true, // Explicit synthetic signature provider, never a release proof.
    stage:async(_manifest,_artifact,key)=>effect('stage',key,async()=>{
      await writeFile(join(root,'staged.bin'),'synthetic-package',{flag:'wx'});
    }),
    backup:async(_manifest,key)=>effect('backup',key,async()=>{
      await writeFile(backup,await readFile(active),{flag:'wx'});
    }),
    migrate:async(_manifest,_backup,key)=>effect('migrate',key,async()=>{
      const data=JSON.parse(await readFile(backup,'utf8'));
      const copy=migrateUpgradeData(data,2,[{from:1,to:2,apply:source=>({...source,schemaVersion:2})}]);
      await writeFile(migrated,JSON.stringify(copy),{flag:'wx'});
    }),
    install:async(_journal,key)=>effect('install',key,async()=>{
      await writeFile(active,await readFile(migrated));
      if(JSON.parse(await readFile(active,'utf8')).schemaVersion!==2)throw Error('READBACK_FAILED');
    }),
    rollback:async(_journal,key)=>effect('rollback',key,async()=>{
      await writeFile(active,await readFile(backup));
      if(await readFile(active,'utf8')!==JSON.stringify(original))throw Error('READBACK_FAILED');
    }),
    reconcile:async()=>undefined,
  };
  const planner=createDurableDesktopUpgradePlanner(root,effects,{assessRestartSafety:async()=>({safe:true})});
  await planner.register(manifest,'synthetic-local-package');
  await planner.install();
  if(mode==='roundtrip'||crashOperation==='rollback')await planner.rollback();
  console.log(JSON.stringify(await store.exclusive(()=>store.read())));
}
