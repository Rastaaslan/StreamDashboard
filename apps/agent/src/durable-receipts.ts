import {mkdir,open,readFile,rename,rm} from 'node:fs/promises';
import path from 'node:path';
import type {AgentReceipt} from '../../../packages/contracts/src/agent-v2.js';

const validId = (value:unknown):value is string =>
  typeof value==='string' && /^[A-Za-z0-9_-]{1,96}$/.test(value);
const outcomes=new Set(['accepted','executed','confirmed','uncertain','refused']);
const maxRecords=100_000;

/** Only persisted receipts in this prototype, not a permit to execute OBS.
 * A stranded lock is intentionally NOT auto-recovered: manual inspection is required.
 * This is a single-host experimental journal; test on Windows before service use.
 */
function decodeJournal(raw:string):Map<string,AgentReceipt> {
  const parsed:unknown=JSON.parse(raw);
  if(!Array.isArray(parsed)||parsed.length>maxRecords)throw new Error('CORRUPT_JOURNAL');
  const receipts=new Map<string,AgentReceipt>();
  for(const candidate of parsed) {
    if(!candidate||typeof candidate!=='object'||Array.isArray(candidate))
      throw new Error('CORRUPT_JOURNAL');
    const value=candidate as AgentReceipt;
    if(!validId(value.commandId)||!outcomes.has(value.result)||
      !Number.isFinite(value.observedAt)||
      (value.reason!==undefined&&(typeof value.reason!=='string'||value.reason.length>256))||
      receipts.has(value.commandId)) throw new Error('CORRUPT_JOURNAL');
    receipts.set(value.commandId,{...value});
  }
  return receipts;
}
export class DurableReceiptJournal {
  private constructor(
    private readonly file:string,
    private readonly receipts:Map<string,AgentReceipt>,
  ) {}
  private chain:Promise<void>=Promise.resolve();

  private static async requireExclusiveWriter(file:string):Promise<() => Promise<void>> {
    const guard=await open(file+'.writer.lock','wx',0o600);
    try{await guard.writeFile(String(process.pid));await guard.sync()}
    catch(error){await guard.close();throw error}
    return async()=>{await guard.close();await rm(file+'.writer.lock',{force:true})};
  }

  static async open(file:string):Promise<DurableReceiptJournal> {
    await mkdir(path.dirname(file),{recursive:true});
    let data:string;
    try{data=await readFile(file,'utf8')}
    catch(error) {
      if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
      const descriptor=await open(file,'wx',0o600);
      try{await descriptor.writeFile('[]');await descriptor.sync()}finally{await descriptor.close()}
      data='[]';
    }
    try{await readFile(file+'.writer.lock');throw new Error('WRITER_LOCKED')}
    catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
    return new DurableReceiptJournal(file,decodeJournal(data));
  }

  find(id:string):AgentReceipt|undefined {
    const receipt=this.receipts.get(id);
    return receipt?{...receipt}:undefined;
  }

  hasUncertain():boolean {
    return [...this.receipts.values()].some(receipt=>receipt.result==='uncertain');
  }

  /** Only a reserved command may be finalised after external state observation.
   * record() remains append-only; this does not grant permission to dispatch.
   */
  confirmReservation(receipt:AgentReceipt):Promise<void> {
    if(receipt.result!=='confirmed')return Promise.reject(Error('CONFIRMED_RECEIPT_REQUIRED'));
    return this.persist(receipt,true);
  }

  /** Atomic replace + file/directory fsync on one local filesystem.
   * Underlying at-most-once dispatch must still enforce durable authority and
   * reserve before any effect; multi-host/shared-NFS safety is NOT promised.
   */
  record(receipt:AgentReceipt):Promise<void> {return this.persist(receipt,false)}

  private persist(input:AgentReceipt,confirm:boolean):Promise<void> {
    const receipt={...input};
    const next=this.chain.then(async()=>{
      if(!validId(receipt.commandId)||!outcomes.has(receipt.result)||
        !Number.isFinite(receipt.observedAt)||
        (receipt.reason!==undefined&&(typeof receipt.reason!=='string'||receipt.reason.length>256)))
        throw new Error('INVALID_RECEIPT');
      const release=await DurableReceiptJournal.requireExclusiveWriter(this.file);
      try {
        const onDisk=decodeJournal(await readFile(this.file,'utf8'));
        const previous=onDisk.get(receipt.commandId);
        if(confirm){
          if(previous?.result!=='uncertain'||previous.reason!=='PRE_EXECUTION_RESERVED'||
            receipt.observedAt<previous.observedAt)throw Error('RESERVATION_REQUIRED');
        }else if(previous)throw new Error('DUPLICATE');
        if(!previous&&onDisk.size>=maxRecords)throw new Error('JOURNAL_FULL');
        const updated=new Map(onDisk);updated.set(receipt.commandId,{...receipt});
        const temp=this.file+'.tmp-'+process.pid+'-'+Math.random().toString(16).slice(2);
        const descriptor=await open(temp,'wx',0o600);
        try {
          await descriptor.writeFile(JSON.stringify([...updated.values()]));
          await descriptor.sync();
        }finally{await descriptor.close()}
        try{await rename(temp,this.file)}
        catch(error){await rm(temp,{force:true});throw error}
        // On Windows Node.js cannot fsync a directory handle (EPERM on real FIXE).
        // The file itself was fsynced; rename metadata power-loss durability is NOT
        // guaranteed on Windows. No OBS write executor is authorised by this prototype.
        if(process.platform!=='win32') {
          const directory=await open(path.dirname(this.file),'r');
          try{await directory.sync()}finally{await directory.close()}
        }
        // Only publish in memory once durable storage has acknowledged the write.
        this.receipts.clear();
        for(const [id,value] of onDisk)this.receipts.set(id,value);
        this.receipts.set(receipt.commandId,{...receipt});
      }finally{await release()}
    });
    this.chain=next.catch(()=>{});
    return next;
  }
}
