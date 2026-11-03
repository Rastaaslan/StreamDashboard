import {afterEach,describe,expect,it} from 'vitest';
import {checkpointQaProfile,restoreQaProfile} from '../apps/desktop/src/streamcockpit-upgrade-qa-checkpoint.js';
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
    'configuration/settings.json':Buffer.from(JSON.stringify({schemaVersion:1,associations:{phone:'synthetic'},profiles:{fixe:'stream'}})),
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
