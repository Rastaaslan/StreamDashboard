import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {withContextFixture} from './helpers/streamcockpit-context-fixture.js';
it('F03/F07 paired HTTP + actual OBS WS: authenticated banks, explicit scene command, receipt and no replay',async()=>withContextFixture(async f=>{
 const read=await f.read();expect(read.status).toBe(200);expect(f.state().writes).toBe(0);
 expect(read.body).toMatchObject({role:'paired-controller',status:'known',scene:'Live',streamState:'offline',presentation:{bank:{id:'live'}}});
 expect(read.body.presentation.actions.find((a:any)=>a.id==='clip').available).toBe(false);
 const id=randomUUID(),result=await f.action('scene-pause',read.body.proof,id);
 expect(result.body.status).toBe('succeeded');expect(f.obs.state.scene).toBe('Pause');expect(f.state().writes).toBe(1);
 expect((await f.read()).body.presentation.bank.id).toBe('pause');
 await f.action('scene-pause',read.body.proof,id);expect(f.state().writes).toBe(1);
 expect((await f.action('timer',read.body.proof)).body.status).toBe('failed');expect(f.domain.timer.remaining).toBe(300);
}));
it.each(['scene','expired','configuration','other-actor'])('F03/F07 %s invalidates a context before any effect',async mode=>withContextFixture(async f=>{
 const before=await f.read();let token=f.paired.credential;
 if(mode==='scene'){f.setScene('Pause');await expect.poll(()=>f.obs.state.scene).toBe('Pause')}
 if(mode==='expired')f.expire();
 if(mode==='configuration'){const c=f.control.snapshot().configuration;c.actions.find((a:any)=>a.id==='timer').value='120';await f.control.configure(c,c.revision)}
 if(mode==='other-actor'){const invitation=f.auth.createPairing(undefined,false,['observe','obs','audio']);token=f.auth.pair(invitation.id,invitation.code,'second').credential}
 const result=await f.action('timer',before.body.proof,randomUUID(),token);expect(result.body.status).toBe('failed');expect(f.domain.timer.remaining).toBe(300);expect(f.state().writes).toBe(0);
}));
it.each(['scene','permission'])('F03/F07 rechecks %s inside the sole OBS queue after waiting',async mode=>withContextFixture(async f=>{
 const before=await f.read();let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(resolve=>{enter=resolve});
 const blocker=f.bus.observedObs(async()=>{enter();await new Promise<void>(resolve=>{release=resolve})});await entered;
 const request=f.action('scene-pause',before.body.proof);
 try{
  await expect.poll(()=>f.bus.hasPendingCommands&&f.control.hasPendingActions).toBe(true);
  // The request has entered ControlService; let its adapter enqueue behind the held OBS bus.
  await expect.poll(()=>f.bus.activityRevision).toBeGreaterThan(1);
  if(mode==='scene'){f.setScene('Pause');await expect.poll(()=>f.obs.state.scene).toBe('Pause')}
  else f.auth.setPermissions(f.paired.deviceId,['observe']);
 }finally{release()}
 await blocker;expect((await request).body.status).toBe('failed');expect(f.rpc.filter((r:any)=>r.type==='SetCurrentProgramScene')).toHaveLength(0);
}));
it('F03/F07 source loss stays UNKNOWN and a legacy manual action still uses its existing circuit',async()=>withContextFixture(async f=>{
 expect((await f.action('timer')).body.status).toBe('succeeded');expect(f.domain.timer.remaining).toBe(360);
 await f.obs.close();const read=await f.read();expect(read.body.status).toBe('unknown');expect(read.body.proof).toBeUndefined();
 expect(read.body.presentation.actions.every((a:any)=>a.available===false)).toBe(true);expect(f.state().writes).toBe(0);
}));

it('F03/F07 game bank uses the supplied provider observation only in a witnessed OBS live, with scene priority retained',async()=>withContextFixture(async f=>{
 f.setGame('Jeu de la fixture');f.setStreaming(true);await expect.poll(()=>f.obs.state.streaming).toBe(true);
 let read=await f.read();expect(read.body.presentation.bank).toMatchObject({id:'game',label:'Jeu · Jeu de la fixture'});expect(f.state().writes).toBe(0);
 f.setScene('Pause');await expect.poll(()=>f.obs.state.scene).toBe('Pause');read=await f.read();expect(read.body.presentation.bank.id).toBe('pause');
}));
