import {mkdir,open,readFile,rename,rm} from 'node:fs/promises';
import path from 'node:path';
import type {AgentReceipt} from '../../../packages/contracts/src/agent-v2.js';
/** Isolated prototype journal. Single-process writer only; no execution authorization.
 * Serialises receipts by atomic temp-file rename before acknowledging recording.
 * Missing/corrupt evidence must fail closed; it must not silently recreate a journal.
 */
export class DurableReceiptJournal {
  private constructor(private readonly file:string,private readonly receipts:Map<string,AgentReceipt>){}
  private chain:Promise<void>=Promise.resolve();
  private static async requireExclusiveWriter(file:string):Promise<() => Promise<void>> {
    const guard=await open(file+'.writer.lock','wx',0o600);
    try {await guard.writeFile(String(process.pid)); await guard.sync()}
    catch(error){await guard.close();throw error}
    return async()=>{await guard.close();await rm(file+'.writer.lock',{force:true})};
  }
  static async open(file:string):Promise<DurableReceiptJournal>{
    const dir=path.dirname(file);
    await mkdir(dir,{recursive:true});
    let data:string;
    try{data=await readFile(file,'utf8')}
    catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
      const descriptor=await open(file,'wx',0o600);try{await descriptor.writeFile('[]');await descriptor.sync()}finally{await descriptor.close()}data='[]';
    }
    // A previous writer may have crashed. Refuse implicit lock recovery or mutation.
    try{await readFile(file+'.writer.lock');throw new Error('WRITER_LOCKED')}
    catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
    const parsed:unknown=JSON.parse(data);
    if(!Array.isArray(parsed))throw new Error('CORRUPT_JOURNAL');
    const receipts=new Map<string,AgentReceipt>();
    for(const candidate of parsed){
      if(!candidate||typeof candidate!=='object')throw new Error('CORRUPT_JOURNAL');
      const value=candidate as AgentReceipt;
      if(!/^[A-Za-z0-9_-]{1,96}$/.test(value.commandId)||typeof value.observedAt!=='number'
         ||!['accepted','executed','confirmed','uncertain','refused'].includes(value.result)
         ||receipts.has(value.commandId))throw new Error('CORRUPT_JOURNAL');
      receipts.set(value.commandId,value);
    }
    return new DurableReceiptJournal(file,receipts);
  }
  find(id:string):AgentReceipt|undefined{return this.receipts.get(id)}
  /** Queues mutations in-process. Multi-process locking still required before deployment. */
  record(receipt:AgentReceipt):Promise<void>{
    const next=this.chain.then(async()=>{
      if(this.receipts.has(receipt.commandId))throw new Error('DUPLICATE');
      if(!/^[A-Za-z0-9_-]{1,96}$/.test(receipt.commandId)||
        !Number.isFinite(receipt.observedAt)||
        !['accepted','executed','confirmed','uncertain','refused'].includes(receipt.result))
        throw new Error('INVALID_RECEIPT');
      const release=await DurableReceiptJournal.requireExclusiveWriter(this.file);
      try {
      const onDisk=JSON.parse(await readFile(this.file,'utf8')) as AgentReceipt[];
      if(!Array.isArray(onDisk)||onDisk.some(item=>!item||typeof item.commandId!=='string'))throw new Error('CORRUPT_JOURNAL');
      if(onDisk.some(item=>item.commandId===receipt.commandId))throw new Error('DUPLICATE');
      const next=[...onDisk,receipt];
      const temp=this.file+'.tmp-'+process.pid+'-'+Math.random().toString(16).slice(2);
      const descriptor=await open(temp,'wx',0o600);
      try {
        await descriptor.writeFile(JSON.stringify(next));
        await descriptor.sync();
      }finally{await descriptor.close()}
      try{await rename(temp,this.file)}catch(error){await rm(temp,{force:true});throw error}
      const folder=await open(path.dirname(this.file),'r');
      try{await folder.sync()}finally{await folder.close()}
      this.receipts.set(receipt.commandId,receipt);
      }finally{await release()}
    });
    this.chain=next.catch(()=>{});
    return next;
  }
}

[executed on device: dam-server (ee881f3f-7909-4993-a915-04a1d994f366)]