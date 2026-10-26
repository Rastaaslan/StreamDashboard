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

it('refuses writing when another writer owns the file lock',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'sd-v2-journal-'));
 try {
  const file=path.join(dir,'receipts.json');
  const journal=await DurableReceiptJournal.open(file);
  await writeFile(file+'.writer.lock','foreign-writer');
  await expect(journal.record({commandId:'x2',result:'uncertain',observedAt:200})).rejects.toThrow();
  await expect(DurableReceiptJournal.open(file)).rejects.toThrow('WRITER_LOCKED');
 }finally{await rm(dir,{recursive:true,force:true})}
});


it('rejects structurally corrupt receipts rather than appending to them',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'sd-v2-journal-'));
 try {
  const file=path.join(dir,'receipts.json');
  const journal=await DurableReceiptJournal.open(file);
  await writeFile(file,JSON.stringify([{commandId:'other',result:'not-real',observedAt:5}]));
  await expect(journal.record({commandId:'new',result:'uncertain',observedAt:100})).rejects.toThrow('CORRUPT_JOURNAL');
  await expect(DurableReceiptJournal.open(file)).rejects.toThrow('CORRUPT_JOURNAL');
 }finally{await rm(dir,{recursive:true,force:true})}
});
it('reconciles another writer record if journal changed since this process opened it',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'sd-v2-journal-'));
 try {
  const file=path.join(dir,'receipts.json');
  const first=await DurableReceiptJournal.open(file),second=await DurableReceiptJournal.open(file);
  await first.record({commandId:'one',result:'uncertain',observedAt:1});
  await second.record({commandId:'two',result:'confirmed',observedAt:2});
  const again=await DurableReceiptJournal.open(file);
  expect(again.find('one')?.result).toBe('uncertain');
  expect(again.find('two')?.result).toBe('confirmed');
  expect(second.find('one')?.result).toBe('uncertain');
 }finally{await rm(dir,{recursive:true,force:true})}
});
