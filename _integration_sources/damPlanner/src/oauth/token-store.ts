export interface SecureTokenStore{get(key:string):Promise<string|null>;set(key:string,value:string):Promise<void>;delete(key:string):Promise<void>}
export class FakeSecureTokenStore implements SecureTokenStore{private values=new Map<string,string>();async get(k:string){return this.values.get(k)??null}async set(k:string,v:string){this.values.set(k,v)}async delete(k:string){this.values.delete(k)}}
