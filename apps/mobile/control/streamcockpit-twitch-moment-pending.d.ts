/** Browser persistence is only a reconciliation hint, never a command authorization. */
export interface MomentReceipt {id:string;kind:'clip'|'marker'}
export interface MomentStorageView {readonly localStorage?: {getItem(key:string):string|null;setItem(key:string,value:string):void}}
/** Non-destructive journal status; blocked includes corrupt or unavailable localStorage. */
export declare function diagnoseUncertainMomentStore(view:MomentStorageView,source:string,account:string,now?:number):{state:'blocked'|'clear'}|{state:'pending';receipt:MomentReceipt};
export declare function loadUncertainMoment(view:MomentStorageView,source:string,account:string,now?:number):MomentReceipt|null;
export declare function rememberUncertainMoment(view:MomentStorageView,source:string,account:string,receipt:MomentReceipt,now?:number):boolean;
export declare function clearUncertainMoment(view:MomentStorageView,source:string,account:string,now?:number):boolean;
