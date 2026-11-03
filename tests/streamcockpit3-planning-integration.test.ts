import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
// @ts-expect-error Browser module
import { createPlanning } from '../apps/mobile/control/planning.js';
// @ts-expect-error Browser adapter
import { renderPlanningAssistant, suggestPlanningSlots, parisInstant } from '../apps/mobile/control/streamcockpit-planning.js';
import * as core from '../packages/core/src/streamcockpit-planning.js';
const esc = (v: string) => String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const now=Date.parse('2026-03-29T00:00:00Z');
const items=[{id:'busy',title:'<img src=x onerror=alert(1)>',source:'GOOGLE',providers:{google:{status:'synced',lastSyncedAt:'2020-01-01T00:00:00Z'}},startAtUtc:'2026-03-29T00:00:00Z',endAtUtc:'2026-03-29T02:00:00Z',category:'personal'}];
it('browser adapter exactly matches canonical transpilation (including recurrence imports)',()=>{
 const source=readFileSync('apps/mobile/control/streamcockpit-planning.js','utf8').replace(/\r\n/g, '\n').split('// BEGIN core adapter: TypeScript ES2022 transpilation; see LOT_O_WAVE4.md.\n')[1].split('// END core adapter')[0];
 const expected=ts.transpileModule(readFileSync('packages/core/src/streamcockpit-planning.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replace("from './recurrence.js'","from '../shared/recurrence.js'").replace("from './uuid.js'","from '../shared/uuid.js'");
 expect(source).toBe(expected);
});
it('mounts the real Planning views, offline/reconnect, without API or editor calls or mutation',()=>{
 vi.useFakeTimers();vi.setSystemTime(now);
 try {
 let online=true;const api=vi.fn(),modal=vi.fn();const data={host:{planning:structuredClone(items),settings:{},planningRevisions:{}}};
 const before=JSON.stringify(data);
 const planning=createPlanning({getData:()=>data,getConnection:()=>online,api,esc,input:()=>'',select:()=>'',check:()=>'',modal});
 for(const connection of [true,false,true]){online=connection;for(const view of ['next','week','events','manage']){
 const html=planning.mobilePage(view);
 expect(html.match(/data-planning-assistant/g)).toHaveLength(1);
 expect(html).toContain('Suggestion locale non publiée');expect(html).toContain('UNKNOWN');expect(html).toContain('GOOGLE / google');
 expect(html).toContain(connection?'Connexion régie disponible':'Hors ligne');
 expect(html).toContain('disabled>Dupliquer vers un brouillon');expect(html).not.toContain('<img');
 }}
 expect(api).not.toHaveBeenCalled();expect(modal).not.toHaveBeenCalled();expect(JSON.stringify(data)).toBe(before);
 } finally {vi.useRealTimers();}
});
it('counts hidden imported blockers, labels stale provenance UNKNOWN and blocks invalid copies',()=>{
 const html=renderPlanningAssistant(items,{esc,now});
 expect(html).toContain('04:00:00');expect(html).toContain('Fraîcheur distante inconnue');
 const connected=renderPlanningAssistant(items,{esc,now,googleConnected:true});
 expect(connected).toContain('Compte Google connecté à la régie');
 expect(connected).toContain('<details class="planning-assist-suggestions">');
 expect(connected).toContain('Afficher les 3 propositions locales');
 expect((connected.match(/data-planning="assist-new"/g)||[])).toHaveLength(3);
 expect(connected).toContain('UNKNOWN pour les disponibilités');
 expect(connected).not.toContain('Synchronisation Google confirmée');
 expect(renderPlanningAssistant(items,{esc,now,googleConnected:false})).toContain('Compte Google non connecté sur cette source');
 expect(renderPlanningAssistant([{...items[0],conflict:true}],{esc,now})).toContain('Calcul indisponible');
 expect(renderPlanningAssistant(undefined,{esc,now})).toContain('Copie locale indisponible');
});
it('uses canonical DST and rejects stale observations without claiming availability',()=>{
 for(const input of ['2026-03-29T02:30','2026-10-25T02:30'])expect(()=>parisInstant(input)).toThrow();
 expect(parisInstant('2026-10-25T02:30','later')).toBe(core.parisInstant('2026-10-25T02:30','later'));
 const snapshot=[{source:'local',status:'observed',observedAt:new Date(now-3600000).toISOString(),from:'2026-03-29T00:00:00Z',to:'2026-03-30T00:00:00Z',items}, {source:'google',status:'disabled',items:[]}];
 expect(()=>suggestPlanningSlots(snapshot,{from:snapshot[0].from,to:snapshot[0].to,durationMinutes:60},now)).toThrow();
});
