export const fields: Record<string,string[]>;
export function clone<T>(value:T):T;
export function pick(value:any, keys:string[]):any;
export function equal(a:unknown,b:unknown):boolean;
export function safeJSON(value:unknown):boolean;
export function merge(base:any,local:any,remote:any,path?:string):{value:any;conflicts:string[]};
export function resources(bundle:any):Record<string,any>;
export function overlay(bundle:any,edits:Record<string,any>):any;
