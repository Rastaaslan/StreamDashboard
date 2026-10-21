import {it,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {startDashboardServer} from '../apps/server/src/index.js';
import {planConfigurationCopy,runConfigurationCopy} from '../apps/mobile/shared/configuration-transfer.js';
import {resources} from '../apps/mobile/shared/autonomy.js';
it('real HTTP agents copy actions and profile with durable strict receipts, restart and guarded undo',async()=>{
 const roots=await Promise.all([0,1].map(()=>mkdtemp(path.join(tmpdir(),'sd-config-copy-'))));
 const start=(i:number)=>startDashboardServer({port:0,host:'127.0.0.1',obsEnabled:false,dataDir:roots[i],logger:{info(){},warn(){},error(){}}});
 const servers=await Promise.all([start(0),start(1)]);
 const request=async(i:number,body?:unknown)=>{const response=await fetch('http://127.0.0.1:'+servers[i].port+'/api/v2/autonomy'+(body?'/sync':''),{method:body?'POST':'GET',headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined});const value=await response.json();if(!response.ok)throw Error(JSON.stringify(value));return value;};
 try{
  const a=await request(0),original=await request(1),button={id:'copied-button',label:'Stop',type:'sound.stop',value:'',color:'red',shortcut:'Control+Alt+Shift+F10'};
  const added=await request(0,{workspace:a.workspace,edit:{id:'config_source_add',key:'action/'+button.id,base:null,value:button,strict:true}});expect(added.receipt.status,JSON.stringify(added.receipt)).toBe('applied');
  const source=await request(0),buttons=structuredClone(source.bundle.data.configuration.actions);
  [buttons[0].shortcut,buttons[1].shortcut]=[buttons[1].shortcut,buttons[0].shortcut];
  const swapped=await request(0,{workspace:a.workspace,edit:{id:'config_source_swap',key:'actionSet/root',base:{items:source.bundle.data.configuration.actions},value:{items:buttons},strict:true}});expect(swapped.receipt.status).toBe('applied');
  let job:any={id:'http_config_transfer',source:0,target:1,...planConfigurationCopy(await request(0),original)};
  // Isolate the deliberately changed action: fixture profiles can have random IDs.
  job.items=job.items.filter((item:any)=>item.key==='actionSet/root');
  let lost=true;
  const options={snapshot:request,save:async(next:any)=>{job=structuredClone(next);},apply:async(i:number,body:any)=>{const response=await request(i,body);if(lost){lost=false;throw Error('lost reply');}return response;}};
  await expect(runConfigurationCopy(job,options)).rejects.toThrow('lost reply');
  await servers[1].stop();servers[1]=await start(1);
  await runConfigurationCopy(job,options);expect(job.status).toBe('completed');
  expect(resources((await request(1)).bundle)['action/'+button.id]).toEqual(button);
  expect((await request(1)).bundle.data.configuration.actions.slice(0,2).map((action:any)=>action.shortcut)).toEqual(buttons.slice(0,2).map((action:any)=>action.shortcut));
  // Exact comparison refuses even an independent field change; ordinary sync
  // retains its existing three-way merge semantics.
  const changed=await request(1,{workspace:original.workspace,edit:{id:'config_external_change',key:'action/'+button.id,base:button,value:{...button,label:'Edited'},strict:true}});expect(changed.receipt.status).toBe('applied');
  await expect(runConfigurationCopy(job,options,true)).rejects.toThrow('Retour arrière');expect(resources((await request(1)).bundle)['action/'+button.id].label).toBe('Edited');
  const absent=await request(1,{workspace:original.workspace,statusOnly:true,edit:{id:'config_never_delivered',key:'action/new',base:null,value:{...button,id:'new'},strict:true}});expect(absent.receipt.status).toBe('absent');expect(resources((await request(1)).bundle)['action/new']).toBeUndefined();
  await expect(request(1,{workspace:'wrong',statusOnly:true,edit:{id:'config_never_delivered',key:'action/new',base:null,value:button,strict:true}})).rejects.toThrow('identité');
 }finally{await Promise.all(servers.map(s=>s.stop()));await Promise.all(roots.map(r=>rm(r,{recursive:true,force:true})));}
},30000);
