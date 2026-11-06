import {afterEach,describe,expect,it,vi} from 'vitest';
import {copyFile,mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn,spawnSync,type ChildProcess} from 'node:child_process';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import * as desktop from '../apps/desktop/src/streamcockpit-upgrade.js';
import {SqliteUpgradeJournal} from '../apps/desktop/src/streamcockpit-upgrade-journal.js';
import type {UpgradeAdapters,UpgradeJournal,UpgradeManifest} from '../packages/core/src/streamcockpit-upgrade.js';

const directories:string[]=[];
const children:{child:ChildProcess;exited:Promise<number|null>}[]=[];
afterEach(async()=>{
  for(const {child,exited} of children.splice(0)){
    if(child.exitCode===null&&child.signalCode===null)child.kill();
    await exited;
  }
  for(const dir of directories.splice(0))await rm(dir,{recursive:true,force:true});
});
const manifest:UpgradeManifest={id:'durable-upgrade-test',version:'3.0.0',fromVersion:'2.1.0',
  target:'desktop',source:'https://example.test/release',sha256:'a'.repeat(64),
  signature:{keyId:'synthetic',value:'not-a-production-signature'},schema:{from:1,to:2}};
type Effects=Omit<UpgradeAdapters,'read'|'write'|'exclusive'|'requireSafe'>;
const factory=desktop.createDurableDesktopUpgradePlanner;
const safe={assessRestartSafety:async()=>({safe:true})};
const repository=resolve(import.meta.dirname,'..');
const worker=join(repository,'tests','fixtures','streamcockpit3-upgrade-process.ts');
const journalPath=(root:string)=>join(root,'streamcockpit-upgrade-journal.sqlite');
const mutexPath=(root:string)=>join(root,'streamcockpit-upgrade-lock.sqlite');
const initial=():UpgradeJournal=>({manifest:structuredClone(manifest),artifact:'synthetic-local-package',phase:'downloaded',
  events:[{sequence:1,phase:'downloaded',message:'Declared in isolated test'}],installed:false,rolledBack:false});
async function fixture(){const dir=await mkdtemp(join(tmpdir(),'sc3-upgrade-journal-test-'));directories.push(dir);return dir;}
function effects():Effects{
  const ref=(name:string)=>vi.fn(async()=>({reference:'synthetic-'+name}));
  return {verify:vi.fn(async()=>true),stage:ref('stage'),backup:ref('backup'),migrate:ref('migrate'),
    install:ref('install'),rollback:ref('rollback'),reconcile:vi.fn(async()=>undefined)};
}
async function inspect(root:string){const store=new SqliteUpgradeJournal(root);return store.exclusive(()=>store.read());}
function runChild(mode:string,root:string){
  const result=spawnSync(process.execPath,['--import','tsx',worker,mode,root],{
    cwd:repository,encoding:'utf8',windowsHide:true,timeout:10_000,maxBuffer:256*1024});
  if(result.error)throw result.error;
  return result;
}
async function holdChild(root:string){
  const child=spawn(process.execPath,['--import','tsx',worker,'hold',root],{cwd:repository,windowsHide:true,stdio:'pipe'});
  const exited=new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code));});
  children.push({child,exited});
  await new Promise<void>((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(Error('Child ready timeout')),10_000);
    child.once('error',error=>{clearTimeout(timeout);reject(error)});
    child.once('exit',code=>{clearTimeout(timeout);reject(Error('Child exited before ready: '+code))});
    let output='';
    child.stdout!.on('data',data=>{output+=String(data);if(output.includes('READY\n')){clearTimeout(timeout);resolve();}});
  });
  return {child,exited};
}
async function seed(root:string){const store=new SqliteUpgradeJournal(root);await store.exclusive(()=>store.write(initial()));return store;}

describe('F10 durable Desktop upgrade coordinator',()=>{
  it('retains prepared state across independent planner instances without repeating staging',async()=>{
    const root=await fixture(),adapters=effects();
    expect(typeof factory).toBe('function');
    const first=factory(root,adapters,safe);
    await first.register(manifest,'synthetic-local-package');
    expect((await first.prepare()).phase).toBe('verified');
    expect((await factory(root,adapters,safe).prepare()).phase).toBe('verified');
    expect(adapters.stage).toHaveBeenCalledTimes(1);
    expect(adapters.install).not.toHaveBeenCalled();
  });
  it('does not create directories, databases or downloads at construction',async()=>{
    const root=await fixture();factory(root,effects(),safe);
    expect(await readdir(root)).toEqual([]);
  });
  it.each([false,undefined])('keeps live/unknown restart state blocked (%s)',async safety=>{
    const root=await fixture(),adapters=effects();
    const planner=factory(root,adapters,{assessRestartSafety:async()=>safety===undefined?undefined as never:{safe:false}});
    await planner.register(manifest,'synthetic-local-package');
    expect((await planner.install()).phase).toBe('deferred');
    for(const method of ['stage','backup','migrate','install','rollback']as const)expect(adapters[method]).not.toHaveBeenCalled();
  });
  it('commits intents before real temporary copies and preserves data through install and rollback',async()=>{
    const root=await fixture(),result=runChild('roundtrip',root);
    expect(result.status,result.stderr).toBe(0);
    expect((await inspect(root))?.phase).toBe('rolledBack');
    const active=JSON.parse(await readFile(join(root,'active.json'),'utf8'));
    expect(active).toEqual({schemaVersion:1,associations:{phone:'synthetic-pairing'},profiles:{fixe:'master'},unknown:{retain:true}});
    expect(await readFile(join(root,'backup.json'),'utf8')).toBe(JSON.stringify(active));
    expect(JSON.parse(await readFile(join(root,'migrated.json'),'utf8'))).toEqual({...active,schemaVersion:2});
    for(const step of ['stage','backup','migrate','install','rollback'])
      expect(await readFile(join(root,step+'.effects'),'utf8')).toBe('effect\n');
  },15_000);
  it.each(['stage','backup','migrate','install','rollback'])('preserves pending %s after child exit without automatically repeating it',async operation=>{
    const root=await fixture(),result=runChild('crash:'+operation,root);
    expect(result.status,result.stderr).toBe(71);
    expect((await inspect(root))?.pending).toEqual({operation,key:manifest.id+':'+operation});
    const adapters=effects(),resumed=factory(root,adapters,safe);
    const first=await resumed.install();
    expect(first.phase).toBe('deferred');
    expect(first.pending?.operation).toBe(operation);
    expect(first.events.at(-1)?.message).toContain('incertaine');
    expect((await resumed.rollback()).pending?.operation).toBe(operation);
    for(const method of ['stage','backup','migrate','install','rollback']as const)expect(adapters[method]).not.toHaveBeenCalled();
    expect(await readFile(join(root,operation+'.effects'),'utf8')).toBe('effect\n');
  },15_000);
  it('recovers a confirmed post-effect receipt after process exit without reinstalling',async()=>{
    const root=await fixture(),result=runChild('confirmed-crash',root);
    expect(result.status,result.stderr).toBe(71);
    const adapters=effects();
    adapters.reconcile=vi.fn(async(operation,key)=>{
      expect(operation).toBe('install');expect(key).toBe(manifest.id+':install');
      expect(JSON.parse(await readFile(join(root,'active.json'),'utf8')).schemaVersion).toBe(2);
      return JSON.parse(await readFile(join(root,'install.receipt.json'),'utf8'));
    });
    expect((await factory(root,adapters,safe).install()).phase).toBe('installed');
    expect(adapters.install).not.toHaveBeenCalled();
    expect(await readFile(join(root,'install.effects'),'utf8')).toBe('effect\n');
    expect((await inspect(root))?.pending).toBeUndefined();
  },15_000);
  it('excludes another OS process until graceful release, without hiding committed intent',async()=>{
    const root=await fixture(),{child,exited}=await holdChild(root);
    const contender=runChild('contend',root);
    expect(contender.status,contender.stderr).toBe(0);
    expect(JSON.parse(contender.stdout)).toMatchObject({entered:false,error:'SC3_UPGRADE_STORE_BUSY'});
    child.stdin!.end('release\n');expect(await exited).toBe(0);
    expect(JSON.parse(runChild('contend',root).stdout)).toMatchObject({entered:true,journal:{phase:'downloaded'}});
  },20_000);
  it('releases only the OS mutex on process death and retains the independent journal',async()=>{
    const root=await fixture(),{child,exited}=await holdChild(root);
    child.stdin!.end('crash\n');expect(await exited).toBe(71);
    expect(JSON.parse(runChild('contend',root).stdout)).toMatchObject({entered:true,journal:{phase:'downloaded'}});
    expect((await inspect(root))?.artifact).toBe('synthetic-local-package');
  },20_000);
  it('rejects concurrent owners and out-of-context access in the same process',async()=>{
    const root=await fixture(),store=await seed(root),other=new SqliteUpgradeJournal(root);
    await expect(store.read()).rejects.toThrow('EXCLUSIVE_REQUIRED');
    await expect(store.write(initial())).rejects.toThrow('EXCLUSIVE_REQUIRED');
    await store.exclusive(async()=>{
      await expect(store.exclusive(async()=>true)).rejects.toThrow('BUSY');
      await expect(other.exclusive(async()=>true)).rejects.toThrow('BUSY');
      expect((await store.read())?.phase).toBe('downloaded');
    });
    expect(await other.exclusive(()=>other.read())).toEqual(initial());
  });
  it('invalidates a detached asynchronous continuation after its lease ends',async()=>{
    const root=await fixture(),store=await seed(root);
    let release!:()=>void,escaped!:Promise<unknown>;
    const trigger=new Promise<void>(resolve=>{release=resolve});
    await store.exclusive(async()=>{escaped=trigger.then(()=>store.write(initial()));});
    release();await expect(escaped).rejects.toThrow('EXCLUSIVE_REQUIRED');
  });
  it('returns detached journal objects and refuses to rewrite durable history',async()=>{
    const root=await fixture(),store=await seed(root);
    await store.exclusive(async()=>{const read=(await store.read())!;read.events[0].message='mutated';});
    expect(await inspect(root)).toEqual(initial());
    await expect(store.exclusive(async()=>{
      const changed=(await store.read())!;changed.manifest.id='different';await store.write(changed);
    })).rejects.toThrow('HISTORY_REWRITE_DENIED');
    expect(await inspect(root)).toEqual(initial());
  });
  it('never starts an effect when another SQLite connection prevents intent COMMIT',async()=>{
    const root=await fixture(),adapters=effects(),planner=factory(root,adapters,safe);
    await planner.register(manifest,'synthetic-local-package');
    const blocker=new DatabaseSync(journalPath(root));blocker.exec('BEGIN IMMEDIATE');
    try{await expect(planner.prepare()).rejects.toThrow();}finally{blocker.exec('ROLLBACK');blocker.close()}
    expect(adapters.stage).not.toHaveBeenCalled();
    expect((await inspect(root))?.phase).toBe('downloaded');
    expect((await planner.prepare()).phase).toBe('verified');
    expect(adapters.stage).toHaveBeenCalledTimes(1);
  });
  it.each(['journal','coordinator'])('refuses deleted %s without recreating or clearing evidence',async which=>{
    const root=await fixture();await seed(root);
    const missing=which==='journal'?journalPath(root):mutexPath(root);
    const remaining=which==='journal'?mutexPath(root):journalPath(root),before=await readFile(remaining);
    await rm(missing);
    await expect(inspect(root)).rejects.toThrow('SC3_UPGRADE_STORE_');
    await expect(readFile(missing)).rejects.toMatchObject({code:'ENOENT'});
    expect(await readFile(remaining)).toEqual(before);
  });
  it('rejects a journal from a different installation without changing either database',async()=>{
    const a=await fixture(),b=await fixture();await seed(a);await seed(b);
    await copyFile(journalPath(b),journalPath(a));const before=await readFile(journalPath(a));
    await expect(inspect(a)).rejects.toThrow('IDENTITY_MISMATCH');
    expect(await readFile(journalPath(a))).toEqual(before);
  });
  it('rejects foreign or corrupt database bytes without initializing over them',async()=>{
    const root=await fixture();await seed(root);
    await writeFile(journalPath(root),'not a SQLite database');const before=await readFile(journalPath(root));
    await expect(inspect(root)).rejects.toThrow('DATABASE_UNAVAILABLE');
    expect(await readFile(journalPath(root))).toEqual(before);
  });
  it.each(['checksum','version','pending-key','sequence'])('blocks malformed persisted %s with no reset',async kind=>{
    const root=await fixture();await seed(root);
    const db=new DatabaseSync(journalPath(root));
    try{
      if(kind==='version')db.exec('PRAGMA user_version=2');
      else if(kind==='checksum')db.exec("UPDATE upgrade_journal SET sha256='invalid'");
      else{
        const changed=initial();
        if(kind==='pending-key')changed.pending={operation:'install',key:'unrelated'};
        else changed.events[0].sequence=8;
        const payload=JSON.stringify(changed);
        db.prepare('UPDATE upgrade_journal SET payload=?,sha256=?').run(payload,createHash('sha256').update(payload).digest('hex'));
      }
    }finally{db.close()}
    const before=await readFile(journalPath(root));
    await expect(inspect(root)).rejects.toThrow('SC3_UPGRADE_STORE_');
    expect(await readFile(journalPath(root))).toEqual(before);
  });
  it('does not persist credential-bearing provider errors in the durable journal',async()=>{
    const root=await fixture(),adapters=effects();
    adapters.install=vi.fn(async()=>{throw Error('Authorization: Bearer LEAK_SECRET_123')});
    const planner=factory(root,adapters,safe);await planner.register(manifest,'synthetic-local-package');
    const result=await planner.install();
    expect(result.pending?.operation).toBe('install');
    expect(JSON.stringify(result)).not.toContain('LEAK_SECRET_123');
    expect(JSON.stringify(await inspect(root))).not.toContain('Bearer');
    await planner.install();expect(adapters.install).toHaveBeenCalledTimes(1);
  });
  it('does not reinterpret a deleted journal row as an unused installation',async()=>{
    const root=await fixture();await seed(root);
    const db=new DatabaseSync(journalPath(root));
    try{db.exec('DELETE FROM upgrade_journal')}finally{db.close()}
    const adapters=effects(),planner=factory(root,adapters,safe);
    await expect(planner.register(manifest,'synthetic-local-package')).rejects.toThrow('INVALID_JOURNAL');
    expect(adapters.stage).not.toHaveBeenCalled();
  });
  it('rejects relative and Windows device/network/alternate-stream paths before I/O',()=>{
    for(const path of ['relative','\\\\server\\share','\\\\?\\C:\\temp','C:\\temp:alternate'])
      expect(()=>new SqliteUpgradeJournal(path)).toThrow('PATH_UNAVAILABLE');
  });
});
