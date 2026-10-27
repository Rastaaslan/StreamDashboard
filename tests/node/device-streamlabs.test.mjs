import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeviceStreamlabs} from '../../apps/mobile/control/device-streamlabs.js';

const event=(id,name='Alice')=>({_id:id,type:'follow',platform:'twitch_account',display_name:name,created_at:'2030-11-01 18:00:00'});
function fixture(){
 const record={drafts:{}},calls=[];let time=Date.parse('2030-11-01T20:00:00Z'),account='',data={follows:[event('a')]},failure,readWait;
 const store={record,reload:async()=>{},draft:async(k,v)=>{record.drafts[k]=structuredClone(v);}};
 const call=async payload=>{
  calls.push(payload);assert.equal(payload.provider,'streamlabs');
  if(payload.operation==='historyConfigure')account=payload.widgetUrl==='widget-b'?'b'.repeat(64):'a'.repeat(64);
  if(payload.operation==='historyClear')account='';
  const state={ok:true,configured:Boolean(account),accountKey:account};
  if(payload.operation==='historyRead'){const readFailure=failure,value={...state,data:structuredClone(data)};if(readWait)await readWait;if(readFailure)throw Object.assign(new Error('private token should not enter public errors'),{code:readFailure});return value;}
  return state;
 };
 const open=()=>createDeviceStreamlabs({store,call,now:()=>time});
 return {store,calls,open,account:value=>{account=value.repeat(64);},data:value=>{data=value;},fail:value=>{failure=value;},waitRead:value=>{readWait=value;},advance:ms=>{time+=ms;},get reads(){return calls.filter(x=>x.operation==='historyRead').length;}};
}
test('native cloud history works without a régie and never claims a socket connection',async()=>{
 const s=fixture(),r=s.open();assert.deepEqual((await r.route('/api/v1/streamlabs/events')).items,[]);assert.equal(s.reads,0);
 const configured=await r.route('/api/v1/supports/streamlabs/history/config',{widgetUrl:'widget-a'},'PUT');assert.equal(configured.status,'SYNCED');
 const result=await r.route('/api/v1/streamlabs/events');assert.equal(result.items[0].displayName,'Alice');assert.equal(result.items[0].origin,'cloud');assert.equal(result.history.count,1);
 assert.deepEqual(result.provider,{status:'NOT_SUPPORTED',configured:false,lastError:null});assert.equal(s.reads,1);
 assert.ok(!JSON.stringify(s.store.record).includes('widget-a'));assert.equal(Object.keys(s.store.record.drafts)[0],'streamlabs.history:'+'a'.repeat(64));
});
test('refresh preserves durable activity, merges duplicate identities and filters technical widgets and credentials',async()=>{
 const s=fixture();s.account('a');const r=s.open();await r.route('/api/v1/streamlabs/events');
 s.data({follows:[event('a'),{...event('b','Bob'),email:'private@example.test',access_token:'private-secret'}, {...event('noise'),type:'rollendcredits'}],twitch:{token:'hidden'}});
 const result=await r.route('/api/v1/streamlabs/events?refresh=1');assert.equal(s.reads,2);assert.equal(result.items.length,2);
 assert.deepEqual(new Set(result.items.map(x=>x.displayName)),new Set(['Alice','Bob']));assert.ok(!JSON.stringify(s.store.record).includes('private'));assert.ok(!JSON.stringify(result).includes('rollendcredits'));
 const reopened=await s.open().route('/api/v1/streamlabs/events');assert.equal(reopened.items.length,2);assert.equal(s.reads,2);
 s.fail('NETWORK');s.advance(30_001);const failed=await s.open().route('/api/v1/streamlabs/events');assert.equal(failed.history.status,'ERROR');assert.equal(failed.items.length,2);assert.ok(!failed.history.lastError.includes('private'));
});
test('429 backoff survives restart and explicit refresh or re-save cannot bypass it',async()=>{
 const s=fixture();s.account('a');let r=s.open();await r.route('/api/v1/streamlabs/events');s.fail('HTTP_429');
 await r.route('/api/v1/supports/streamlabs/history/refresh',{},'POST');assert.equal(s.reads,2);
 r=s.open();let state=await r.route('/api/v1/supports/streamlabs/history/config',{widgetUrl:'widget-a'},'PUT');assert.equal(state.status,'ERROR');assert.equal(s.reads,2);
 s.advance(59_999);await r.route('/api/v1/streamlabs/events?refresh=1');assert.equal(s.reads,2);
 s.advance(1);s.fail(null);state=await r.route('/api/v1/supports/streamlabs/history/refresh',{},'POST');assert.equal(state.status,'SYNCED');assert.equal(s.reads,3);
});
test('changing or disconnecting the widget never shows another account’s cached activity',async()=>{
 const s=fixture(),r=s.open();await r.route('/api/v1/supports/streamlabs/history/config',{widgetUrl:'widget-a'},'PUT');
 s.data({follows:[event('b','Compte B')]});await r.route('/api/v1/supports/streamlabs/history/config',{widgetUrl:'widget-b'},'PUT');
 let state=await r.route('/api/v1/streamlabs/events');assert.deepEqual(state.items.map(x=>x.displayName),['Compte B']);
 await r.route('/api/v1/supports/streamlabs/history/config',{},'DELETE');state=await r.route('/api/v1/streamlabs/events');assert.equal(state.items.length,0);assert.equal(state.history.status,'NOT_CONFIGURED');
 s.account('a');state=await r.route('/api/v1/streamlabs/events');assert.deepEqual(state.items.map(x=>x.displayName),['Alice']);
});
test('an incomplete cloud response or rejected credentials cannot become a false synchronized state',async()=>{
 const s=fixture();s.account('a');const r=s.open();s.data({credentials:{secret:'hidden'}});
 let result=await r.route('/api/v1/streamlabs/events');assert.equal(result.history.status,'ERROR');assert.equal(result.history.lastSyncAt,null);assert.equal(result.items.length,0);
 for(const code of ['HTTP_401','HTTP_403']){s.fail(code);result=await r.route('/api/v1/streamlabs/events?refresh=1');assert.equal(result.history.status,'ERROR');assert.match(result.history.lastError,/refuse cet historique/);}
 assert.ok(!JSON.stringify(s.store.record).includes('hidden'));
});
test('a delayed response or failure from the previous widget cannot repopulate a changed account',async()=>{
 for(const failure of [null,'HTTP_401']){
  const s=fixture();s.account('a');const r=s.open();await r.route('/api/v1/streamlabs/events');s.advance(30_001);s.fail(failure);
  let finish;s.waitRead(new Promise(resolve=>{finish=resolve;}));const pending=r.route('/api/v1/streamlabs/events');await new Promise(resolve=>setImmediate(resolve));
  s.account('b');s.data({follows:[event('b','Compte B')]});finish();
  const obsolete=await pending;assert.equal(obsolete.items.length,0);assert.equal(obsolete.history.status,'SYNCING');assert.equal(obsolete.history.lastError,null);
  s.waitRead(null);s.fail(null);const current=await r.route('/api/v1/streamlabs/events');assert.deepEqual(current.items.map(x=>x.displayName),['Compte B']);
  assert.ok(!JSON.stringify(s.store.record.drafts['streamlabs.history:'+'b'.repeat(64)]).includes('Alice'));
 }
});
