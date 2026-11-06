import {afterEach,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {AudioReceiptSqlite} from '../apps/server/src/streamcockpit-audio-receipts-sqlite.js';
import {validateAudioReceipt,type AudioReceipt,type AudioReceiptContext} from '../apps/server/src/streamcockpit-audio-receipts.js';
import {HostWindowsDurableJournals} from '../apps/server/src/streamcockpit-host-journals.js';
const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true})});
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'sc3-audio-receipts-'));roots.push(root);
 const file=join(root,'streamcockpit-mixer-receipts.sqlite'),id=randomUUID();
 const context:AudioReceiptContext={actor:'paired-controller',authority:'FIXE-identity',host:'FIXE-identity:1',runtime:randomUUID()};
 const before={sourceId:'Micro QA',inputUuid:'observed-uuid',generation:1,gain:.75,mute:false,observedAt:Date.now()};
 const receipt:AudioReceipt={schemaVersion:1,kind:'streamcockpit-mixer-receipt',confirmationId:id,status:'confirmed',
  change:{sourceId:before.sourceId,gain:.5},before,after:{...before,gain:.5},rollbackAvailable:true};
 return {root,file,id,context,receipt,store:new AudioReceiptSqlite(file)};
}
it('persists a one-way audio intent and complete OBS readback across independent store instances',async()=>{
 const f=await fixture();expect(f.store.reserve(f.id,f.context,f.receipt.change)).toBe(true);
 expect(f.store.read(f.id,f.context.actor,f.context.authority)?.receipt).toBeUndefined();
 f.store.complete(f.id,f.context,f.receipt);
 const next=new AudioReceiptSqlite(f.file);
 expect(next.read(f.id,f.context.actor,f.context.authority)?.receipt).toEqual(f.receipt);
 expect(next.reserve(f.id,f.context,f.receipt.change)).toBe(false);
 next.complete(f.id,f.context,f.receipt);
 expect(next.history(f.context.actor,f.context.authority)).toHaveLength(1);
});
it('does not invent completion for a retained intent or expose another actor or FIXE identity',async()=>{
 const f=await fixture();f.store.reserve(f.id,f.context,f.receipt.change);
 const next=new AudioReceiptSqlite(f.file);
 expect(next.read(f.id,f.context.actor,f.context.authority)).toMatchObject({id:f.id,change:f.receipt.change});
 expect(next.read(f.id,'other',f.context.authority)).toBeUndefined();
 expect(next.read(f.id,f.context.actor,'other')).toBeUndefined();
 expect(next.history('other',f.context.authority)).toEqual([]);
 expect(next.history(f.context.actor,'other')).toEqual([]);
});
it.each(['actor','authority','host','runtime']as const)('refuses completion by a different %s and preserves original intent',async field=>{
 const f=await fixture();f.store.reserve(f.id,f.context,f.receipt.change);
 const other={...f.context,[field]:field==='runtime'?randomUUID():'other'};
 expect(()=>f.store.complete(f.id,other,f.receipt)).toThrow();
 expect(new AudioReceiptSqlite(f.file).read(f.id,f.context.actor,f.context.authority)?.receipt).toBeUndefined();
});
it('refuses rewriting a terminal receipt and cannot overwrite another reservation',async()=>{
 const f=await fixture();f.store.reserve(f.id,f.context,f.receipt.change);f.store.complete(f.id,f.context,f.receipt);
 const uncertain:AudioReceipt={schemaVersion:1,kind:'streamcockpit-mixer-receipt',confirmationId:f.id,
  status:'uncertain',change:f.receipt.change,rollbackAvailable:false};
 expect(()=>f.store.complete(f.id,f.context,uncertain)).toThrow();
 expect(new AudioReceiptSqlite(f.file).read(f.id,f.context.actor,f.context.authority)?.receipt).toEqual(f.receipt);
});
it.each(['foreign','corrupt','wal','checksum']as const)('refuses %s evidence without reset or mutation',async variant=>{
 const f=await fixture();
 if(variant==='foreign'){const db=new DatabaseSync(f.file);db.exec('CREATE TABLE other (x TEXT)');db.close()}
 else if(variant==='corrupt')await writeFile(f.file,'NOT SQLITE');
 else{
  f.store.reserve(f.id,f.context,f.receipt.change);
  if(variant==='wal')await writeFile(f.file+'-wal','uncertain sidecar');
  else{const db=new DatabaseSync(f.file);db.prepare('UPDATE audio_receipts SET sha256=?').run('0'.repeat(64));db.close()}
 }
 const before=await readFile(f.file);
 expect(()=>new AudioReceiptSqlite(f.file).read(f.id,f.context.actor,f.context.authority)).toThrow();
 expect(await readFile(f.file)).toEqual(before);
});
it('never silently ages out historical or uncertain receipts and pages complete history',async()=>{
 const f=await fixture();
 for(let i=0;i<103;i++)expect(f.store.reserve(randomUUID(),f.context,f.receipt.change)).toBe(true);
 const first=f.store.history(f.context.actor,f.context.authority);
 expect(first).toHaveLength(100);expect(first[0]!.sequence).toBe(103);
 const rest=f.store.history(f.context.actor,f.context.authority,first.at(-1)!.sequence);
 expect(rest).toHaveLength(3);expect(rest.at(-1)!.sequence).toBe(1);
 expect(new Set([...first,...rest].map(r=>r.record.id)).size).toBe(103);
 expect([...first,...rest].every(r=>r.record.receipt===undefined)).toBe(true);
});
it('cannot write through a contended SQLite transaction and does not automatically retry afterward',async()=>{
 const f=await fixture();f.store.reserve(f.id,f.context,f.receipt.change);
 const db=new DatabaseSync(f.file);db.exec('BEGIN IMMEDIATE');
 try{expect(()=>f.store.complete(f.id,f.context,f.receipt)).toThrow()}
 finally{db.exec('ROLLBACK');db.close()}
 expect(()=>f.store.complete(f.id,f.context,f.receipt)).toThrow();
 expect(new AudioReceiptSqlite(f.file).read(f.id,f.context.actor,f.context.authority)?.receipt).toBeUndefined();
});
it('validates precise provider outcomes rather than accepting a rollback for an uncertain result',async()=>{
 const f=await fixture();
 for(const patch of [{status:'uncertain'},{status:'rejected'},{confirmationId:'not-a-uuid'},{rollbackAvailable:false},
  {after:{...f.receipt.after,inputUuid:'replacement'}},{after:{...f.receipt.after,gain:.8}}])
  expect(()=>validateAudioReceipt({...f.receipt,...patch} as AudioReceipt)).toThrow();
 expect(()=>validateAudioReceipt(f.receipt)).not.toThrow();
});
(process.platform==='win32'?it:it.skip)('registers the actual audio journal with host maintenance and prevents mutations while quiesced',async()=>{
 const f=await fixture(),host=new HostWindowsDurableJournals(f.root);
 const audio=host.audioReceipts();expect(host.audioReceipts()).toBe(audio);await host.momentsStorage();
 expect(host.gate.status.coverage).toEqual(['automod','mixer','moments','prediction']);
 audio.reserve(f.id,f.context,f.receipt.change);audio.complete(f.id,f.context,f.receipt);
 await host.gate.withQuiesced(async()=>{
  expect(()=>audio.reserve(randomUUID(),f.context,f.receipt.change)).toThrow('PAUSED_OR_BLOCKED');
  expect(audio.read(f.id,f.context.actor,f.context.authority)?.receipt).toEqual(f.receipt);
 });
 expect(host.gate.status.phase).toBe('active');
});

it.each(['pending','confirmed'])('retains %s through abrupt Windows child-process exit and denies duplicate admission',async mode=>{
 const f=await fixture();await writeFile(join(f.root,'test-input.json'),JSON.stringify({id:f.id,context:f.context,receipt:f.receipt}));
 const {spawn}=await import('node:child_process');const {resolve}=await import('node:path');
 const child=(operation:string)=>new Promise<{code:number|null;output:string}>((yes,no)=>{
  const c=spawn(process.execPath,['--import','tsx',resolve('tests/fixtures/streamcockpit3-audio-receipts-process.ts'),operation,f.root],
   {windowsHide:true,stdio:['ignore','pipe','pipe']});let output='',errors='';
  const timeout=setTimeout(()=>{c.kill();no(Error('Fixture timeout '+errors))},15000);
  c.stdout.on('data',d=>{output+=String(d)});c.stderr.on('data',d=>{errors+=String(d)});
  c.once('error',e=>{clearTimeout(timeout);no(e)});c.once('close',code=>{clearTimeout(timeout);yes({code,output})});
 });
 expect((await child(mode)).code).toBe(71);
 const observed=await child('read');expect(observed.code).toBe(0);
 const value=JSON.parse(observed.output);expect(value.repeatAccepted).toBe(false);
 if(mode==='confirmed')expect(value.saved.receipt).toEqual(f.receipt);else expect(value.saved.receipt).toBeUndefined();
},20000);

(process.platform==='win32'?it:it.skip).each(['removed','changed','sidecar'])('F10 refuses %s mixer receipt evidence during an application/data rollback',async variant=>{
 const f=await fixture();const {createWindowsDirectoryUpgradePlanner}=await import('../apps/desktop/src/streamcockpit-upgrade-directory.js');
 const profile=[{path:'streamcockpit-mixer-receipts.sqlite',bytes:1,sha256:'a'.repeat(64)}];
 const expectation=(version:string)=>({identity:{version,revision:'a'.repeat(40),applicationId:'fixture',signer:'PIN'},
  packageFiles:[{path:'app.exe',bytes:1,sha256:'b'.repeat(64)}],profileFiles:structuredClone(profile)});
 const rollback=expectation('2.1.0'),target=expectation('3.0.0');
 if(variant==='removed')target.profileFiles=[{path:'empty.json',bytes:1,sha256:'c'.repeat(64)}];
 else if(variant==='changed')target.profileFiles[0]!.sha256='c'.repeat(64);
 else target.profileFiles.push({path:profile[0]!.path+'-wal',bytes:1,sha256:'c'.repeat(64)});
 const prep={stage:async()=>({reference:'unused'}),verify:async()=>true,backup:async()=>({reference:'unused'}),migrate:async()=>({reference:'unused'})};
 expect(()=>createWindowsDirectoryUpgradePlanner({manifest:{id:'audio-preservation',version:'3.0.0',fromVersion:'2.1.0',
  target:'desktop',source:'https://example.test/fixture',sha256:'a'.repeat(64),signature:{keyId:'test',value:'test'},schema:{from:1,to:1}},
  journalDirectory:join(f.root,'journal'),packageRoot:join(f.root,'app'),profileRoot:join(f.root,'profile'),
  preparedPackage:join(f.root,'stage'),preparedProfile:join(f.root,'migration'),backupPackage:join(f.root,'old-app'),backupProfile:join(f.root,'old-data'),
  target,rollback,runtimeStopped:async()=>true,attestInstalled:async()=>undefined},prep,{assessRestartSafety:async()=>({safe:true})}))
  .toThrow('DURABLE_JOURNAL_TRANSFORM_UNQUALIFIED');
});
