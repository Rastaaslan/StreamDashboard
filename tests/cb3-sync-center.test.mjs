import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { CompanionMode as M, resolveMode, createCompanionStore } from '../apps/mobile/companion-store.js';
import { createStandaloneProviderSync } from '../apps/mobile/provider-sync.js';
import { modeDescription, eventProviderState, syncSummary, createProviderRetry } from '../apps/mobile/sync-center.js';
const store = () => createCompanionStore({ getItem: () => null, setItem() {} }, () => '2026-09-28T10:00:00Z');

test('mode transitions match CompanionMode and explain capabilities', () => {
  for (const [pcAvailable, internetAvailable, mode] of [[true,true,M.ONLINE_PC],[false,true,M.ONLINE_STANDALONE],[false,false,M.OFFLINE],[true,false,M.ONLINE_PC]]) {
    assert.equal(resolveMode({ pcAvailable, internetAvailable }), mode);
    assert.ok(modeDescription(mode, true).available.includes('Planning'));
  }
  assert.equal(modeDescription(M.ONLINE_STANDALONE).label, 'Standalone Android');
  assert.match(modeDescription(M.OFFLINE).available, /conservées/);
});

test('pending operations, publication conflicts and successful sync timestamps remain distinct', () => {
  const s = store(); const item = s.createEvent({ title: 'Live', desiredPublication: { twitch:true, google:true } }).item;
  s.updateProvider(item.id, 'twitch', { status:'conflict', lastError:'Version distante modifiée' });
  s.applySyncResponse({ conflicts:[{ operationId:'op', fields:['title'] }] });
  let summary = syncSummary(s.snapshot(), undefined, M.ONLINE_STANDALONE);
  assert.equal(summary.pending, 2); assert.equal(summary.providerPending, 1); assert.equal(summary.conflicts, 2); assert.equal(summary.lastSync, null);
  s.updateProvider(item.id, 'google', { status:'synced' });
  summary = syncSummary(s.snapshot(), undefined, M.ONLINE_STANDALONE);
  assert.equal(summary.lastSync, '2026-09-28T10:00:00Z');
  assert.equal(summary.pending, 3); // each provider result is durable and does not acknowledge the PC queue
  s.applySyncResponse({ acknowledged:s.snapshot().pending.map(op=>op.id), conflicts:[] });
  assert.equal(syncSummary(s.snapshot(), undefined, M.ONLINE_STANDALONE).pending, 0);
});

test('all event statuses and PC/Android metadata are exposed including conflicts and deleted links', () => {
  for (const status of ['synced','syncing','error','conflict','deleted']) {
    const item = { providers:{ twitch:{ status } }, providerLinks:{ google:{ status } } };
    assert.equal(eventProviderState(item, 'twitch', M.ONLINE_PC).status,status);
    assert.equal(eventProviderState(item, 'google', M.ONLINE_STANDALONE).retryable,['error','conflict'].includes(status));
  }
  assert.equal(eventProviderState({ conflict:{provider:'twitch'} },'twitch',M.ONLINE_PC).status,'conflict');
  assert.equal(eventProviderState({},'google',M.OFFLINE).status,'not-published');
});

test('targeted retry routes by mode, deduplicates and rejects offline or unsupported requests', async () => {
  let mode=M.ONLINE_PC; const calls=[];
  const retry=createProviderRetry({getMode:()=>mode,nativeAvailable:()=>true,pcRetry:async (...args)=>calls.push(args),standaloneRetry:async (item,provider)=>calls.push([item.id,provider,'android'])});
  const item={id:'event'};
  const first=retry(item,'google'); assert.equal(retry(item,'google'),first); await first;
  assert.deepEqual(calls,[['event','google']]);
  mode=M.ONLINE_STANDALONE; await retry(item,'twitch'); assert.deepEqual(calls[1],['event','twitch','android']);
  mode=M.OFFLINE; await assert.rejects(retry(item,'google'),/Hors ligne/); assert.equal(calls.length,2);
  await assert.rejects(retry(item,'unknown'),/inconnu/);
});

test('standalone retry preserves other provider, reports syncing/conflict then clears error on successful create', async () => {
  const s=store(); const item=s.createEvent({title:'Live',desiredPublication:{twitch:true,google:true},providerLinks:{google:{status:'synced',remoteId:'g'}}}).item;
  let fail=true; const calls=[];
  const sync=createStandaloneProviderSync({store:s,adapter:{mutate:async(provider,action)=>{calls.push([provider,action]); assert.equal(s.snapshot().planning[0].providerLinks.twitch.status,'syncing'); if(fail) throw Object.assign(new Error('Conflit distant'),{code:'CONFLICT',mutationNotStarted:true}); return {remoteId:'t'};}}});
  await sync.apply(M.ONLINE_STANDALONE,item,undefined,'twitch');
  assert.equal(s.snapshot().planning[0].providerLinks.twitch.status,'conflict');
  fail=false; await sync.apply(M.ONLINE_STANDALONE,s.snapshot().planning[0],undefined,'twitch');
  const links=s.snapshot().planning[0].providerLinks;
  assert.equal(links.twitch.status,'synced'); assert.equal(links.twitch.lastError,null); assert.deepEqual(links.google,{status:'synced',remoteId:'g'});
  assert.deepEqual(calls,[['twitch','create'],['twitch','create']]);
  await sync.apply(M.OFFLINE,item,undefined,'twitch'); assert.equal(calls.length,2);
});

test('failed deletions remain retryable in sync center', async () => {
  const s=store(); const item=s.createEvent({ title:'Deleted',providerLinks:{google:{remoteId:'g',status:'synced'}} }).item;
  s.deleteEvent(item.id,item.revision); s.updateProvider(item.id,'google',{status:'error',lastError:'Réseau'});
  const entry=syncSummary(s.snapshot(),undefined,M.ONLINE_STANDALONE).entries.find(e=>e.provider==='google');
  assert.equal(entry.item.deleted,true); assert.equal(entry.retryable,true);
  const sync=createStandaloneProviderSync({store:s,adapter:{mutate:async(provider,action)=>{assert.equal(provider,'google');assert.equal(action,'delete');return {};}}});
  await sync.apply(M.ONLINE_STANDALONE,entry.item,'delete','google');
  assert.equal(s.snapshot().tombstones[0].providerLinks.google.status,'deleted');
});

test('event controls expose two providers and invoke only selected retry without opening editor', async () => {
  const source=readFileSync(new URL('../apps/mobile/mobile.js',import.meta.url),'utf8');
  const node=()=>({children:[],append(...items){this.children.push(...items);}});
  const calls=[]; const context={CompanionMode:M,document:{createElement:node},text:(tag,label)=>({...node(),tag,label}),eventProviderState,companionMode:M.ONLINE_PC,planningProviderNames:{twitch:'Twitch',google:'Google'},retryPlanningProvider:async(item,p)=>calls.push(p),state:null,globalThis:{}};
  vm.createContext(context); vm.runInContext(source.slice(source.indexOf('function renderOnlinePlanningProviders'),source.indexOf('function updatePlanningProviderReadiness')),context);
  const row=node(); context.renderOnlinePlanningProviders({id:'a',providers:{twitch:{status:'conflict'},google:{status:'error'}}},row);
  assert.equal(row.children.length,2);
  const button=row.children[1].children.find(n=>n.tag==='button'); await button.onclick(); assert.deepEqual(calls,['google']);
  assert.match(source,/event.target !== row/);
});

test('mobile retains five tabs, editor and offline cache for sync center', () => {
  const read=name=>readFileSync(new URL(`../apps/mobile/${name}`,import.meta.url),'utf8');
  const html=read('index.html'); assert.deepEqual([...html.matchAll(/<button[^>]* data-tab="([^"]+)"/g)].map(m=>m[1]),['home','live','sounds','planning','more']);
  for(const id of ['slot-form','slot-dialog','open-sync-center','sync-center','sync-resolve','operating-mode']) assert.ok(html.includes(`id="${id}"`),id);
  const worker=read('sw.js'); for(const [,dependency] of read('mobile.js').matchAll(/from ['"]\.\/(.+?)['"]/g)){assert.ok(worker.includes(`'${dependency}'`),dependency);assert.ok(worker.includes(`'/mobile/${dependency}'`),dependency);}
});

test('server remote deletion is displayed as deleted and retains a targeted retry', async () => {
  const item = { id:'remote-deleted', providers:{google:{status:'error',deletedRemotely:true,lastError:'Événement supprimé à distance — action utilisateur requise.',lastSyncedAt:'2026-09-28T11:00:00Z'}} };
  const link = eventProviderState(item,'google',M.ONLINE_PC);
  assert.equal(link.status,'deleted'); assert.equal(link.label,'Supprimé'); assert.equal(link.retryable,true);
  assert.match(link.lastError,/supprimé à distance/);
  const summary=syncSummary(store().snapshot(),[item],M.ONLINE_PC);
  assert.equal(summary.lastSync,null);
  assert.equal(summary.entries.find(entry=>entry.provider==='google').retryable,true);
  const calls=[];
  const retry=createProviderRetry({getMode:()=>M.ONLINE_PC,nativeAvailable:()=>false,pcRetry:async(...args)=>calls.push(args)});
  await retry(item,'google'); assert.deepEqual(calls,[['remote-deleted','google']]);
});

test('summary combines successful PC and Android timestamps and never counts failed attempts', () => {
  const cache=store().snapshot();
  const pc={id:'pc',providers:{twitch:{status:'synced',lastSyncedAt:'2026-09-28T11:00:00Z'}}};
  assert.equal(syncSummary(cache,[pc],M.ONLINE_PC).lastSync,'2026-09-28T11:00:00Z');
  const android={id:'android',providerLinks:{google:{status:'synced',lastProviderSyncAt:'2026-09-28T12:00:00Z'}}};
  assert.equal(syncSummary(cache,[android],M.ONLINE_STANDALONE).lastSync,'2026-09-28T12:00:00Z');
  const failed={id:'failed',providers:{google:{status:'error',lastSyncedAt:'2026-09-28T13:00:00Z',lastProviderSyncAt:'2026-09-28T14:00:00Z'}}};
  assert.equal(syncSummary(cache,[pc,android,failed],M.ONLINE_PC).lastSync,'2026-09-28T12:00:00Z');
  for(const status of ['error','conflict','syncing','pending']) {
    failed.providers.google.status=status;
    assert.equal(syncSummary(cache,[failed],M.ONLINE_PC).lastSync,null);
  }
  cache.lastServerSyncAt='2026-09-28T15:00:00Z';
  assert.equal(syncSummary(cache,[pc,android,failed],M.ONLINE_PC).lastSync,cache.lastServerSyncAt);
});

test('occurrence and sync-center retry controls refuse unsupported Android series without remote mutation', async () => {
  const source=readFileSync(new URL('../apps/mobile/mobile.js',import.meta.url),'utf8');
  const s=store();
  const series=s.createEvent({id:'series',title:'Hebdomadaire',recurrence:{frequency:'weekly',interval:1},desiredPublication:{twitch:true,google:true},providerLinks:{twitch:{status:'error'},google:{status:'error',remoteId:'g'}}}).item;
  let mutations=0;
  const sync=createStandaloneProviderSync({store:s,adapter:{mutate:async()=>{mutations++; return {remoteId:'bad-partial-publication'};}}});
  const node=()=>({children:[],append(...items){this.children.push(...items);}});
  const context={CompanionMode:M,createProviderRetry,companionMode:M.ONLINE_STANDALONE,companion:s,globalThis:{StreamDashboardProviders:{}},
    syncEventProviders:(item,action,provider)=>sync.apply(M.ONLINE_STANDALONE,item,action,provider),
    renderSyncCenter(){},note(){},syncError:'',state:null,
    document:{createElement:node},text:(tag,label)=>({...node(),tag,label}),eventProviderState,planningProviderNames:{twitch:'Twitch',google:'Google'}};
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('const targetedRetry ='),source.indexOf('function updatePlanningProviderReadiness')),context);
  const occurrence={...series,id:'series:occurrence',seriesId:series.id,occurrenceKey:'2026-10-05',recurrence:undefined};
  const row=node(); context.renderOnlinePlanningProviders(occurrence,row);
  await row.children[0].children.find(child=>child.tag==='button').onclick();
  let saved=s.snapshot().planning[0];
  assert.equal(saved.providerLinks.twitch.status,'error'); assert.match(saved.providerLinks.twitch.lastError,/récurrence locale/);
  assert.deepEqual(saved.providerLinks.google,series.providerLinks.google);
  const entry=syncSummary(s.snapshot(),undefined,M.ONLINE_STANDALONE).entries.find(entry=>entry.provider==='google');
  const center=node(); context.renderOnlinePlanningProviders(entry.item,center,entry.provider);
  await center.children[0].children.find(child=>child.tag==='button').onclick();
  saved=s.snapshot().planning[0];
  assert.equal(saved.providerLinks.google.status,'error'); assert.match(saved.providerLinks.google.lastError,/récurrence locale/);
  assert.equal(saved.providerLinks.google.remoteId,'g'); assert.deepEqual(saved.recurrence,series.recurrence);
  assert.equal(mutations,0); assert.equal(syncSummary(s.snapshot(),undefined,M.ONLINE_STANDALONE).lastSync,null);
  // The same guard protects initial automatic publication, not just retry controls.
  await sync.apply(M.ONLINE_STANDALONE,series,'create'); assert.equal(mutations,0);
});
