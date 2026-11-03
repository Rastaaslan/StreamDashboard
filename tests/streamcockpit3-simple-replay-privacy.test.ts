import {it,expect} from 'vitest';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ControlService,type ControlAdapter} from '../apps/server/src/control-service.js';
import {publicControlReceipt,publicControlSnapshot} from '../apps/server/src/control-public-view.js';
it('F04 projects current and recovered replay receipts without leaking host paths or changing durable evidence',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'sc3-replay-public-')),file=join(dir,'control.json'),path='C:/Users/private-person/Videos/replay.mkv';
  const adapter:ControlAdapter={live:async()=>false,output:async()=>{},metadata:async()=>{},action:async()=>({message:'Saved '+path,replayPath:path})};
  let control=await ControlService.open(file,adapter);
  try{
    const receipt=await control.execute({id:'sc3-replay-fixture',action:'replay.save',issuedAt:new Date().toISOString()});
    expect(receipt.status).toBe('succeeded');expect(receipt.result?.replayPath).toBe(path);
    expect(JSON.stringify(publicControlReceipt(receipt))).not.toContain('private-person');
    await control.stop();control=await ControlService.open(file,adapter);
    const before=await readFile(file,'utf8'),view=publicControlSnapshot(control.snapshot());
    expect(JSON.stringify(view)).not.toContain(path);expect(JSON.stringify(view)).not.toContain('private-person');
    expect(await readFile(file,'utf8')).toBe(before);expect(control.snapshot().receipts[0].result?.replayPath).toBe(path);
  }finally{await control.stop();await rm(dir,{recursive:true,force:true})}
});
