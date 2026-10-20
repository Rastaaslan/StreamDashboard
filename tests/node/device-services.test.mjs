import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeviceServices} from '../../apps/mobile/control/device-services.js';

function setup(){
 const record={workspace:'local:test',drafts:{}},bundle={data:{configuration:{actions:[],revision:0}},extras:{discord:{channelId:'123',defaultMessage:'Planning'}}};
 const store={record,reload:async()=>{},view:()=>structuredClone(bundle),draft:async(k,v)=>{record.drafts[k]=structuredClone(v);}};
 let text='Ancienne réponse',alias='!bonjour',sent=0,fail=false;const configurations=[];
 const bridge={deviceService:raw=>{const body=JSON.parse(raw);if(body.operation==='configure'){configurations.push(body);return '{"ok":true,"configured":true}';}return JSON.stringify({ok:true,channel:'test_channel',canSend:true,catalog:{data:[[alias,'123',text,'-','','SAY',0]]}});},wizebotSendEdit:raw=>{sent++;if(fail)throw new Error('Réponse perdue');text=JSON.parse(raw).response;return '{"ok":true,"status":"sent","messageId":"message-1"}';}};
 const autonomy={mutate:async(_path,body)=>{bundle.data.configuration=structuredClone(body.configuration);}};
 const open=()=>createDeviceServices({store,autonomy,bridge});
 return {store,bundle,open,configurations,get sent(){return sent;},alias:v=>{alias=v;},fail:()=>{fail=true;}};
}
test('local WizeBot import preserves custom buttons and deduplicates; native secrets stay outside replicas',async()=>{
 const s=setup(),r=s.open();await r.route('/api/v1/discord/token',{token:'fake-secret'},'PUT');assert.equal(s.configurations.length,1);assert.ok(!JSON.stringify(s.store.record).includes('fake-secret'));
 await r.route('/api/v2/wizebot/refresh',{},'POST');await r.route('/api/v2/wizebot/import',{channel:'test_channel',ids:['123']},'POST');
 const action=s.bundle.data.configuration.actions[0];action.label='Bouton personnel';action.shortcut='F9';s.alias('!salut');await r.route('/api/v2/wizebot/refresh',{},'POST');
 await r.route('/api/v2/wizebot/import',{channel:'test_channel',ids:['123']},'POST');assert.equal(s.bundle.data.configuration.actions.length,1);assert.equal(s.bundle.data.configuration.actions[0].label,'Bouton personnel');assert.equal(s.bundle.data.configuration.actions[0].value,'!salut');assert.equal(s.sent,0);
});
test('autonomous bot edits require exact readback and never resend an uncertain request',async()=>{
 const s=setup(),r=s.open();const c=await r.route('/api/v2/wizebot/refresh',{},'POST');
 const body={id:'request_0001',channel:'test_channel',commandId:'123',expectedRevision:c.items[0].revision,response:'Nouvelle réponse'};
 assert.equal((await r.route('/api/v2/wizebot/edit',body,'POST')).status,'succeeded');assert.equal(s.sent,1);
 assert.equal((await s.open().route('/api/v2/wizebot/edit',body,'POST')).status,'succeeded');assert.equal(s.sent,1);
 const current=await r.route('/api/v2/wizebot/refresh',{},'POST');s.fail();const lost={...body,id:'request_0002',response:'Envoi perdu',expectedRevision:current.items[0].revision};
 assert.equal((await r.route('/api/v2/wizebot/edit',lost,'POST')).status,'uncertain');
 assert.equal((await s.open().route('/api/v2/wizebot/edit',{...lost,id:'request_0003'},'POST')).status,'uncertain');assert.equal(s.sent,2);
});
