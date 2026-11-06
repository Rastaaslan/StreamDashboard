import {validObsAudioTracks,validObsAudioMonitor,type ObsAudioChange,type ObsAudioSource} from '../../../integrations/obs/src/client.js';

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
  if(!keys(v,['sourceId','gain','mute','tracks','monitorType'])||!text(v.sourceId,200)||
    ['gain','mute','tracks','monitorType'].filter(k=>Object.hasOwn(v,k)).length!==1)throw issue();
  if('gain'in v?(typeof v.gain!=='number'||!Number.isFinite(v.gain)||v.gain<0||v.gain>20):
    'mute'in v?typeof v.mute!=='boolean':'tracks'in v?!validObsAudioTracks(v.tracks):!validObsAudioMonitor(v.monitorType))throw issue();
}
function source(v:ObsAudioSource|undefined,change:ObsAudioChange):v is ObsAudioSource{
  return Boolean(v&&keys(v,['sourceId','inputUuid','generation','gain','mute','observedAt','tracks','monitorType'])&&
    (v.tracks===undefined||validObsAudioTracks(v.tracks))&&(v.monitorType===undefined||validObsAudioMonitor(v.monitorType))&&
    (!('tracks'in change||'monitorType'in change)||(validObsAudioTracks(v.tracks)&&validObsAudioMonitor(v.monitorType)))&&
    v.sourceId===change.sourceId&&text(v.inputUuid,200)&&Number.isSafeInteger(v.generation)&&v.generation>=0&&
    typeof v.gain==='number'&&Number.isFinite(v.gain)&&v.gain>=0&&v.gain<=20&&typeof v.mute==='boolean'&&
    Number.isSafeInteger(v.observedAt)&&v.observedAt>=0);
}
/** Same source and all unchanged audio properties; tracks are canonicalized by number. */
export function sameAudioSource(a:ObsAudioSource,b:ObsAudioSource):boolean{
 return a.sourceId===b.sourceId&&a.inputUuid===b.inputUuid&&a.generation===b.generation&&a.gain===b.gain&&a.mute===b.mute&&
  a.monitorType===b.monitorType&&sameTracks(a.tracks,b.tracks);
}
const sameTracks=(a:ObsAudioSource['tracks'],b:ObsAudioSource['tracks'])=>a===undefined||b===undefined?a===b:
 validObsAudioTracks(a)&&validObsAudioTracks(b)&&(['1','2','3','4','5','6']as const).every(k=>a[k]===b[k]);
export function reverseAudioChange(before:ObsAudioSource,change:ObsAudioChange):ObsAudioChange{
 if('gain'in change)return {sourceId:before.sourceId,gain:before.gain};
 if('mute'in change)return {sourceId:before.sourceId,mute:before.mute};
 if('tracks'in change){if(!validObsAudioTracks(before.tracks))throw issue();return {sourceId:before.sourceId,tracks:structuredClone(before.tracks)}}
 if(!validObsAudioMonitor(before.monitorType))throw issue();return {sourceId:before.sourceId,monitorType:before.monitorType};
}
export function audioChangeObserved(before:ObsAudioSource,after:ObsAudioSource,change:ObsAudioChange):boolean{
 return after.sourceId===before.sourceId&&after.inputUuid===before.inputUuid&&after.generation===before.generation&&
  ('gain'in change?Math.abs(after.gain-change.gain)<=0.000001:after.gain===before.gain)&&
  after.mute===('mute'in change?change.mute:before.mute)&&
  after.monitorType===('monitorType'in change?change.monitorType:before.monitorType)&&
  sameTracks(after.tracks,'tracks'in change?change.tracks:before.tracks);
}
export function validateAudioReceipt(v:AudioReceipt):void{
  if(!keys(v,['schemaVersion','kind','confirmationId','status','change','before','after','rollbackAvailable'])||
    v.schemaVersion!==1||v.kind!=='streamcockpit-mixer-receipt'||!audioReceiptId(v.confirmationId)||
    !['confirmed','unchanged','uncertain','rejected'].includes(v.status)||typeof v.rollbackAvailable!=='boolean')throw issue();
  validateAudioChange(v.change);
  if(v.status==='confirmed'||v.status==='unchanged'){
    if(!source(v.before,v.change)||!source(v.after,v.change)||v.before.inputUuid!==v.after.inputUuid||
      v.before.generation!==v.after.generation||
      !audioChangeObserved(v.before,v.after,v.change)||
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
