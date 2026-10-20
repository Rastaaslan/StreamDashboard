import { randomUUID, createHash } from 'node:crypto';
import { AtomicJsonStore } from './storage.js';
import { equal, merge, safeJSON } from '../../mobile/shared/autonomy.js';
export interface Edit { id:string; key:string; base:unknown; value:unknown }
interface Receipt { signature:string; status:'running'|'applied'|'conflict'|'rejected'|'uncertain'; current?:unknown; fields?:string[]; message?:string }
interface Journal { version:1; workspace:string; receipts:Record<string,Receipt> }
/** Durable receipts: an interrupted write is reconciled, never blindly executed again. */
export class AutonomyService {
 private tail:Promise<unknown>=Promise.resolve();
 private constructor(private store:AtomicJsonStore<Journal>,private journal:Journal){}
 static async open(file:string){const store=new AtomicJsonStore<Journal>(file);const journal=await store.read({version:1,workspace:randomUUID(),receipts:{}});await store.write(journal);return new AutonomyService(store,journal);}
 get workspace(){return this.journal.workspace;}
 serial<T>(run:()=>Promise<T>):Promise<T>{const result=this.tail.then(run);this.tail=result.catch(()=>{});return result;}
 async apply(workspace:unknown,edit:Edit,read:()=>unknown,write:(value:any)=>Promise<void>){
  if(workspace!==this.workspace)throw new Error('Cette régie a une identité différente. Vos modifications locales sont conservées.');
  if(!edit||!/^[-\w]{8,100}$/.test(edit.id)||!/^\w+\/[A-Za-z0-9._:-]{1,160}$/.test(edit.key)||!safeJSON(edit.base)||!safeJSON(edit.value)||JSON.stringify(edit).length>256_000)throw new Error('Modification locale invalide.');
  const signature=createHash('sha256').update(JSON.stringify(edit)).digest('hex');
  let receipt=this.journal.receipts[edit.id];
  if(receipt&&receipt.signature!==signature)throw new Error('Identifiant de modification réutilisé.');
  if(receipt){
   if(receipt.status==='running'){
    const current=read();receipt={signature,status:equal(current,edit.value)?'applied':'uncertain',current,message:'Écriture interrompue : comparez les versions avant de poursuivre.'};
    await this.save(edit.id,receipt);
   }
   return receipt;
  }
  const current=read(),result=merge(edit.base,edit.value,current);
  if(result.conflicts.length){receipt={signature,status:'conflict',current,fields:result.conflicts,message:'Modifications concurrentes.'};await this.save(edit.id,receipt);return receipt;}
  // An unchanged resource needs no execution, including deletes already applied.
  if(equal(current,result.value)){receipt={signature,status:'applied',current};await this.save(edit.id,receipt);return receipt;}
  await this.save(edit.id,{signature,status:'running'});
  try{await write(result.value);receipt={signature,status:'applied',current:read()};}
  catch(error){const after=read();receipt={signature,status:equal(after,current)?'rejected':'uncertain',current:after,message:error instanceof Error?error.message:String(error)};}
  await this.save(edit.id,receipt);return receipt;
 }
 private async save(id:string,receipt:Receipt){const next={...this.journal,receipts:{...this.journal.receipts,[id]:receipt}};await this.store.write(next);this.journal=next;}
}
