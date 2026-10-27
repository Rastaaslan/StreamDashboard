import type { Application, Request } from 'express';
import type { TLSSocket } from 'node:tls';
import { randomBytes, randomUUID, timingSafeEqual, createHash } from 'node:crypto';

/** Ephemeral consent only. Restart/expiry discards requests; no UDP data grants trust. */
export class PairingRequests {
  private entries = new Map<string, {name:string; proof:Buffer; code:string; expiresAt:number; state:'pending'|'approved'|'denied'; result?:unknown}>();
  constructor(private now=Date.now) {}
  private clean(){for(const [id,e] of this.entries)if(e.expiresAt<=this.now())this.entries.delete(id);}
  create(name:string){
    this.clean();if(this.entries.size>=32)throw new Error('Trop de demandes. Attendez leur expiration.');
    if(typeof name!=='string'||!name.trim()||name.length>80)throw new Error('Nom invalide.');
    const id=randomUUID(),secret=randomBytes(32).toString('base64url'),code=randomBytes(6).toString('hex').toUpperCase(),expiresAt=this.now()+300000;
    this.entries.set(id,{name:name.trim(),proof:this.hash(secret),code,expiresAt,state:'pending'});
    return {id,secret,code,expiresAt};
  }
  list(){this.clean();return [...this.entries].filter(([,e])=>e.state==='pending').map(([id,e])=>({id,name:e.name,code:e.code,expiresAt:e.expiresAt}));}
  decide(id:string,code:string,approve:boolean){this.clean();const e=this.entries.get(id);if(!e||e.state!=='pending'||e.code!==code)throw new Error('Demande expirée ou modifiée.');e.state=approve?'approved':'denied';}
  async poll(id:string,secret:string,issue:(name:string)=>Promise<unknown>){
    this.clean();const e=this.entries.get(id);if(!e||!timingSafeEqual(e.proof,this.hash(secret)))throw new Error('Demande invalide ou expirée.');
    if(e.state!=='approved')return {state:e.state};
    // Cache the promise before awaiting: concurrent polls never issue two credentials.
    e.result ??= issue(e.name);
    return {state:'approved',paired:await e.result};
  }
  private hash(value:string){return createHash('sha256').update(value).digest();}
}

export function registerPairingRequests(app:Application, options:{enabled():boolean;fingerprint():string|undefined;isLocal(req:Request):boolean;issue(name:string):Promise<unknown>}) {
  const requests=new PairingRequests();
  app.post('/api/v1/remote/requests',(req,res,next)=>{try{
    if(!options.enabled()||!(req.socket as TLSSocket).encrypted||!options.fingerprint()||req.body?.fingerprint!==options.fingerprint()){res.sendStatus(403);return;}
    res.status(201).json(requests.create(req.body?.name));
  }catch(error){next(error);}});
  app.get('/api/v1/remote/requests',(req,res)=>{if(!options.isLocal(req)){res.sendStatus(403);return;}res.json(requests.list());});
  app.post('/api/v1/remote/requests/:id/decision',(req,res,next)=>{try{
    if(!options.isLocal(req)){res.sendStatus(403);return;}
    if(typeof req.body?.approve!=='boolean')throw new Error('Décision explicite requise.');
    requests.decide(String(req.params.id),req.body.code,req.body.approve);res.json({ok:true});
  }catch(error){next(error);}});
  app.post('/api/v1/remote/requests/:id/poll',async(req,res,next)=>{try{
    if(!options.enabled()||!(req.socket as TLSSocket).encrypted){res.sendStatus(403);return;}
    res.json(await requests.poll(String(req.params.id),String(req.body?.secret||''),options.issue));
  }catch(error){next(error);}});
}
