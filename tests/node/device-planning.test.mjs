import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {createLocalPlanning} from '../../apps/mobile/control/local-planning.js';
import {createDeviceProviders} from '../../apps/mobile/control/device-providers.js';
import {newWorkspace} from '../../apps/mobile/control/device-workspace.js';
import {googleProjectionLocalId} from '../../dist/integrations/google-calendar/src/projection.js';

// Exercise every autonomous planning flow without the secure-context-only UUID API.
const cryptoDescriptor=Object.getOwnPropertyDescriptor(globalThis,'crypto');
const nativeCrypto=globalThis.crypto;
Object.defineProperty(globalThis,'crypto',{configurable:true,value:{getRandomValues:nativeCrypto.getRandomValues.bind(nativeCrypto)}});
after(()=>Object.defineProperty(globalThis,'crypto',cryptoDescriptor));

const event={title:'Essai autonome',description:'Texte',category:'live',startAtUtc:'2030-11-01T18:00:00.000Z',endAtUtc:'2030-11-01T19:00:00.000Z',desiredPublication:{local:true,twitch:true,google:true}};
function setup(){
 const seed=newWorkspace({name:'Téléphone'});let writes=0,failGoogle=false,lostGoogle=false,offline=false,remote=new Map(),calls=[];
 const store={record:{workspace:seed.workspace},view:()=>structuredClone(seed.bundle),reload:async()=>{},commitPlanning:async items=>{seed.bundle.data.host.planning=structuredClone(items);writes++;}};
 const bridge={};
 for(const p of ['google','twitch']){
  bridge[p+'Test']=()=>JSON.stringify({ok:true,tested:!offline,capabilities:offline?[]:[p==='google'?'calendar':'schedule']});
  bridge[p+'CreatePlanning']=raw=>{const {event:e,link}=JSON.parse(raw);calls.push([p,'create',e]);assert.ok(store.view().data.host.planning.some(i=>i.providers?.[p]?.uncertainCreate||Object.values(i.providers?.[p]?.projections||{}).some(x=>x.uncertainCreate)),'CREATE intent was durable before I/O');if(failGoogle&&p==='google')return JSON.stringify({ok:false,code:'HTTP_403',nonCreation:true,message:'Refus'});const id=p+':'+e.localId;remote.set(id,{...e,id,revision:'r1'});if(lostGoogle&&p==='google')throw new Error('Response lost');return JSON.stringify({ok:true,remoteId:id,revision:'r1',calendarId:link.calendarId,fingerprint:'fp'});};
  bridge[p+'UpdatePlanning']=raw=>{const {event:e,link}=JSON.parse(raw);calls.push([p,'update',e]);assert.ok(link.remoteId);remote.set(link.remoteId,{...e,id:link.remoteId,revision:'r2'});return JSON.stringify({ok:true,remoteId:link.remoteId,revision:'r2',fingerprint:'fp2'});};
  bridge[p+'ReadPlanning']=raw=>{const {link}=JSON.parse(raw),value=remote.get(link.remoteId);return JSON.stringify(value?{ok:true,remote:value,revision:value.revision,fingerprint:'fp'}:{ok:true,deleted:true});};
  bridge[p+'DeletePlanning']=raw=>{const {link}=JSON.parse(raw);calls.push([p,'delete']);remote.delete(link.remoteId);return '{"ok":true}';};
  bridge[p+'ReconcilePlanning']=raw=>{const {event:e}=JSON.parse(raw);const value=remote.get(p+':'+e.localId);return JSON.stringify(value?{ok:true,remoteId:value.id,revision:value.revision}:{ok:false,message:'Not found'});};
 }
 bridge.googleCalendars=()=>JSON.stringify({ok:true,items:[{id:'calendar@example.test',primary:true,accessRole:'owner'}]});
 const providers=createDeviceProviders({bridge});
 const runtime=()=>createLocalPlanning({store,providers});
 return {store,runtime,calls,remote,setFail:v=>{failGoogle=v;},setLost:v=>{lostGoogle=v;},setOffline:v=>{offline=v;},get writes(){return writes;}};
}
test('autonomous CRUD uses own providers, persists identities and retries only failed destination',async()=>{
 const s=setup();s.setFail(true);const r=s.runtime();const result=await r.route('/api/v2/planning',event,'POST');const id=result.createdItemId;
 let item=s.store.view().data.host.planning[0];assert.equal(item.providers.twitch.status,'synced');assert.equal(item.providers.google.status,'error');assert.equal(item.providers.google.uncertainCreate,undefined);
 s.setFail(false);await s.runtime().route(`/api/v1/planning/${id}/retry/google`,{},'POST');assert.equal(s.calls.filter(x=>x[0]==='twitch').length,1);
 await s.runtime().route('/api/v2/planning/'+id,{...event,title:'Modifié'},'PUT');assert.equal(s.calls.filter(x=>x[1]==='create').length,3);
 await r.route('/api/v2/planning/'+id,{},'DELETE');assert.equal(s.remote.size,0);assert.equal(s.store.view().data.host.planning.length,0);
});
test('lost CREATE survives restart and recovery never issues a second creation',async()=>{
 const s=setup();s.setLost(true);const {createdItemId:id}=await s.runtime().route('/api/v2/planning',event,'POST');assert.ok(s.store.view().data.host.planning[0].providers.google.uncertainCreate);
 s.setLost(false);await s.runtime().route(`/api/v1/planning/${id}/retry/google`,{},'POST');assert.equal(s.calls.filter(x=>x[0]==='google'&&x[1]==='create').length,1);assert.equal(s.store.view().data.host.planning[0].providers.google.status,'synced');
});
test('recurring exceptions use shared projections and retain the canonical series',async()=>{
 const s=setup();const rule={version:2,frequency:'daily',interval:2,timeZone:'Europe/Paris',until:'2030-11-10T23:59:59.000Z'};
 const {createdItemId:id}=await s.runtime().route('/api/v2/planning',{...event,recurrence:rule,desiredPublication:{local:true,twitch:false,google:true}},'POST');
 assert.deepEqual(s.calls[0][2].recurrenceLines,['RRULE:FREQ=DAILY;INTERVAL=2;UNTIL=20301110T235959Z']);
 const key=id+':2030-11-01T19:00:00';await s.runtime().route(`/api/v2/planning/${id}/occurrence`,{occurrenceKey:key,patch:{title:'Exception'}},'PUT');
 const item=s.store.view().data.host.planning[0];assert.equal(item.recurrence.exceptions[key].patch.title,'Exception');
 // Native-to-materialized transition requires the existing master to be read,
 // with its ETag and remote exceptions checked, before any replacement.
 assert.equal(item.providers.google.status,'synced');assert.ok(Object.keys(item.providers.google.projections).length>0);assert.equal(s.calls.filter(x=>x[1]==='delete').length,1);
 const first=Object.values(item.providers.google.projections).find(x=>x.event.title==='Exception');assert.ok(first?.remoteId);
 assert.equal(first.event.localId,googleProjectionLocalId(first.event.projection));
 await s.runtime().route(`/api/v2/planning/${id}`,{},'DELETE');assert.equal(s.remote.size,0);assert.equal(s.store.view().data.host.planning.length,0);
});
test('offline provider failure still saves the event and never reports a remote success',async()=>{
 const s=setup();s.setOffline(true);await s.runtime().route('/api/v2/planning',event,'POST');const item=s.store.view().data.host.planning[0];assert.equal(item.providers.google.status,'error');assert.equal(s.calls.length,0);assert.ok(s.writes);
});
test('browser engine keeps exactly the server SHA-256 occurrence identity',async()=>{
 const identity={mode:'materialized',seriesLocalId:'séries',occurrenceKey:'clé-2030'};
 // Exercise browser-bundled create preparation through the production projection.
 assert.match(googleProjectionLocalId(identity),/^sd-occ-[0-9a-f]{64}$/);
 const {createHash}=await import('../../scripts/mobile-hash-shim.js');const {createHash:native}=await import('node:crypto');
 for(const value of ['',JSON.stringify([identity.seriesLocalId,identity.occurrenceKey]),'é😀'.repeat(100)])assert.equal(createHash('sha256').update(value).digest('hex'),native('sha256').update(value).digest('hex'));
});
