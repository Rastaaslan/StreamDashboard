export function configurationTransferSupport(platform:string):{version:number;strict:boolean;kinds:string[]};
export function portableConfiguration(key:string,value:any):any;
export function planConfigurationCopy(source:any,target:any):any;
export function runConfigurationCopy(initial:any,options:{snapshot:(device:any)=>Promise<any>;apply:(device:any,body:any)=>Promise<any>;save:(job:any)=>Promise<any>},rollback?:boolean):Promise<any>;
