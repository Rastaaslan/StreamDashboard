import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import * as fs from 'node:fs/promises';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {tmpdir} from 'node:os';
import {dirname,join,relative,sep} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createSignedWindowsDirectoryUpgradePlanner,directoryReleaseImageHash,directoryReleaseSigningPayload,
  type SignedDirectoryUpgradeOptions} from '../apps/desktop/src/streamcockpit-upgrade-signed-preparation.js';
import {migrateLegacyMomentsToSqlite} from '../apps/server/src/streamcockpit-moments-legacy-migration.js';
import {MomentsSqliteStorage} from '../apps/server/src/streamcockpit-moments-sqlite.js';
import {MomentsPipeline} from '../apps/server/src/streamcockpit-moments.js';
import {PredictionIntentSqlite} from '../apps/server/src/streamcockpit-prediction-intent-sqlite.js';
import {AutoModActionIntentSqlite} from '../apps/server/src/streamcockpit-automod-action-intent-sqlite.js';
import {AudioReceiptSqlite} from '../apps/server/src/streamcockpit-audio-receipts-sqlite.js';
import {SqliteUpgradeJournal} from '../apps/desktop/src/streamcockpit-upgrade-journal.js';
import {runtimeUpgradeDirectory} from '../apps/desktop/src/streamcockpit-runtime-ownership.js';
import type {MomentsUpgradeMigration} from '../apps/desktop/src/streamcockpit-upgrade-moments-migration.js';
import type {UpgradeReadbackFile} from '../apps/desktop/src/streamcockpit-upgrade-readback.js';
import type {UpgradeManifest} from '../packages/core/src/streamcockpit-upgrade.js';

vi.mock('node:fs/promises',async original=>{const native=await original<typeof import('node:fs/promises')>();
  return {...native,rename:vi.fn(native.rename)};});
vi.mock('../apps/server/src/streamcockpit-moments-legacy-migration.js',async original=>{
  const native=await original<typeof import('../apps/server/src/streamcockpit-moments-legacy-migration.js')>();
  return {...native,migrateLegacyMomentsToSqlite:vi.fn(native.migrateLegacyMomentsToSqlite)};
});
beforeEach(async()=>{
  const native=await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  vi.mocked(fs.rename).mockReset().mockImplementation(native.rename);
  const conversion=await vi.importActual<typeof import('../apps/server/src/streamcockpit-moments-legacy-migration.js')>('../apps/server/src/streamcockpit-moments-legacy-migration.js');
  vi.mocked(migrateLegacyMomentsToSqlite).mockReset().mockImplementation(conversion.migrateLegacyMomentsToSqlite);
});
const roots:string[]=[];
afterEach(async()=>{vi.restoreAllMocks();for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true})});
const test=process.platform==='win32'?it:it.skip;
const hash=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
// Ephemeral TEST-ONLY public/private pair, never persisted or used as OS trust.
const keys=generateKeyPairSync('ed25519');
const publicKeyPem=keys.publicKey.export({format:'pem',type:'spki'}).toString();
const observations=[
  {sessionId:'live_1',instant:1000,source:'manual',correlationId:'marker_1',title:'Manual marker',status:'observed'},
  {sessionId:'live_1',instant:1100,source:'twitch',correlationId:'clip_1',sourceEventId:'clip_evt',title:'Simple clip',status:'uncertain',clip:{provider:'twitch',reference:'opaque_clip'}},
  {sessionId:'live_2',instant:1200,source:'streamlabs',correlationId:'alert_1',sourceEventId:'alert_evt',title:'Observed alert',status:'observed'},
];
const envelope=(requests=observations)=>{const payload=JSON.stringify({schemaVersion:1,requests});return JSON.stringify({payload,sha256:hash(payload)})};
async function inventory(root:string):Promise<UpgradeReadbackFile[]>{
  const result:UpgradeReadbackFile[]=[];
  const visit=async(dir:string)=>{for(const entry of await fs.readdir(dir,{withFileTypes:true})){
    const path=join(dir,entry.name);if(entry.isDirectory())await visit(path);
    else{const bytes=await fs.readFile(path);result.push({path:relative(root,path).split(sep).join('/'),bytes:bytes.length,sha256:hash(bytes)})}
  }};await visit(root);return result.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
}
async function fixture(directory:'root'|'config'='config',raw=envelope()){
  const root=await fs.mkdtemp(join(tmpdir(),'sc3-f09-maintenance-'));roots.push(root);
  const applicationData=join(root,'app-data');
  const paths={packageRoot:join(root,'app'),profileRoot:join(root,'data'),sourcePackage:join(root,'source'),
    preparedPackage:join(root,'staged'),preparedProfile:join(root,'migrated'),backupPackage:join(root,'backup-app'),backupProfile:join(root,'backup-data'),
    journalDirectory:runtimeUpgradeDirectory(applicationData,join(root,'data'))};
  for(const dir of [paths.packageRoot,paths.profileRoot,paths.sourcePackage,paths.journalDirectory])await fs.mkdir(dir,{recursive:true});
  const write=async(dir:string,name:string,text:string)=>{const path=join(dir,...name.split('/'));await fs.mkdir(dirname(path),{recursive:true});await fs.writeFile(path,text)};
  for(const [dir,tag] of [[paths.packageRoot,'OLD'],[paths.sourcePackage,'NEW']]){
    await write(dir,'StreamDashboard.exe',tag+'_SYNTHETIC_NOT_AN_EXE');await write(dir,'resources/app.asar',tag+'_ASAR_FIXTURE');
  }
  await write(paths.profileRoot,'config/dashboard.json',JSON.stringify({schemaVersion:6,associations:{phone:'synthetic'},profiles:{fixe:'master'},unknown:{keep:true}}));
  const prefix=directory==='config'?'config/':'',legacy=prefix+'streamcockpit-moments.json',sqlite=prefix+'streamcockpit-moments.sqlite';
  await write(paths.profileRoot,legacy,raw);
  new AutoModActionIntentSqlite(join(paths.profileRoot,'config','streamcockpit-automod-action-intents.sqlite')).reserve('42','held_1','12','ALLOW');
  new PredictionIntentSqlite(join(paths.profileRoot,'config','streamcockpit-prediction-intents.sqlite')).reserve('42');
  new AudioReceiptSqlite(join(paths.profileRoot,'config','streamcockpit-mixer-receipts.sqlite')).reserve(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',{actor:'paired-controller',authority:'FIXE-identity',host:'FIXE-identity:1',runtime:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'},
    {sourceId:'Micro fixture',gain:.5});
  // Independent expected target from the canonical converter, NOT a runtime
  // acceptance of whatever output the upgrade happened to produce.
  const reference=join(root,'expected-profile');await fs.cp(paths.profileRoot,reference,{recursive:true});
  await migrateLegacyMomentsToSqlite(join(reference,sqlite),join(reference,legacy));
  const identity=(version:string)=>({version,revision:(version==='3.0.0'?'a':'b').repeat(40),applicationId:'fixture.windows',signer:'A'.repeat(40)});
  const rollback={identity:identity('2.1.0'),packageFiles:await inventory(paths.packageRoot),profileFiles:await inventory(paths.profileRoot)};
  const target={identity:identity('3.0.0'),packageFiles:await inventory(paths.sourcePackage),profileFiles:await inventory(reference)};
  const profileMigration:MomentsUpgradeMigration={kind:'moments-json-to-sqlite-v1',directory};
  const image={identity:target.identity,packageFiles:target.packageFiles,profileMigration};
  const manifest:UpgradeManifest={id:'legacy-migration-fixture',version:'3.0.0',fromVersion:'2.1.0',target:'desktop',source:'https://example.test/test-only',
    sha256:directoryReleaseImageHash(image),signature:{keyId:'TEST_ONLY',value:'pending'},schema:{from:6,to:6}};
  const signFixture=()=>{manifest.sha256=directoryReleaseImageHash(image);manifest.signature.value=sign(null,directoryReleaseSigningPayload(manifest,image),keys.privateKey).toString('base64')};
  signFixture();
  const runtimeStopped=vi.fn(async()=>true),safe=vi.fn(async()=>({safe:true}));
  const attestInstalled=async()=>({...identity((await fs.readFile(join(paths.packageRoot,'StreamDashboard.exe'),'utf8')).startsWith('NEW')?'3.0.0':'2.1.0'),observedAt:Date.now()});
  const options:SignedDirectoryUpgradeOptions & {profileMigration:MomentsUpgradeMigration}={...paths,manifest,image,target,rollback,profileMigration,runtimeStopped,attestInstalled,
    trust:{keyId:'TEST_ONLY',publicKeyPem,applicationId:'fixture.windows',windowsSigner:'A'.repeat(40),sourceOrigin:'https://example.test'}};
  const make=()=>createSignedWindowsDirectoryUpgradePlanner(options,{assessRestartSafety:safe});
  vi.mocked(migrateLegacyMomentsToSqlite).mockClear();vi.mocked(fs.rename).mockClear();
  return {root,paths,options,make,applicationData,write,raw,legacy,sqlite,reference,runtimeStopped,safe,signFixture};
}
async function unchangedFences(root:string){
  expect(new AutoModActionIntentSqlite(join(root,'config','streamcockpit-automod-action-intents.sqlite')).isBlocked('42','held_1')).toBe(true);
  expect(new PredictionIntentSqlite(join(root,'config','streamcockpit-prediction-intents.sqlite')).isBlocked('42')).toBe(true);
  const audio=new AudioReceiptSqlite(join(root,'config','streamcockpit-mixer-receipts.sqlite')).read(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','paired-controller','FIXE-identity');
  expect(audio).toBeDefined();expect(audio!.receipt).toBeUndefined();
}
test.each(['root','config'] as const)('migrates inherited F09 journals through the signed updater and restores the complete original profile (%s)',async directory=>{
  const f=await fixture(directory),p=f.make();await p.register(f.options.manifest,f.paths.sourcePackage);
  expect((await p.prepare()).phase).toBe('verified');expect(migrateLegacyMomentsToSqlite).not.toHaveBeenCalled();
  expect((await p.install()).phase).toBe('installed');expect(migrateLegacyMomentsToSqlite).toHaveBeenCalledTimes(1);
  expect(await inventory(f.paths.profileRoot)).toEqual(f.options.target.profileFiles);
  const store=new MomentsSqliteStorage(join(f.paths.profileRoot,f.sqlite));expect(await store.read()).toBe(f.raw);
  const report=await new MomentsPipeline(store).export('live_1');
  expect(report.markers.map(m=>[m.correlationId,m.status,m.clip?.reference??null])).toEqual([['marker_1','observed',null],['clip_1','uncertain','opaque_clip']]);
  await unchangedFences(f.paths.profileRoot);
  expect((await f.make().rollback()).phase).toBe('rolledBack');
  expect(await inventory(f.paths.profileRoot)).toEqual(f.options.rollback.profileFiles);
  expect(await fs.readFile(join(f.paths.profileRoot,f.legacy),'utf8')).toBe(f.raw);
  await unchangedFences(f.paths.profileRoot);expect(migrateLegacyMomentsToSqlite).toHaveBeenCalledTimes(1);
});
test('rejects a changed migration selection unless covered by the publisher signature',async()=>{
  const f=await fixture();f.options.image.profileMigration={kind:'moments-json-to-sqlite-v1',directory:'root'};
  f.options.profileMigration={kind:'moments-json-to-sqlite-v1',directory:'root'};
  f.options.manifest.sha256=directoryReleaseImageHash(f.options.image);
  expect(()=>f.make()).toThrow('SIGNATURE_INVALID');expect(migrateLegacyMomentsToSqlite).not.toHaveBeenCalled();
});
test.each(['missing-opt-in','unsigned-opt-in','settings','archive','removed-receipt','added-file','sidecar'] as const)('rejects an undeclared or destructive migration plan: %s',async change=>{
  const f=await fixture();
  if(change==='missing-opt-in')delete (f.options as Partial<SignedDirectoryUpgradeOptions>).profileMigration;
  if(change==='unsigned-opt-in'){delete f.options.image.profileMigration;f.signFixture()}
  if(change==='settings')f.options.target.profileFiles.find(x=>x.path==='config/dashboard.json')!.sha256='e'.repeat(64);
  if(change==='archive')f.options.target.profileFiles.find(x=>x.path===f.legacy+'.pre-sqlite.json')!.sha256='e'.repeat(64);
  if(change==='removed-receipt')f.options.target.profileFiles=f.options.target.profileFiles.filter(x=>!x.path.endsWith('prediction-intents.sqlite'));
  if(change==='added-file')f.options.target.profileFiles.push({path:'new-unknown.txt',bytes:1,sha256:'f'.repeat(64)});
  if(change==='sidecar')f.options.rollback.profileFiles.push({path:f.sqlite+'-wal',bytes:1,sha256:'f'.repeat(64)});
  expect(()=>f.make()).toThrow();expect(migrateLegacyMomentsToSqlite).not.toHaveBeenCalled();
});
test('does not trust an empty SQLite journal merely because its hash was declared in the target inventory',async()=>{
  const f=await fixture();const original=new MomentsSqliteStorage(join(f.reference,f.sqlite));
  await original.compareAndSwap(f.raw,envelope([]));f.options.target.profileFiles=await inventory(f.reference);
  const p=f.make();await p.register(f.options.manifest,f.paths.sourcePackage);
  expect((await p.install()).pending?.operation).toBe('migrate');
  expect(await inventory(f.paths.profileRoot)).toEqual(f.options.rollback.profileFiles);await unchangedFences(f.paths.profileRoot);
});
test('recovers a completed migration after lost acknowledgement by readback, without a second conversion',async()=>{
  const f=await fixture();const native=await vi.importActual<typeof import('../apps/server/src/streamcockpit-moments-legacy-migration.js')>('../apps/server/src/streamcockpit-moments-legacy-migration.js');
  vi.mocked(migrateLegacyMomentsToSqlite).mockImplementationOnce(async(...args)=>{await native.migrateLegacyMomentsToSqlite(...args);throw Error('lost acknowledgement PRIVATE_FIXTURE')});
  const p=f.make();await p.register(f.options.manifest,f.paths.sourcePackage);
  const first=await p.install();expect(first.pending?.operation).toBe('migrate');expect(JSON.stringify(first)).not.toContain('PRIVATE_FIXTURE');
  expect(await inventory(f.paths.profileRoot)).toEqual(f.options.rollback.profileFiles);
  expect((await f.make().install()).phase).toBe('installed');expect(migrateLegacyMomentsToSqlite).toHaveBeenCalledTimes(1);
  expect(await new MomentsSqliteStorage(join(f.paths.profileRoot,f.sqlite)).read()).toBe(f.raw);
});
test('leaves partial conversion and its durable intent blocked without replay or deleting recovery evidence',async()=>{
  const f=await fixture(),native=(await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')).rename;
  vi.mocked(fs.rename).mockImplementation(async(from,to)=>{
    if(String(from).startsWith(f.paths.preparedProfile)&&String(from).endsWith('streamcockpit-moments.json'))throw Error('interrupted before archive');
    await native(from,to);
  });
  const p=f.make();await p.register(f.options.manifest,f.paths.sourcePackage);expect((await p.install()).pending?.operation).toBe('migrate');
  expect((await f.make().install()).pending?.operation).toBe('migrate');expect(migrateLegacyMomentsToSqlite).toHaveBeenCalledTimes(1);
  expect(await fs.readFile(join(f.paths.preparedProfile,f.legacy),'utf8')).toBe(f.raw);
  expect(await fs.stat(join(f.paths.preparedProfile,f.sqlite))).toBeDefined();
  expect(await fs.stat(join(f.paths.preparedProfile,f.legacy+'.writer.lock'))).toBeDefined();
  expect(await inventory(f.paths.profileRoot)).toEqual(f.options.rollback.profileFiles);
});
test('refuses rollback after new F09 writes instead of discarding an uncertain receipt',async()=>{
  const f=await fixture(),p=f.make();await p.register(f.options.manifest,f.paths.sourcePackage);await p.install();
  const store=new MomentsSqliteStorage(join(f.paths.profileRoot,f.sqlite));
  const changed=envelope([...observations,{...observations[1]!,correlationId:'later_uncertain',sourceEventId:'later_event'}]);
  expect(await store.compareAndSwap(f.raw,changed)).toBe(true);
  const result=await f.make().rollback();expect(result.rolledBack).toBe(false);expect(result.pending?.operation).toBe('rollback');
  expect(await store.read()).toBe(changed);await unchangedFences(f.paths.profileRoot);
});
test('runs prepare, migrated install and exact rollback in distinct temporary Windows processes',async()=>{
  const f=await fixture(),config=join(f.root,'migration.json');
  await fs.writeFile(config,JSON.stringify({applicationData:f.applicationData,rootUserData:f.paths.profileRoot,options:f.options}));
  for(const action of ['prepare','install','rollback']){
    const child=spawnSync(process.execPath,['--import','tsx','tests/fixtures/streamcockpit3-upgrade-moments-migration-process.ts',action,config],
      {cwd:process.cwd(),encoding:'utf8',windowsHide:true,timeout:20000,maxBuffer:128*1024});
    expect(child.error).toBeUndefined();expect(child.status,child.stderr).toBe(0);
    const result=JSON.parse(child.stdout.trim());expect(result.pending).toBe(false);
    expect(result.phase).toBe(action==='prepare'?'verified':action==='install'?'installed':'rolledBack');
  }
  expect(await inventory(f.paths.profileRoot)).toEqual(f.options.rollback.profileFiles);await unchangedFences(f.paths.profileRoot);
},60000);

test('rejects semantically destructive conversion even when all declared target hashes match',async()=>{
  const f=await fixture(),native=await vi.importActual<typeof import('../apps/server/src/streamcockpit-moments-legacy-migration.js')>('../apps/server/src/streamcockpit-moments-legacy-migration.js');
  await new MomentsSqliteStorage(join(f.reference,f.sqlite)).compareAndSwap(f.raw,envelope([]));
  f.options.target.profileFiles=await inventory(f.reference);
  vi.mocked(migrateLegacyMomentsToSqlite).mockImplementationOnce(async(...args)=>{
    const result=await native.migrateLegacyMomentsToSqlite(...args);
    await new MomentsSqliteStorage(args[0]).compareAndSwap(f.raw,envelope([]));
    return result;
  });
  const p=f.make();await p.register(f.options.manifest,f.paths.sourcePackage);
  expect((await p.install()).pending?.operation).toBe('migrate');
  expect(await inventory(f.paths.preparedProfile)).toEqual(f.options.target.profileFiles);
  expect((await f.make().install()).pending?.operation).toBe('migrate');
  expect(migrateLegacyMomentsToSqlite).toHaveBeenCalledTimes(1);
  expect(await inventory(f.paths.profileRoot)).toEqual(f.options.rollback.profileFiles);
});
test('recovers after an actual isolated Windows process exits with a completed migration still pending',async()=>{
  const f=await fixture(),config=join(f.root,'migration.json');
  await fs.writeFile(config,JSON.stringify({applicationData:f.applicationData,rootUserData:f.paths.profileRoot,options:f.options}));
  const launch=(action:string)=>spawnSync(process.execPath,['--import','tsx',
    'tests/fixtures/streamcockpit3-upgrade-moments-migration-process.ts',action,config],
    {cwd:process.cwd(),encoding:'utf8',windowsHide:true,timeout:20000,maxBuffer:128*1024});
  const crash=launch('crash-migrate');expect(crash.error).toBeUndefined();expect(crash.status,crash.stderr).toBe(71);
  const journal=new SqliteUpgradeJournal(f.paths.journalDirectory);
  expect((await journal.exclusive(()=>journal.read()))?.pending?.operation).toBe('migrate');
  expect(await inventory(f.paths.profileRoot)).toEqual(f.options.rollback.profileFiles);
  const preparedBefore=await inventory(f.paths.preparedProfile),recovered=launch('install');
  expect(recovered.error).toBeUndefined();expect(recovered.status,recovered.stderr).toBe(0);
  expect(JSON.parse(recovered.stdout.trim())).toMatchObject({phase:'installed',pending:false,installed:true});
  expect(await inventory(f.paths.preparedProfile)).toEqual(preparedBefore);
  expect(await new MomentsSqliteStorage(join(f.paths.profileRoot,f.sqlite)).read()).toBe(f.raw);
  await unchangedFences(f.paths.profileRoot);
},60000);
