export interface RawMicBattery {
  status:string;
  observedAt?:string;
  tx?:Array<{slot:number;connected:boolean;rawGauge?:number|null;calibration?:string}>;
  rx?:{rawGauge?:number|null};
}
export interface MicBadgeSnapshot {tone:'ok'|'idle'|'check'|'critical'|'offline';text:string;compactText:string;detail:string;connected:number[];}
export function micBadgeState(value:RawMicBattery|unknown,now?:number,previous?:Set<number>):MicBadgeSnapshot;
export interface FloatingMicBadge {
  update(options?:{enabled?:boolean;sourceKey?:string}):void;
  refresh():Promise<void>;
  destroy():void;
}
export function createFloatingMicBattery(root:HTMLElement,options?:{
  read?:()=>Promise<RawMicBattery|unknown>;
  onOpen?:()=>void;
  now?:()=>number;
  intervalMs?:number;
}):FloatingMicBadge;
