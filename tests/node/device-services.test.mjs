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

function commandSetup(){
 const record={workspace:'local:commands',drafts:{}},sent=[],operations=[];let lost=false,refusal,failStore=false;
 const store={record,reload:async()=>{},draft:async(k,v)=>{if(failStore)throw new Error('Stockage indisponible');record.drafts[k]=structuredClone(v);}};
 const bridge={deviceService:raw=>{const payload=JSON.parse(raw);operations.push(payload);assert.equal(payload.operation,'context');return JSON.stringify({ok:true,connected:true,canSend:true,channel:'test_channel'});},wizebotSendCommand:raw=>{
  const payload=JSON.parse(raw);assert.ok(record.drafts.wizebotCommands.some(x=>x.commandId===payload.commandId&&x.status==='uncertain'),'intent is durable before chat I/O');sent.push(payload);
  if(lost)throw new Error('Transport perdu');return JSON.stringify(refusal||{ok:true,status:'sent',messageId:'accepted-1',message:'Commande envoyée dans le chat Twitch.'});
 }};
 return {store,sent,operations,open:()=>createDeviceServices({store,bridge}),lose:()=>{lost=true;},refuse:value=>{refusal=value;},failStore:()=>{failStore=true;}};
}
const chatCommand={commandId:'command_0001',channel:'test_channel',command:'!bonjour une chaîne'};
test('manual WizeBot buttons obtain local context without any catalog and persist one receipt per press',async()=>{
 const s=commandSetup(),r=s.open();const context=await r.route('/api/v2/wizebot/context');assert.equal(context.channel,'test_channel');assert.equal(context.canSend,true);assert.equal(s.store.record.drafts.wizebotCatalog,undefined);
 assert.deepEqual(s.store.record.drafts.deviceChat,{connected:true,canSend:true,channel:'test_channel'});
 const receipt=await r.route('/api/v2/wizebot/command',chatCommand,'POST');assert.equal(receipt.status,'succeeded');assert.equal(receipt.messageId,'accepted-1');
 const duplicate=await s.open().route('/api/v2/wizebot/command',chatCommand,'POST');assert.deepEqual(duplicate,receipt);assert.equal(s.sent.length,1);
 await assert.rejects(r.route('/api/v2/wizebot/command',{...chatCommand,command:'!autre'},'POST'),/réutilisé/);assert.equal(s.sent.length,1);
 assert.equal(await r.route('/api/v2/wizebot/command',{...chatCommand,commandId:'command_0002'},'GET'),undefined);assert.equal(s.sent.length,1);
});
test('a lost local chat result remains uncertain across restart and refuses automatic replay',async()=>{
 const s=commandSetup();s.lose();const receipt=await s.open().route('/api/v2/wizebot/command',chatCommand,'POST');assert.equal(receipt.status,'uncertain');
 assert.equal((await s.open().route('/api/v2/wizebot/command',chatCommand,'POST')).status,'uncertain');assert.equal(s.sent.length,1);
});
test('native account changes and missing chat permission remain explicit failures',async()=>{
 for(const code of ['INVALID_LINK','REAUTH_REQUIRED']){const s=commandSetup();s.refuse({ok:false,code,message:'Le compte doit être vérifié.'});assert.equal((await s.open().route('/api/v2/wizebot/command',chatCommand,'POST')).status,'failed');assert.equal(s.sent.length,1);}
 const s=commandSetup();s.refuse({ok:false,code:'NETWORK',message:'Résultat non confirmé.'});assert.equal((await s.open().route('/api/v2/wizebot/command',chatCommand,'POST')).status,'uncertain');
});
test('invalid commands or failed durable storage never reach the native chat transport',async()=>{
 const s=commandSetup(),r=s.open();for(const patch of [{command:'texte'},{command:'!ok\n!second'},{command:'!ok\u0000'},{command:'!'+ 'a'.repeat(500)},{channel:'other.example'},{commandId:'short'}])await assert.rejects(r.route('/api/v2/wizebot/command',{...chatCommand,...patch},'POST'),/invalide/);
 assert.equal(s.sent.length,0);s.failStore();await assert.rejects(r.route('/api/v2/wizebot/command',chatCommand,'POST'),/Stockage/);assert.equal(s.sent.length,0);
});

function desktopCommandSetup(){
 const record={workspace:'local:desktop-commands',drafts:{}},sent=[];let channel='test_channel',lost=false,failStore=false;
 const store={record,reload:async()=>{},draft:async(k,v)=>{if(failStore)throw new Error('Disk unavailable');record.drafts[k]=structuredClone(v);}};
 const request=async(path,body,method)=>{
  if(path==='/api/v1/twitch/chat/state')return {accountConnected:true,capabilities:{chatWrite:true},identity:{userName:channel,broadcasterId:'broadcaster-1'}};
  assert.equal(path,'/api/v1/twitch/chat/messages');assert.equal(method,'POST');
  assert.equal(body.expectedBroadcasterId,'broadcaster-1');assert.equal(record.drafts.wizebotCommands.at(-1).status,'uncertain');sent.push(body);
  if(lost)throw new Error('Response lost');return {messageId:'desktop-accepted'};
 };
 return {store,sent,open:()=>createDeviceServices({store,request,bridge:null}),channel:value=>{channel=value;},lose:()=>{lost=true;},failStore:()=>{failStore=true;}};
}
test('desktop local WizeBot uses its own fresh Twitch identity and persists before sending',async()=>{
 const s=desktopCommandSetup();assert.equal((await s.open().route('/api/v2/wizebot/context')).channel,'test_channel');
 assert.equal((await s.open().route('/api/v2/wizebot/command',chatCommand,'POST')).status,'succeeded');
 assert.equal((await s.open().route('/api/v2/wizebot/command',chatCommand,'POST')).messageId,'desktop-accepted');assert.equal(s.sent.length,1);
 s.channel('another_channel');assert.equal((await s.open().route('/api/v2/wizebot/command',{...chatCommand,commandId:'changed_0002'},'POST')).status,'failed');assert.equal(s.sent.length,1);
});
test('desktop local lost response is never replayed; unavailable storage prevents chat I/O',async()=>{
 const s=desktopCommandSetup();s.lose();assert.equal((await s.open().route('/api/v2/wizebot/command',chatCommand,'POST')).status,'uncertain');
 assert.equal((await s.open().route('/api/v2/wizebot/command',chatCommand,'POST')).status,'uncertain');assert.equal(s.sent.length,1);
 const denied=desktopCommandSetup();denied.failStore();await assert.rejects(denied.open().route('/api/v2/wizebot/command',chatCommand,'POST'),/Disk unavailable/);assert.equal(denied.sent.length,0);
});

test('a disabled chat role rejects WizeBot before creating a receipt or invoking the native bridge',async()=>{
 const s=setup();const service=createDeviceServices({store:s.store,autonomy:{},bridge:{},enabled:()=>false});
 await assert.rejects(service.route('/api/v2/wizebot/command',{commandId:'stopped_role',channel:'test_channel',command:'!bonjour'},'POST'),{code:'DEVICE_ROLE_STOPPED'});
 assert.equal(s.store.record.drafts.wizebotCommands,undefined);
});
test('a disabled planning role never calls the native provider and reports a non-started mutation',async()=>{
 const {createDeviceProviders}=await import('../../apps/mobile/control/device-providers.js');
 let calls=0;const providers=createDeviceProviders({enabled:()=>false,request:async()=>{calls++;}});
 await assert.rejects(providers.call('google','create',{}),{code:'DEVICE_ROLE_STOPPED',mutationNotStarted:true});
 assert.equal(calls,0);
});
