export interface DjiBatteryWarning {
  code: string;
  severity: 'warning'|'critical'|'check';
  message: string;
}
export interface DjiBatteryWarningTracker {
  check(input: {streaming:boolean; relay: unknown}): DjiBatteryWarning[];
  reset(): void;
}
export function createDjiBatteryWarningTracker(options?:{
  now?:()=>number;
  cooldownMs?:number;
}): DjiBatteryWarningTracker;
export const DJI_WARNING_COOLDOWN_MS: number;
export const DJI_SENSOR_MAX_AGE_MS: number;
export const DJI_SENSOR_LOST_GRACE_MS: number;
