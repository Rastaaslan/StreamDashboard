import {afterEach,describe,expect,it} from 'vitest';
import {checkpointQaProfile,restoreQaProfile,migrateQaProfileCopy} from '../apps/desktop/src/streamcockpit-upgrade-qa-checkpoint.js';
import {AutoModActionIntentSqlite} from '../apps/server/src/streamcockpit-automod-action-intent-sqlite.js';
import {PredictionIntentSqlite} from '../apps/server/src/streamcockpit-prediction-intent-sqlite.js';
import {MomentsSqliteStorage} from '../apps/server/src/streamcockpit-moments-sqlite.js';
import {mkdtemp,mkdir,readFile,readdir,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';

const folders:string[]=[];
afterEach(async()=>{
  for(const folder of folders.splice(0))await rm(folder,{force:true,recursive:true});
});
async function fixture(){
  const root=await mkdtemp(join(tmpdir(),'sc3-upgrade-qa-'));folders.push(root);
  const active=join(root,'active');
  await mkdir(join(active,'configuration'),{recursive:true});
  await mkdir(join(active,'journals'),{recursive:true});
  const files={
    'configuration/settings.json':Buffer.from(JSON.stringify({schemaVersion:1,associations:{phone:'synthetic'},profiles:{fixe:'stream'},other:{untouched:true}})),
    'journals/commands.sqlite':Buffer.from([0,83,81,76,105,116,101,0,254,14]),
    'configuration/encrypted-credentials.dat':Buffer.from([255,128,0,22,33]),
    'configuration/empty-marker':Buffer.alloc(0),
  };
  for(const [name,bytes] of Object.entries(files))await writeFile(join(active,...name.split('/')),bytes);
  return {root,active,files};
}
describe('F10 isolated Windows filesystem QA checkpoint — no installed profile or updater',()=>{
  it('copies JSON, synthetic encrypted data, zero-byte markers and binary SQLite unchanged, then restores into a NEW directory',async()=>{
    const f=await fixture();
    const report=await checkpointQaProfile(f.root);
    expect(report).toMatchObject({schemaVersion:1,kind:'SC3_UPGRADE_QA_CHECKPOINT',source:'active'});
    expect(report.entries).toHaveLength(4);
    expect(report.entries.find(row=>row.path==='journals/commands.sqlite')).toMatchObject({bytes:10});
    const manifest=await readFile(join(f.root,'backup','manifest.json'),'utf8');
    expect(manifest).not.toContain('synthetic');
    expect(manifest).not.toContain('fixe');
    await writeFile(join(f.active,'configuration','settings.json'),'changed by simulated migration');
    const restored=await restoreQaProfile(f.root);
    expect(restored).toEqual(report);
    for(const [name,bytes] of Object.entries(f.files)){
      const actual=await readFile(join(f.root,'restored',...name.split('/')));
      expect(actual.equals(bytes)).toBe(true);
    }
    expect((await readFile(join(f.active,'configuration','settings.json'),'utf8'))).toContain('changed by simulated migration');
    expect(await readdir(f.root)).toEqual(expect.arrayContaining(['active','backup','restored']));
  });
  it('refuses a second backup or restore without replacing existing files',async()=>{
    const f=await fixture();
    const before=await checkpointQaProfile(f.root);
    await expect(checkpointQaProfile(f.root)).rejects.toThrow('BACKUP_ALREADY_EXISTS');
    expect(await restoreQaProfile(f.root)).toEqual(before);
    await expect(restoreQaProfile(f.root)).rejects.toThrow('RESTORE_ALREADY_EXISTS');
    expect((await readFile(join(f.root,'restored','journals','commands.sqlite'))).equals(f.files['journals/commands.sqlite'])).toBe(true);
  });
  it('detects tampered checkpoint bytes before any restore appears',async()=>{
    const f=await fixture();await checkpointQaProfile(f.root);
    await writeFile(join(f.root,'backup','files','journals','commands.sqlite'),Buffer.alloc(10,7));
    await expect(restoreQaProfile(f.root)).rejects.toThrow('BACKUP_TAMPERED');
    await expect(stat(join(f.root,'restored'))).rejects.toMatchObject({code:'ENOENT'});
  });
  it('rejects malicious relative paths inside its own manifest and never writes outside the workspace',async()=>{
    const f=await fixture();await checkpointQaProfile(f.root);
    const path=join(f.root,'backup','manifest.json');
    const original=JSON.parse(await readFile(path,'utf8'));
    original.entries[0].path='../outside';
    await writeFile(path,JSON.stringify(original));
    const sentinel=join(dirname(f.root),'sc3-upgrade-qa-unrelated-sentinel');
    // No sentinel is created; this call must remain entirely inside the workspace.
    await expect(restoreQaProfile(f.root)).rejects.toThrow('QA_CHECKPOINT_UNSAFE_ENTRY');
    await expect(stat(join(f.root,'restored'))).rejects.toMatchObject({code:'ENOENT'});
    void sentinel;
  });
  it('refuses an unrelated directory, even if it has a plausible active profile',async()=>{
    const root=await mkdtemp(join(tmpdir(),'not-sc3-upgrade-'));folders.push(root);
    await mkdir(join(root,'active'),{recursive:true});
    await writeFile(join(root,'active','settings.json'),'synthetic');
    await expect(checkpointQaProfile(root)).rejects.toThrow('NOT_ISOLATED_TEMP_WORKSPACE');
    expect(await readdir(root)).toEqual(['active']);
  });
  it('never mistakes a pending/partial backup as a completed one',async()=>{
    const f=await fixture();
    await mkdir(join(f.root,'backup-pending-crash'));
    await expect(restoreQaProfile(f.root)).rejects.toMatchObject({code:'ENOENT'});
    await checkpointQaProfile(f.root);
    const after=await restoreQaProfile(f.root);
    expect(after.entries.length).toBe(4);
    expect(await readdir(join(f.root,'backup-pending-crash'))).toEqual([]);
  });
});

describe('F10 QA backup -> detached migration -> independent recovery, no installed profile',()=>{
  const steps=[{from:1,to:2,apply:(copy:any)=>({...copy,schemaVersion:2,newSetting:'enabled'})}];
  it('runs all three phases in isolated NTFS workspace, preserving credentials, journal and unknown settings',async()=>{
    const f=await fixture();
    await checkpointQaProfile(f.root);
    const result=await migrateQaProfileCopy(f.root,2,steps);
    expect(result).toMatchObject({kind:'SC3_UPGRADE_QA_MIGRATION',fromVersion:1,toVersion:2});
    expect(result.oldHash).not.toBe(result.newHash);
    const migrated=JSON.parse(await readFile(join(f.root,'migrated','configuration','settings.json'),'utf8'));
    expect(migrated).toMatchObject({schemaVersion:2,newSetting:'enabled',other:{untouched:true},
      associations:{phone:'synthetic'},profiles:{fixe:'stream'}});
    expect((await readFile(join(f.root,'migrated','configuration','encrypted-credentials.dat'))).equals(
      f.files['configuration/encrypted-credentials.dat'])).toBe(true);
    expect((await readFile(join(f.root,'migrated','journals','commands.sqlite'))).equals(
      f.files['journals/commands.sqlite'])).toBe(true);
    expect((await readFile(join(f.active,'configuration','settings.json'))).equals(
      f.files['configuration/settings.json'])).toBe(true);
    expect((await restoreQaProfile(f.root)).entries).toHaveLength(4);
    for(const [name,bytes] of Object.entries(f.files))
      expect((await readFile(join(f.root,'restored',...name.split('/')))).equals(bytes)).toBe(true);
    await expect(migrateQaProfileCopy(f.root,2,steps)).rejects.toThrow('MIGRATED_ALREADY_EXISTS');
  });
  it('refuses destructive migration without partial output or modifying backup',async()=>{
    const f=await fixture();await checkpointQaProfile(f.root);
    await expect(migrateQaProfileCopy(f.root,2,[{from:1,to:2,apply:(copy:any)=>({
      schemaVersion:2,associations:copy.associations,profiles:copy.profiles
    })}])).rejects.toThrow('Données');
    await expect(stat(join(f.root,'migrated'))).rejects.toMatchObject({code:'ENOENT'});
    expect((await restoreQaProfile(f.root)).entries).toHaveLength(4);
    expect((await readFile(join(f.active,'configuration','settings.json'))).equals(
      f.files['configuration/settings.json'])).toBe(true);
  });
  it('blocks corrupted backup before versioned migration or restore',async()=>{
    const f=await fixture();await checkpointQaProfile(f.root);
    await writeFile(join(f.root,'backup','files','journals','commands.sqlite'),'TAMPER');
    await expect(migrateQaProfileCopy(f.root,2,steps)).rejects.toThrow('BACKUP_TAMPERED');
    await expect(stat(join(f.root,'migrated'))).rejects.toMatchObject({code:'ENOENT'});
    expect((await readFile(join(f.active,'journals','commands.sqlite'))).equals(
      f.files['journals/commands.sqlite'])).toBe(true);
  });
});

describe('F10 QA upgrade must preserve the F02 one-way AutoMod replay fence',()=>{
  const journal='streamcockpit-automod-action-intents.sqlite';
  const steps=[{from:1,to:2,apply:(copy:any)=>({...copy,schemaVersion:2,upgradeFlag:true})}];
  it('copies a REAL SQLite F02 reservation through backup, migration and restore unchanged',async()=>{
    const f=await fixture(),activeFile=join(f.active,journal);
    const fence=new AutoModActionIntentSqlite(activeFile);
    expect(fence.reserve('42','held-A','12','ALLOW')).toBe(true);
    const original=await readFile(activeFile);
    const report=await checkpointQaProfile(f.root);
    expect(report.entries.find(row=>row.path===journal)).toMatchObject({bytes:original.length});
    await migrateQaProfileCopy(f.root,2,steps);
    await restoreQaProfile(f.root);
    for(const folder of ['backup/files','migrated','restored']){
      const file=join(f.root,...folder.split('/'),journal);
      expect(await readFile(file)).toEqual(original);
      expect(new AutoModActionIntentSqlite(file).isBlocked('42','held-A')).toBe(true);
    }
    expect(new AutoModActionIntentSqlite(activeFile).isBlocked('42','held-A')).toBe(true);
  });
  it('refuses an OLD backup after a newer F02 decision, without publishing rollback bytes',async()=>{
    const f=await fixture(),activeFile=join(f.active,journal);
    const fence=new AutoModActionIntentSqlite(activeFile);
    expect(fence.reserve('42','held-A','12','ALLOW')).toBe(true);
    await checkpointQaProfile(f.root);
    const previous=await readFile(join(f.root,'backup','files',journal));
    expect(fence.reserve('42','held-B','12','DENY')).toBe(true);
    await expect(restoreQaProfile(f.root)).rejects.toThrow('QA_CHECKPOINT_AUTOMOD_FENCE_CHANGED');
    await expect(migrateQaProfileCopy(f.root,2,steps)).rejects.toThrow('QA_CHECKPOINT_AUTOMOD_FENCE_CHANGED');
    expect(await readFile(join(f.root,'backup','files',journal))).toEqual(previous);
    expect(new AutoModActionIntentSqlite(activeFile).isBlocked('42','held-B')).toBe(true);
    for(const folder of ['restored','migrated'])await expect(stat(join(f.root,folder))).rejects.toMatchObject({code:'ENOENT'});
  });
  it('fails closed if a F02 decision commits DURING the detached migration',async()=>{
    const f=await fixture(),activeFile=join(f.active,journal);
    const fence=new AutoModActionIntentSqlite(activeFile);
    expect(fence.reserve('42','held-A','12','ALLOW')).toBe(true);
    await checkpointQaProfile(f.root);
    let reachedMigration=false;
    await expect(migrateQaProfileCopy(f.root,2,[{from:1,to:2,apply:(copy:any)=>{
      reachedMigration=true;
      expect(fence.reserve('42','held-after-copy','12','DENY')).toBe(true);
      return {...copy,schemaVersion:2};
    }}])).rejects.toThrow('QA_CHECKPOINT_AUTOMOD_FENCE_CHANGED');
    expect(reachedMigration).toBe(true);
    expect(new AutoModActionIntentSqlite(activeFile).isBlocked('42','held-after-copy')).toBe(true);
    await expect(stat(join(f.root,'migrated'))).rejects.toMatchObject({code:'ENOENT'});
    expect((await readdir(f.root)).some(name=>name.startsWith('migrated-pending-'))).toBe(false);
  });
  it('refuses backup missing a newly created F02 journal or a removed live journal',async()=>{
    const noInitial=await fixture(),newFile=join(noInitial.active,journal);
    await checkpointQaProfile(noInitial.root);
    expect(new AutoModActionIntentSqlite(newFile).reserve('42','held-C','12','DENY')).toBe(true);
    await expect(restoreQaProfile(noInitial.root)).rejects.toThrow('QA_CHECKPOINT_AUTOMOD_FENCE_CHANGED');
    await expect(migrateQaProfileCopy(noInitial.root,2,steps)).rejects.toThrow('QA_CHECKPOINT_AUTOMOD_FENCE_CHANGED');
    const removed=await fixture(),file=join(removed.active,journal);
    expect(new AutoModActionIntentSqlite(file).reserve('42','held-D','12','ALLOW')).toBe(true);
    await checkpointQaProfile(removed.root);await rm(file);
    await expect(restoreQaProfile(removed.root)).rejects.toThrow('QA_CHECKPOINT_AUTOMOD_FENCE_CHANGED');
    await expect(migrateQaProfileCopy(removed.root,2,steps)).rejects.toThrow('QA_CHECKPOINT_AUTOMOD_FENCE_CHANGED');
  });
});

describe('F10 QA preserves F08 prediction and F09 moments durable host journals',()=>{
  const prediction='streamcockpit-prediction-intents.sqlite';
  const moments='streamcockpit-moments.sqlite';
  const steps=[{from:1,to:2,apply:(copy:any)=>({...copy,schemaVersion:2,extraQaFlag:true})}];
  it('backs up and migrates REAL Windows F08 and F09 SQLite receipts, restoring the same bytes',async()=>{
    const f=await fixture(),predFile=join(f.active,prediction),momentFile=join(f.active,moments);
    expect(new PredictionIntentSqlite(predFile).reserve('42')).toBe(true);
    expect(await new MomentsSqliteStorage(momentFile).compareAndSwap(null,'journal-v1')).toBe(true);
    const expected=await Promise.all([readFile(predFile),readFile(momentFile)]);
    await checkpointQaProfile(f.root);
    await migrateQaProfileCopy(f.root,2,steps);
    await restoreQaProfile(f.root);
    for(const folder of ['backup/files','migrated','restored']){
      const location=join(f.root,...folder.split('/'));
      expect(await readFile(join(location,prediction))).toEqual(expected[0]);
      expect(await readFile(join(location,moments))).toEqual(expected[1]);
      expect(new PredictionIntentSqlite(join(location,prediction)).isBlocked('42')).toBe(true);
      expect(await new MomentsSqliteStorage(join(location,moments)).read()).toBe('journal-v1');
    }
  });
  it('rejects rollback after a NEW F08 prediction attempt, retaining the live permanent fence',async()=>{
    const f=await fixture(),file=join(f.active,prediction),fence=new PredictionIntentSqlite(file);
    expect(fence.reserve('42')).toBe(true);
    await checkpointQaProfile(f.root);
    expect(fence.reserve('43')).toBe(true);
    await expect(restoreQaProfile(f.root)).rejects.toThrow('QA_CHECKPOINT_PREDICTION_FENCE_CHANGED');
    await expect(migrateQaProfileCopy(f.root,2,steps)).rejects.toThrow('QA_CHECKPOINT_PREDICTION_FENCE_CHANGED');
    expect(fence.isBlocked('43')).toBe(true);
    for(const folder of ['restored','migrated'])await expect(stat(join(f.root,folder))).rejects.toMatchObject({code:'ENOENT'});
  });
  it('rejects rollback after a NEW F09 moment write, retaining the live receipt',async()=>{
    const f=await fixture(),file=join(f.active,moments),store=new MomentsSqliteStorage(file);
    expect(await store.compareAndSwap(null,'journal-v1')).toBe(true);
    await checkpointQaProfile(f.root);
    expect(await store.compareAndSwap('journal-v1','journal-v2')).toBe(true);
    await expect(restoreQaProfile(f.root)).rejects.toThrow('QA_CHECKPOINT_MOMENTS_JOURNAL_CHANGED');
    await expect(migrateQaProfileCopy(f.root,2,steps)).rejects.toThrow('QA_CHECKPOINT_MOMENTS_JOURNAL_CHANGED');
    expect(await store.read()).toBe('journal-v2');
    for(const folder of ['restored','migrated'])await expect(stat(join(f.root,folder))).rejects.toMatchObject({code:'ENOENT'});
  });
  it('refuses an F08 journal deleted after backup or an F09 journal created after backup',async()=>{
    const removed=await fixture(),f08=join(removed.active,prediction);
    expect(new PredictionIntentSqlite(f08).reserve('42')).toBe(true);
    await checkpointQaProfile(removed.root);await rm(f08);
    await expect(restoreQaProfile(removed.root)).rejects.toThrow('QA_CHECKPOINT_PREDICTION_FENCE_CHANGED');
    const created=await fixture(),f09=join(created.active,moments);
    await checkpointQaProfile(created.root);
    expect(await new MomentsSqliteStorage(f09).compareAndSwap(null,'late-event')).toBe(true);
    await expect(migrateQaProfileCopy(created.root,2,steps)).rejects.toThrow('QA_CHECKPOINT_MOMENTS_JOURNAL_CHANGED');
  });
  it('rejects an F08 reservation committed during the migration, before promotion',async()=>{
    const f=await fixture(),file=join(f.active,prediction),fence=new PredictionIntentSqlite(file);
    expect(fence.reserve('42')).toBe(true);
    await checkpointQaProfile(f.root);
    let reached=false;
    await expect(migrateQaProfileCopy(f.root,2,[{from:1,to:2,apply:(copy:any)=>{
      reached=true;
      expect(fence.reserve('43')).toBe(true);
      return {...copy,schemaVersion:2};
    }}])).rejects.toThrow('QA_CHECKPOINT_PREDICTION_FENCE_CHANGED');
    expect(reached).toBe(true);
    expect(fence.isBlocked('43')).toBe(true);
    await expect(stat(join(f.root,'migrated'))).rejects.toMatchObject({code:'ENOENT'});
    expect((await readdir(f.root)).some(name=>name.startsWith('migrated-pending-'))).toBe(false);
  });
  it('refuses a partial SQLite sidecar captured INSIDE the backup manifest',async()=>{
    const f=await fixture(),file=join(f.active,moments);
    expect(await new MomentsSqliteStorage(file).compareAndSwap(null,'first-event')).toBe(true);
    await writeFile(file+'-wal',Buffer.from('synthetic-uncommitted-WAL'));
    await checkpointQaProfile(f.root);
    await rm(file+'-wal');
    await expect(restoreQaProfile(f.root)).rejects.toThrow('QA_CHECKPOINT_DURABLE_SIDECAR_PRESENT');
    await expect(migrateQaProfileCopy(f.root,2,steps)).rejects.toThrow('QA_CHECKPOINT_DURABLE_SIDECAR_PRESENT');
    expect(await new MomentsSqliteStorage(file).read()).toBe('first-event');
  });
  it('refuses an incomplete SQLite sidecar rather than treating the main DB as a complete checkpoint',async()=>{
    const f=await fixture(),f08=join(f.active,prediction);
    expect(new PredictionIntentSqlite(f08).reserve('42')).toBe(true);
    await checkpointQaProfile(f.root);
    await writeFile(f08+'-journal',Buffer.from('incomplete transaction fixture'));
    await expect(restoreQaProfile(f.root)).rejects.toThrow('QA_CHECKPOINT_DURABLE_SIDECAR_PRESENT');
    await expect(migrateQaProfileCopy(f.root,2,steps)).rejects.toThrow('QA_CHECKPOINT_DURABLE_SIDECAR_PRESENT');
    await rm(f08+'-journal');
    expect(new PredictionIntentSqlite(f08).isBlocked('42')).toBe(true);
  });
});
