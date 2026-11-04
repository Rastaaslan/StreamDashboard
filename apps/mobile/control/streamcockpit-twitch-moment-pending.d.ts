/** Browser persistence is only a reconciliation hint, never a command authorization. */
export interface MomentReceipt {id:string;kind:'clip'|'marker'}
export interface MomentStorageView {readonly localStorage?: {getItem(key:string):string|null;setItem(key:string,value:string):void}}
/** The production UI must claim an exclusive same-origin Web Lock before *every* journal mutation. Missing/contended locks fail closed. */
export declare function withExclusiveMomentJournal(view:MomentStorageView & {readonly navigator?: {readonly locks?: {request(name:string,options:{mode:'exclusive';ifAvailable:true},callback:(lock:unknown)=>boolean):Promise<boolean>}}},operation:()=>boolean):Promise<boolean>;
/** Fixed-category local diagnostic, without any UUID, account, scope, raw data or exception text. */
export declare function describeUncertainMomentIssue(view:MomentStorageView,source:string,account:string,now?:number):{code:'unavailable'|'corrupt-json'|'too-large'|'unknown-schema'|'invalid-rows'|'pending'|'clear'};
/** Non-destructive journal status; blocked includes corrupt or unavailable localStorage. */
export declare function diagnoseUncertainMomentStore(view:MomentStorageView,source:string,account:string,now?:number):{state:'blocked'|'clear'}|{state:'pending';receipt:MomentReceipt};
/** Read-only forensic lookup when another row is corrupt; no journal repairs or admission. */
export declare function recoverUncertainMomentForReview(view:MomentStorageView,source:string,account:string,now?:number):MomentReceipt|null;
/** User-triggered local backup, raw and potentially sensitive; never logged, transmitted or automatically downloaded. */
export declare function readUncertainMomentBackup(view:MomentStorageView):string|null;
export declare function loadUncertainMoment(view:MomentStorageView,source:string,account:string,now?:number):MomentReceipt|null;
export declare function rememberUncertainMoment(view:MomentStorageView,source:string,account:string,receipt:MomentReceipt,now?:number):boolean;
/** Clear only the receipt currently acknowledged; a stale tab must not clear a newer UUID. */
export declare function clearUncertainMoment(view:MomentStorageView,source:string,account:string,expected:MomentReceipt,now?:number):boolean;
