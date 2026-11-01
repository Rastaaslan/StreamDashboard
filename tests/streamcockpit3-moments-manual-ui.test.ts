import { expect, it, vi, afterEach } from 'vitest';
// @ts-expect-error Browser module without generated declarations.
import { mountManualMomentForm } from '../apps/mobile/control/streamcockpit-moments-manual.js';

class Node {
  children: Node[] = []; textContent = ''; value = ''; disabled = false; hidden = false; removed = false;
  attributes: Record<string,string> = {};
  listeners = new Map<string,(event?: {preventDefault():void})=>void>();
  ownerDocument = {createElement: () => new Node()};
  setAttribute(key:string,value:string) {this.attributes[key]=value;}
  append(...children:Node[]) {this.children.push(...children);}
  remove(){this.removed=true;}
  addEventListener(event:string,handler:(event?: {preventDefault():void})=>void){this.listeners.set(event,handler);}
  dispatch(event:string){this.listeners.get(event)?.({preventDefault(){}});}
}
const uuid = 'b467019c-3fbb-4ccb-a499-3c459d5ad173';
const success = {schemaVersion:1,kind:'streamcockpit-manual-marker',
  outcome:'created',sessionId:'session_1',correlationId:'e'.repeat(64),
  instant:1800000000000,sequence:1,source:'manual',status:'observed'};
const controls = (root:Node) => {
  const section=root.children[0],form=section.children[2],label=form.children[0],input=label.children[0],button=form.children[1],status=section.children[3],verify=section.children[4];
  return {section,form,input,button,status,verify};
};
afterEach(()=>vi.unstubAllGlobals());

it('F09 mobile sends one explicit authenticated request, never invents a live or repeats it',async()=>{
  vi.stubGlobal('crypto',{randomUUID:()=>uuid});
  const request=vi.fn(async()=>success),onRecorded=vi.fn();
  const root=new Node(),view=mountManualMomentForm(root,{online:true,request,onRecorded});
  const c=controls(root);
  expect(request).not.toHaveBeenCalled();
  c.input.value='  Important passage  ';c.form.dispatch('submit');
  await vi.waitFor(()=>expect(request).toHaveBeenCalledExactlyOnceWith(
    '/api/v1/streamcockpit-moments/manual/add',{requestId:uuid,title:'Important passage'}));
  expect(onRecorded).toHaveBeenCalledWith('session_1');
  expect(c.input.value).toBe('');
  expect(c.status.textContent).toContain('journalisé');
  view.destroy();expect(c.section.removed).toBe(true);
});

it('F09 mobile disables manual writes offline without an outbox',()=>{
  const request=vi.fn(),root=new Node(),view=mountManualMomentForm(root,{online:false,request});
  const c=controls(root);
  expect(c.input.disabled).toBe(true);expect(c.button.disabled).toBe(true);
  c.input.value='No offline replay';c.form.dispatch('submit');
  expect(request).not.toHaveBeenCalled();
  view.destroy();
});

it('F09 mobile ignores late success after disconnect and erases private title',async()=>{
  vi.stubGlobal('crypto',{randomUUID:()=>uuid});
  let resolve!: (value:unknown)=>void;
  const request=vi.fn(()=>new Promise(r=>{resolve=r;})),onRecorded=vi.fn();
  const root=new Node(),view=mountManualMomentForm(root,{online:true,request,onRecorded});
  const c=controls(root);
  c.input.value='Confidentiel';c.form.dispatch('submit');
  expect(request).toHaveBeenCalledTimes(1);
  view.unavailable();
  expect(c.button.disabled).toBe(true);expect(c.input.value).toBe('');
  resolve(success);await Promise.resolve();await Promise.resolve();
  expect(onRecorded).not.toHaveBeenCalled();
  expect(c.status.textContent).not.toContain('Confidentiel');
  c.form.dispatch('submit');expect(request).toHaveBeenCalledTimes(1);
  view.destroy();
});

it('F09 mobile refuses unverified receipts and never silently retries an uncertain result',async()=>{
  vi.stubGlobal('crypto',{randomUUID:()=>uuid});
  const request=vi.fn(async()=>({...success,sessionId:'foreign/path'}));
  const root=new Node(),view=mountManualMomentForm(root,{online:true,request});
  const c=controls(root);
  c.input.value='Instant critique';c.form.dispatch('submit');
  await vi.waitFor(()=>expect(c.status.textContent).toContain('incertain'));
  expect(c.button.disabled).toBe(true);expect(c.input.value).toBe('');
  c.form.dispatch('submit');expect(request).toHaveBeenCalledTimes(1);
  view.destroy();
});

it('F09 mobile rejects invalid or secret-bearing titles before networking',async()=>{
  vi.stubGlobal('crypto',{randomUUID:()=>uuid});
  const request=vi.fn();
  const root=new Node(),view=mountManualMomentForm(root,{online:true,request});
  const c=controls(root);
  for (const bad of ['', 'https://bad.example', 'Bearer SECRET_TOKEN', 'x'.repeat(121)]) {
    c.input.value=bad;c.form.dispatch('submit');
    expect(c.status.textContent).toContain('invalide');
  }
  expect(request).not.toHaveBeenCalled();
  view.destroy();
});

const confirmedStatus = {schemaVersion:1,kind:'streamcockpit-manual-marker-status',
  status:'confirmed',sessionId:'session_1',instant:1800000000000,sequence:1,source:'manual'};

it('F09 mobile reconciles uncertain committed marker using GET only, then permits a new distinct action',async()=>{
  vi.stubGlobal('crypto',{randomUUID:()=>uuid});
  const request=vi.fn(async(path:string)=>{
    if(path.endsWith('/manual/add'))throw new Error('lost POST response');
    return confirmedStatus;
  }),onRecorded=vi.fn();
  const root=new Node(),view=mountManualMomentForm(root,{online:true,request,onRecorded});
  const c=controls(root);
  c.input.value='Repère perdu';c.form.dispatch('submit');
  await vi.waitFor(()=>expect(c.status.textContent).toContain('incertain'));
  expect(c.button.disabled).toBe(true);
  expect(c.verify.hidden).toBe(false);
  expect(request).toHaveBeenCalledTimes(1);
  c.verify.dispatch('click');
  await vi.waitFor(()=>expect(c.status.textContent).toContain('retrouvé'));
  expect(request).toHaveBeenCalledTimes(2);
  expect(request).toHaveBeenNthCalledWith(2,'/api/v1/streamcockpit-moments/manual/status/'+uuid);
  expect(onRecorded).toHaveBeenCalledWith('session_1');
  expect(c.button.disabled).toBe(false);
  expect(c.verify.hidden).toBe(true);
  view.destroy();
});

it('F09 mobile not-found status remains uncertain and never retries POST',async()=>{
  vi.stubGlobal('crypto',{randomUUID:()=>uuid});
  const request=vi.fn(async(path:string)=>path.endsWith('/manual/add')
    ? Promise.reject(new Error('lost POST response'))
    : {schemaVersion:1,kind:'streamcockpit-manual-marker-status',status:'not_found_at_read'});
  const root=new Node(),view=mountManualMomentForm(root,{online:true,request});
  const c=controls(root);
  c.input.value='Sans reponse';c.form.dispatch('submit');
  await vi.waitFor(()=>expect(c.status.textContent).toContain('incertain'));
  c.verify.dispatch('click');
  await vi.waitFor(()=>expect(c.status.textContent).toContain('Aucun repère trouvé'));
  expect(c.button.disabled).toBe(true);
  expect(c.verify.hidden).toBe(false);
  expect(request).toHaveBeenCalledTimes(2);
  c.form.dispatch('submit');expect(request).toHaveBeenCalledTimes(2);
  view.destroy();
});

it('F09 late status never exposes a receipt after disconnection',async()=>{
  vi.stubGlobal('crypto',{randomUUID:()=>uuid});
  let resolveStatus!: (value:unknown)=>void;
  const request=vi.fn((path:string)=>path.endsWith('/manual/add')
    ? Promise.reject(new Error('lost response'))
    : new Promise(resolve=>{resolveStatus=resolve;})),onRecorded=vi.fn();
  const root=new Node(),view=mountManualMomentForm(root,{online:true,request,onRecorded});
  const c=controls(root);
  c.input.value='Secret';c.form.dispatch('submit');
  await vi.waitFor(()=>expect(c.verify.hidden).toBe(false));
  c.verify.dispatch('click');
  view.unavailable();
  resolveStatus(confirmedStatus);
  await Promise.resolve();await Promise.resolve();
  expect(onRecorded).not.toHaveBeenCalled();
  expect(c.verify.hidden).toBe(true);
  expect(c.button.disabled).toBe(true);
  expect(c.input.value).toBe('');
  view.destroy();
});
