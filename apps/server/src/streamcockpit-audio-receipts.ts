import type {ObsAudioChange,ObsAudioSource} from '../../../integrations/obs/src/client.js';

export interface AudioReceipt {
  schemaVersion:1;kind:'streamcockpit-mixer-receipt';confirmationId:string;
  status:'confirmed'|'unchanged'|'uncertain'|'rejected';change:ObsAudioChange;
  before?:ObsAudioSource;after?:ObsAudioSource;rollbackAvailable:boolean;
}
export interface AudioReceiptContext {actor:string;authority:string;host:string;runtime:string;}
export interface AudioReceiptRecord {
  id:string;context:AudioReceiptContext;change:ObsAudioChange;createdAt:number;
  receipt?:AudioReceipt;
}
/** A reservation is never a provider success. Permanent intent must precede OBS,
 * while a completed receipt may be published only after actual OBS readback. */
export interface AudioReceiptJournal {
  reserve(id:string,context:AudioReceiptContext,change:ObsAudioChange):boolean;
  complete(id:string,context:AudioReceiptContext,receipt:AudioReceipt):void;
  read(id:string,actor:string,authority:string):AudioReceiptRecord|undefined;
  history(actor:string,authority:string,before?:number):Array<{sequence:number;record:AudioReceiptRecord}>;
}
const issue=()=>new Error('AUDIO_RECEIPT_INVALID');
const keys=(v:unknown,names:string[])=>Boolean(v&&typeof v==='object'&&!Array.isArray(v)&&
  Object.keys(v).every(k=>names.includes(k)));
const text=(v:unknown,max:number):v is string=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\x00-\x1f]/.test(v);
export const audioReceiptId=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export function validateAudioReceiptContext(v:AudioReceiptContext):void{
  if(!keys(v,['actor','authority','host','runtime'])||!text(v.actor,256)||!text(v.authority,256)||
    !text(v.host,300)||!audioReceiptId(v.runtime))throw issue();
}
export function validateAudioChange(v:ObsAudioChange):void{
  if(!keys(v,['sourceId','gain','mute'])||!text(v.sourceId,200)||
    (Object.hasOwn(v,'gain')===Object.hasOwn(v,'mute'))||
    ('gain'in v?typeof v.gain!=='number'||!Number.isFinite(v.gain)||v.gain<0||v.gain>20:typeof v.mute!=='boolean'))throw issue();
}
function source(v:ObsAudioSource|undefined,change:ObsAudioChange):v is ObsAudioSource{
  return Boolean(v&&keys(v,['sourceId','inputUuid','generation','gain','mute','observedAt'])&&
    v.sourceId===change.sourceId&&text(v.inputUuid,200)&&Number.isSafeInteger(v.generation)&&v.generation>=0&&
    typeof v.gain==='number'&&Number.isFinite(v.gain)&&v.gain>=0&&v.gain<=20&&typeof v.mute==='boolean'&&
    Number.isSafeInteger(v.observedAt)&&v.observedAt>=0);
}
export function validateAudioReceipt(v:AudioReceipt):void{
  if(!keys(v,['schemaVersion','kind','confirmationId','status','change','before','after','rollbackAvailable'])||
    v.schemaVersion!==1||v.kind!=='streamcockpit-mixer-receipt'||!audioReceiptId(v.confirmationId)||
    !['confirmed','unchanged','uncertain','rejected'].includes(v.status)||typeof v.rollbackAvailable!=='boolean')throw issue();
  validateAudioChange(v.change);
  if(v.status==='confirmed'||v.status==='unchanged'){
    if(!source(v.before,v.change)||!source(v.after,v.change)||v.before.inputUuid!==v.after.inputUuid||
      v.before.generation!==v.after.generation||
      ('gain'in v.change?Math.abs(v.after.gain-v.change.gain!)>0.000001||v.after.mute!==v.before.mute:
        v.after.mute!==v.change.mute||v.after.gain!==v.before.gain)||
      v.rollbackAvailable!==(v.status==='confirmed'))throw issue();
  }else if(v.rollbackAvailable||v.before!==undefined||v.after!==undefined)throw issue();
}
export function validateAudioReceiptRecord(v:AudioReceiptRecord):void{
  if(!keys(v,['id','context','change','createdAt','receipt'])||!audioReceiptId(v.id)||
    !Number.isSafeInteger(v.createdAt)||v.createdAt<0)throw issue();
  validateAudioReceiptContext(v.context);validateAudioChange(v.change);
  if(v.receipt){validateAudioReceipt(v.receipt);if(v.receipt.confirmationId!==v.id||
    JSON.stringify(v.receipt.change)!==JSON.stringify(v.change))throw issue()}
}
