export const AUDIO_CHUNK:number, AUDIO_MAX:number;
export interface PortableSound {name:string;category:string;enabled:boolean;favorite:boolean;volume:number;cooldownMs:number;monitoringMode:'stream'|'monitor';playbackMode:'replace'|'mix'}
export function portableSound(value:unknown):PortableSound;
export function sameSound(left:unknown,right:unknown):boolean;
export function soundIdentity(value:unknown):boolean;
export function createSoundLibraryExport(options:{list:()=>Promise<Array<unknown>>|Array<unknown>;load:(id:string)=>Promise<{blob:Blob;filename:string}>;hash:(blob:Blob)=>Promise<string>;uuid:()=>string;now?:()=>number}):(body:any,owner:string,guard?:()=>void)=>Promise<any>;
