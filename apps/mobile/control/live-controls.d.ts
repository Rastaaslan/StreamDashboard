
export interface LiveDestination { live:boolean|null; active:boolean|null; configured:boolean; canStart:boolean; transitioning:boolean; startBlockReason:string; observedAt?:string;error:string; }
export interface LiveStatus { destinations:Record<string,LiveDestination>; running:boolean; anyActive:boolean;mainActive:boolean;bothLive:boolean;unconfirmed:boolean;canStartBoth:boolean;heading:string; }
export function liveControlState(data: any, online:boolean, now?:number):LiveStatus;
