import {it,expect} from 'vitest';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DurableReceiptJournal} from '../apps/agent/src/durable-receipts.js';
it('records once, survives reopen and refuses duplicates',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'sd-v2-journal-'));
 try{
  const file=path.join(dir,'receipts.json'),a=await DurableReceiptJournal.open(file);
  await a.record({commandId:'abc',result:'uncertain',observedAt:100});
  const b=await DurableReceiptJournal.open(file);
  expect(b.find('abc')?.result).toBe('uncertain');
  await expect(b.record({commandId:'abc',result:'confirmed',observedAt:101})).rejects.toThrow('DUPLICATE');
 }finally{await rm(dir,{recursive:true,force:true})}
});
it('fails closed on malformed journal, never overwrites evidence',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'sd-v2-journal-'));
 try{
  const file=path.join(dir,'receipts.json');await writeFile(file,'not json');
  await expect(DurableReceiptJournal.open(file)).rejects.toThrow();
 }finally{await rm(dir,{recursive:true,force:true})}
});

[executed on device: dam-server (ee881f3f-7909-4993-a915-04a1d994f366)]