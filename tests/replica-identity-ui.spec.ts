import {test,expect} from '@playwright/test';
import express from 'express';
import path from 'node:path';
import type {Server} from 'node:http';
let server:Server,origin:string;
test.beforeAll(async()=>{
 const app=express();app.use('/mobile',express.static(path.resolve('apps/mobile')));
 app.get('/',(_req,res)=>res.send('<!doctype html><meta charset="utf-8"><title>Identité des espaces</title>'));
 server=await new Promise(resolve=>{const value=app.listen(0,'127.0.0.1',()=>resolve(value));});
 origin='http://127.0.0.1:'+(server.address() as {port:number}).port;
});
test.afterAll(async()=>{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));});
test.beforeEach(async({page})=>{await page.goto(origin);await page.evaluate(async()=>{
 const win=window as any;
 Object.assign(win,await import('/mobile/control/replica-identity.js' as string),await import('/mobile/control/autonomy-store.js' as string),await import('/mobile/control/device-workspace.js' as string));
 win.oldOrigin='http://192.168.1.12:48133';win.newOrigin='https://192.168.1.80:48136';
 win.response={...win.newWorkspace({name:'Test'}),workspace:'remote-workspace-one'};
 win.original=await win.openReplica(win.oldOrigin);await win.original.seed(win.response);
});});

test('reassociation retains pending edits, drafts, deck choices and action destinations across restart',async({page})=>{
 const result=await page.evaluate(async()=>{
  const w=window as any;
  const preferences=await import('/mobile/control/performance-ui.js' as string),routing=await import('/mobile/control/action-routing.js' as string);
  const action=w.response.bundle.data.configuration.actions[0];
  await w.original.stage({['action/'+action.id]:{...action,label:'Modifié hors ligne'}});
  await w.original.draft('metadata',{title:'Brouillon conservé'});
  preferences.saveDeckPreferences(localStorage,w.oldOrigin,{version:1,bank:'favorites',favorites:['action:'+action.id],soundCategory:''});
  const before=w.original.record;
  await w.linkReplicaEndpoint(w.newOrigin,w.response,'physical-one');
  const reopened=await w.openReplica(w.newOrigin);
  const route={workspace:w.oldOrigin,actionId:action.id,deviceId:'executor',definition:action};
  const router=routing.createActionRouter({installation:()=>({actionRoutes:[route]}),workspace:()=>reopened.scope});
  const value={scope:reopened.scope,before,after:reopened.record,label:reopened.view().data.configuration.actions[0].label,favorites:preferences.readDeckPreferences(localStorage,reopened.scope)?.favorites,route:router.binding(action)};
  reopened.close();w.original.close();return value;
 });
 expect(result.scope).toBe('http://192.168.1.12:48133');expect(result.after).toEqual(result.before);
 expect(result.label).toBe('Modifié hors ligne');expect(result.favorites).toEqual(['action:micro']);expect(result.route?.deviceId).toBe('executor');
 await page.reload();
 expect(await page.evaluate(async()=>{const m=await import('/mobile/control/autonomy-store.js' as string),s=await m.openReplica('https://192.168.1.80:48136');const r=s.record;s.close();return r.pending.length;})).toBe(1);
});

test('a window opened before the new address is linked cannot fork the outbox',async({page})=>{
 const result=await page.evaluate(async()=>{
  const w=window as any,early=await w.openReplica(w.newOrigin);
  await w.linkReplicaEndpoint(w.newOrigin,w.response,'physical-one');
  await Promise.all([early.stage({'settings/root':{streamerName:'Nom hors ligne'}}),w.original.draft('metadata',{title:'Autre fenêtre'})]);
  await w.original.reload();const after=w.original.record;
  const db=await w.openReplicaDatabase();const raw=await new Promise(resolve=>{const r=db.transaction('replicas').objectStore('replicas').get(w.newOrigin);r.onsuccess=()=>resolve(r.result);});db.close();
  early.close();w.original.close();return {after,raw};
 });
 expect(result.after.pending).toHaveLength(1);expect(result.after.drafts.metadata.title).toBe('Autre fenêtre');expect(result.raw).toBeUndefined();
});

test('identity replacement and ambiguous older copies abort without deleting any record',async({page})=>{
 const result=await page.evaluate(async()=>{
  const w=window as any,errors:string[]=[];
  await w.original.draft('metadata',{title:'À garder'});
  await w.linkReplicaEndpoint(w.newOrigin,w.response,'physical-one');
  const dump=async()=>{const db=await w.openReplicaDatabase();try{return await new Promise(resolve=>{const r=db.transaction('replicas').objectStore('replicas').getAll();r.onsuccess=()=>resolve(r.result);});}finally{db.close();}};
  const before=await dump();
  for(const [endpoint,response,id] of [[w.newOrigin,{...w.response,workspace:'other'},'physical-two'],['https://clone.local',w.response,'physical-two']])try{await w.linkReplicaEndpoint(endpoint,response,id);}catch(error){errors.push((error as Error).message);}
  const after=await dump();w.original.close();return {before,after,errors};
 });
 expect(result.after).toEqual(result.before);expect(result.errors).toHaveLength(2);expect(result.errors.join(' ')).toContain('identité');
});

test('transferring autonomous content through a new address uses the original destination once',async({page})=>{
 const result=await page.evaluate(async()=>{
  const w=window as any,local=await w.openReplica('device-workspace-v1');await local.seed(w.newWorkspace({name:'Téléphone'}));
  await local.stage({'planning/local-event':{title:'Créé sur le téléphone'}});
  await w.linkReplicaEndpoint(w.newOrigin,w.response,'physical-one');
  const target=await w.openReplica(w.newOrigin);await target.importLocal('device-workspace-v1');await target.importLocal('device-workspace-v1');
  await w.original.reload();await local.reload();const result={remote:w.original.record.pending,local:local.record.pending,original:local.view().data.host.planning};
  target.close();w.original.close();local.close();return result;
 });
 expect(result.remote).toHaveLength(1);expect(result.local).toHaveLength(0);expect(result.original[0].title).toBe('Créé sur le téléphone');
});
