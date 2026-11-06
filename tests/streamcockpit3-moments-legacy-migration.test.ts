import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { link, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { MomentsPipeline } from '../apps/server/src/streamcockpit-moments.js';
import { MomentsSqliteStorage } from '../apps/server/src/streamcockpit-moments-sqlite.js';
import { migrateLegacyMomentsToSqlite } from '../apps/server/src/streamcockpit-moments-legacy-migration.js';

const winIt = process.platform === 'win32' ? it : it.skip;
const roots: string[] = [];
const marker = {
  sessionId:'session_1',correlationId:'request_1',sourceEventId:'source_1',
  source:'obs' as const,instant:1000,title:'Legacy marker',status:'observed' as const,
};
async function fixture() {
  const root=await mkdtemp(join(tmpdir(),'sc3-f09-legacy-migrate-'));roots.push(root);
  const sqlite=join(root,'streamcockpit-moments.sqlite');
  const legacy=join(root,'streamcockpit-moments.json');
  let value:string|null=null;
  const pipeline=new MomentsPipeline({
    read:async()=>value,
    compareAndSwap:async(expected,replacement)=>{
      if(expected!==value)return false;
      value=replacement;return true;
    },
  });
  await pipeline.record(marker);
  const raw=String(value??'');
  if(!raw)throw Error('FIXTURE_MISSING');
  await writeFile(legacy,raw,{flag:'wx'});
  return {root,sqlite,legacy,raw};
}
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{force:true,recursive:true})});

winIt('explicit one-shot migration preserves exact archive and exposes old markers and new SQLite writes',async()=>{
  const f=await fixture();
  const result=await migrateLegacyMomentsToSqlite(f.sqlite,f.legacy);
  expect(result).toEqual({
    kind:'SC3_MOMENTS_LEGACY_MIGRATED',archive:f.legacy+'.pre-sqlite.json',
    bytes:Buffer.byteLength(f.raw),sha256:createHash('sha256').update(f.raw).digest('hex'),
  });
  expect(existsSync(f.legacy)).toBe(false);
  expect(existsSync(f.legacy+'.writer.lock')).toBe(false);
  expect(await readFile(result.archive,'utf8')).toBe(f.raw);
  const storage=new MomentsSqliteStorage(f.sqlite,f.legacy);
  expect(await storage.read()).toBe(f.raw);
  const pipeline=new MomentsPipeline(storage);
  expect((await pipeline.exportObserved('session_1'))?.markers).toMatchObject([
    {correlationId:'request_1',title:'Legacy marker',sequence:1},
  ]);
  expect((await pipeline.record(marker)).outcome).toBe('replayed');
  expect((await pipeline.record({...marker,correlationId:'request_2',sourceEventId:'source_2'})).outcome).toBe('created');
  const reopened=new MomentsPipeline(new MomentsSqliteStorage(f.sqlite,f.legacy));
  expect((await reopened.export('session_1')).markers.map(m=>m.correlationId)).toEqual(['request_1','request_2']);
  // Archive remains a copy of the pre-migration bytes after subsequent writes.
  expect(await readFile(result.archive,'utf8')).toBe(f.raw);
});

winIt('invalid checksummed journal cannot create SQLite, archive or leave a writer lock',async()=>{
  const f=await fixture();const corrupt=JSON.stringify({payload:'{}',sha256:'0'.repeat(64)});
  await writeFile(f.legacy,corrupt);
  await expect(migrateLegacyMomentsToSqlite(f.sqlite,f.legacy)).rejects
    .toThrow('MOMENTS_MIGRATION_SOURCE_INVALID');
  expect(await readFile(f.legacy,'utf8')).toBe(corrupt);
  expect(existsSync(f.sqlite)).toBe(false);
  expect(existsSync(f.legacy+'.pre-sqlite.json')).toBe(false);
  expect(existsSync(f.legacy+'.writer.lock')).toBe(false);
});

winIt('noncanonical duplicate JSON keys must not discard an earlier payload',async()=>{
  const f=await fixture();
  const attack=f.raw.replace('{"payload":','{"payload":"shadow","payload":');
  await writeFile(f.legacy,attack);
  await expect(migrateLegacyMomentsToSqlite(f.sqlite,f.legacy)).rejects
    .toThrow('MOMENTS_MIGRATION_SOURCE_INVALID');
  expect(await readFile(f.legacy,'utf8')).toBe(attack);
  expect(existsSync(f.sqlite)).toBe(false);
  expect(existsSync(f.legacy+'.pre-sqlite.json')).toBe(false);
});

winIt('rejects already-present SQLite bytes and a pre-existing archive without overwriting either',async()=>{
  const f=await fixture();
  await writeFile(f.sqlite,'do not overwrite this SQLite');
  await expect(migrateLegacyMomentsToSqlite(f.sqlite,f.legacy)).rejects
    .toThrow('MOMENTS_MIGRATION_TARGET_EXISTS');
  expect(await readFile(f.sqlite,'utf8')).toBe('do not overwrite this SQLite');
  expect(await readFile(f.legacy,'utf8')).toBe(f.raw);
  await rm(f.sqlite);await writeFile(f.legacy+'.pre-sqlite.json','older archive');
  await expect(migrateLegacyMomentsToSqlite(f.sqlite,f.legacy)).rejects
    .toThrow('MOMENTS_MIGRATION_TARGET_EXISTS');
  expect(await readFile(f.legacy+'.pre-sqlite.json','utf8')).toBe('older archive');
  expect(existsSync(f.sqlite)).toBe(false);
});

winIt('honors the legacy writer lock, never racing with an in-flight producer',async()=>{
  const f=await fixture();
  await writeFile(f.legacy+'.writer.lock','existing writer',{flag:'wx'});
  await expect(migrateLegacyMomentsToSqlite(f.sqlite,f.legacy)).rejects
    .toThrow('MOMENTS_MIGRATION_WRITER_LOCKED');
  expect(await readFile(f.legacy,'utf8')).toBe(f.raw);
  expect(await readFile(f.legacy+'.writer.lock','utf8')).toBe('existing writer');
  expect(existsSync(f.sqlite)).toBe(false);
});

winIt('does not attempt migration from an empty/missing source, or to UNC/alternate streams',async()=>{
  const f=await fixture();
  await rm(f.legacy);
  await expect(migrateLegacyMomentsToSqlite(f.sqlite,f.legacy)).rejects.toThrow();
  expect(existsSync(f.sqlite)).toBe(false);
  expect(existsSync(f.legacy+'.writer.lock')).toBe(false);
  for(const invalid of ['relative.sqlite',String.raw`\\\\server\share\data.sqlite`,f.sqlite+':stream',String.raw`\Windows\Temp\data.sqlite`,join(f.root,'unrelated.sqlite')]) {
    await expect(migrateLegacyMomentsToSqlite(invalid,f.legacy)).rejects
      .toThrow('MOMENTS_MIGRATION_UNSAFE_PATH');
  }
});

winIt('interrupted pre-existing SQLite target remains blocked rather than silently overriding legacy',async()=>{
  const f=await fixture();
  // Simulates a crash after the exclusive target reservation and before commit.
  await writeFile(f.sqlite,Buffer.alloc(0),{flag:'wx'});
  await expect(migrateLegacyMomentsToSqlite(f.sqlite,f.legacy)).rejects
    .toThrow('MOMENTS_MIGRATION_TARGET_EXISTS');
  const store=new MomentsSqliteStorage(f.sqlite,f.legacy);
  await expect(store.read()).rejects.toThrow('MOMENTS_LEGACY_MIGRATION_REQUIRED');
  expect(await readFile(f.legacy,'utf8')).toBe(f.raw);
  expect(existsSync(f.legacy+'.pre-sqlite.json')).toBe(false);
});

winIt('refuses multiply linked legacy files without altering their other owner',async()=>{
  const f=await fixture();
  const hardlink=join(f.root,'other-owner.json');
  await link(f.legacy,hardlink);
  await expect(migrateLegacyMomentsToSqlite(f.sqlite,f.legacy)).rejects
    .toThrow('MOMENTS_MIGRATION_UNSAFE_SOURCE');
  expect(await readFile(hardlink,'utf8')).toBe(f.raw);
  expect(await readFile(f.legacy,'utf8')).toBe(f.raw);
  expect(existsSync(f.sqlite)).toBe(false);
  expect(existsSync(f.legacy+'.writer.lock')).toBe(false);
});

winIt('a fresh Windows process can reopen the migrated timeline without touching the archived original',async()=>{
  const f=await fixture();
  await migrateLegacyMomentsToSqlite(f.sqlite,f.legacy);
  const script=`import { MomentsPipeline } from './apps/server/src/streamcockpit-moments.ts';
    import { MomentsSqliteStorage } from './apps/server/src/streamcockpit-moments-sqlite.ts';
    const pipeline=new MomentsPipeline(new MomentsSqliteStorage(${JSON.stringify(f.sqlite)},${JSON.stringify(f.legacy)}));
    const output=await pipeline.exportObserved('session_1');
    if(output?.markers.length!==1||output.markers[0]?.title!=='Legacy marker')process.exit(74);
    process.exit(73);`;
  const child=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',script],{
    cwd:process.cwd(),encoding:'utf8',timeout:12000,
  });
  expect(child.error).toBeUndefined();
  expect(child.status).toBe(73);
  expect(await readFile(f.legacy+'.pre-sqlite.json','utf8')).toBe(f.raw);
},20000);
