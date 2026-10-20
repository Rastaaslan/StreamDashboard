import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { AutonomyService } from '../apps/server/src/autonomy-service.js';
import { equal, merge, safeJSON } from '../apps/mobile/shared/autonomy.js';
import { isManagementApiAllowed, isRemoteApiAllowed } from '../apps/server/src/remote-api-policy.js';
const dirs:string[]=[];
afterEach(async()=>{for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true});});
async function setup(){const dir=await mkdtemp(path.join(tmpdir(),'sd-autonomy-'));dirs.push(dir);const file=path.join(dir,'autonomy.json');return {file,service:await AutonomyService.open(file)};}
describe('Autonomous management',()=>{
 it('merges independent fields including occurrence exceptions; keeps delete/edit conflicts',()=>{
  expect(merge({title:'A',recurrence:{exceptions:{}}},{title:'B',recurrence:{exceptions:{}}},{title:'A',recurrence:{exceptions:{day:{cancelled:true}}}})).toEqual({value:{title:'B',recurrence:{exceptions:{day:{cancelled:true}}}},conflicts:[]});
  expect(merge({title:'A'},null,{title:'B'}).conflicts).toEqual(['élément']);
  expect(merge({title:'A'},{title:'B'},{title:'C'}).conflicts).toEqual(['title']);
  expect(equal({b:1,a:2},{a:2,b:1})).toBe(true);
  expect(safeJSON(JSON.parse('{"__proto__":{}}'))).toBe(false);
 });
 it('deduplicates a lost acknowledgement after a server restart',async()=>{
  const {file,service}=await setup();let value:unknown=null,calls=0;
  const edit={id:'operation_123',key:'planning/new',base:null,value:{title:'Essai'}};
  const write=async(v:unknown)=>{calls++;value=v;expect(JSON.parse(await readFile(file,'utf8')).receipts[edit.id].status).toBe('running');};
  expect((await service.apply(service.workspace,edit,()=>value,write)).status).toBe('applied');
  const reopened=await AutonomyService.open(file);
  expect((await reopened.apply(reopened.workspace,edit,()=>value,write)).status).toBe('applied');expect(calls).toBe(1);
  await expect(reopened.apply(reopened.workspace,{...edit,value:{title:'Different'}},()=>value,write)).rejects.toThrow('réutilisé');
 });
 it('blocks competing writes and allows an unrelated resource',async()=>{
  const {service}=await setup();let value={title:'B',description:'A'};
  const first={id:'operation_abc',key:'planning/first',base:{title:'A',description:'A'},value:{title:'C',description:'A'}};
  expect((await service.apply(service.workspace,first,()=>value,async v=>{value=v;})).status).toBe('conflict');
  expect(value.title).toBe('B');
  expect((await service.apply(service.workspace,{...first,id:'operation_def',key:'planning/second',base:null,value:{title:'Second'}},()=>null,async()=>{})).status).toBe('applied');
 });
 it('reconciles an interrupted write without replaying its effects',async()=>{
  const {file,service}=await setup();const edit={id:'operation_crash',key:'planning/new',base:null,value:{title:'Saved'}};
  const journal=JSON.parse(await readFile(file,'utf8'));journal.receipts[edit.id]={status:'running',signature:createHash('sha256').update(JSON.stringify(edit)).digest('hex')};await writeFile(file,JSON.stringify(journal));
  const reopened=await AutonomyService.open(file);let writes=0;
  expect((await reopened.apply(service.workspace,edit,()=>({title:'Saved'}),async()=>{writes++;})).status).toBe('applied');expect(writes).toBe(0);
  journal.receipts[edit.id].status='running';await writeFile(file,JSON.stringify(journal));
  const uncertain=await AutonomyService.open(file);
  expect((await uncertain.apply(service.workspace,edit,()=>({title:'Other'}),async()=>{writes++;})).status).toBe('uncertain');expect(writes).toBe(0);
 });
 it('rejects a different host identity and requires management pairing',async()=>{
  const {service}=await setup();await expect(service.apply('another-host',{id:'operation_auth',key:'settings/root',base:{},value:{}},()=>({}),async()=>{})).rejects.toThrow('identité');
  expect(isManagementApiAllowed('POST','/v2/autonomy/sync')).toBe(true);
  expect(isRemoteApiAllowed('POST','/v2/autonomy/sync')).toBe(false);
 });
});
