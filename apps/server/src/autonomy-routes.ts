import type express from 'express';
import type { AutonomyService } from './autonomy-service.js';
import { fields, resources } from '../../mobile/shared/autonomy.js';

export function registerAutonomyRoutes(app:express.Application, service:AutonomyService, options:{
 bundle(req:express.Request):any;
 observe():Promise<void>;
 apply(key:string,value:any,req:express.Request):Promise<void>;
}){
 const allowed=new Set(['settings','planning','action','output','youtube','preferences','profile','template','sound','automation','discord','google']);
 app.get('/api/v2/autonomy', (req,res)=>{void options.observe().catch(()=>{});res.json({workspace:service.workspace,bundle:options.bundle(req)});});
 app.post('/api/v2/autonomy/sync',async(req,res,next)=>{
  try{
   const edit=req.body?.edit, [kind,id]=String(edit?.key||'').split('/');
   if(!allowed.has(kind)||(['settings','youtube','preferences','profile','discord','google'].includes(kind)&&id!=='root')||(kind==='output'&&!['twitch','youtube'].includes(id)))throw new Error('Ressource non synchronisable.');
   if(edit.value!==null&&(!edit.value||typeof edit.value!=='object'||Array.isArray(edit.value)))throw new Error('Objet attendu.');
   if(fields[kind]&&edit.value!==null&&Object.keys(edit.value).some(k=>!fields[kind].includes(k)))throw new Error('Champ non synchronisable.');
   if(edit.value===null&&!['planning','action','template','sound','automation'].includes(kind))throw new Error('Cette configuration ne peut pas être supprimée.');
   const receipt=await service.apply(req.body.workspace,edit,()=>resources(options.bundle(req))[edit.key]??null,value=>options.apply(edit.key,value,req));
   res.json({receipt,workspace:service.workspace,bundle:options.bundle(req)});
  }catch(e){next(e);}
 });
}

// Reuse planning/settings validation and provider safeguards without a second HTTP request.
export function invokeManagement(handler:express.RequestHandler,parent:express.Request,path:string,body:unknown,method:string,id?:string):Promise<unknown>{
 return new Promise((resolve,reject)=>{
  const req=Object.create(parent) as express.Request;
  Object.defineProperties(req,{path:{value:path},body:{value:body},method:{value:method},params:{value:{id}},query:{value:{}}});
  let status=200;
  const res={locals:{management:true,autonomyId:id},status(code:number){status=code;return this;},json(value:any){if(status>=400)reject(new Error(value?.error?.message||value?.error||'Modification refusée.'));else resolve(value);return this;},end(){resolve({});return this;}} as unknown as express.Response;
  Promise.resolve(handler(req,res,error=>error?reject(error):resolve({}))).catch(reject);
 });
}
