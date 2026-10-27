import {expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {startDashboardServer} from '../apps/server/src/index.js';
import {isManagementApiAllowed,isRemoteApiAllowed,requiredDevicePermissions} from '../apps/server/src/remote-api-policy.js';

it('two HTTP agents export and import real bytes and metadata without playback; retry and restart preserve one identity',async()=>{
 const roots=await Promise.all([0,1].map(()=>mkdtemp(path.join(tmpdir(),'sd-audio-copy-'))));
 const start=(i:number)=>startDashboardServer({port:0,host:'127.0.0.1',obsEnabled:false,dataDir:roots[i],logger:{info(){},warn(){},error(){}}});
 const servers=await Promise.all([start(0),start(1)]),data=Buffer.from('audio-fixture');
 const sound={name:'Musique',category:'Favoris',enabled:false,favorite:true,volume:0.4,cooldownMs:300,monitoringMode:'monitor',playbackMode:'mix'};
 const request=async(i:number,route:string,body?:unknown,binary=false)=>{const res=await fetch('http://127.0.0.1:'+servers[i].port+route,{method:body===undefined?'GET':'POST',headers:{'content-type':binary?'application/octet-stream':'application/json'},body:body===undefined?undefined:binary?new Uint8Array(body as Buffer):JSON.stringify(body)});const value=await res.json();if(!res.ok)throw Error(JSON.stringify(value));return value;};
 try{
  const [a,b]=await Promise.all([0,1].map(i=>request(i,'/api/v2/autonomy')));
  const upload=(i:number,workspace:string,settings=sound)=>request(i,'/api/v2/sounds/upload?id=old:1&name=Musique&extension=wav&transfer=copy_http_fixture&workspace='+workspace+'&settings='+encodeURIComponent(JSON.stringify(settings)),data,true);
  await expect(upload(0,'wrong')).rejects.toThrow('espace');await upload(0,a.workspace);
  const exported=await request(0,'/api/v2/sounds/export',{operation:'open',workspace:a.workspace,soundId:'old:1',settings:sound});expect(exported.settings).toEqual(sound);expect(exported.sha256).toBe(createHash('sha256').update(data).digest('hex'));expect(exported).not.toHaveProperty('source');
  const chunk=await request(0,'/api/v2/sounds/export',{operation:'read',workspace:a.workspace,id:exported.id,offset:0});expect(Buffer.from(chunk.chunk,'base64')).toEqual(data);
  await upload(1,b.workspace);await servers[1].stop();servers[1]=await start(1);await upload(1,b.workspace);
  await expect(upload(1,b.workspace,{...sound,volume:0.7})).rejects.toThrow('autre contenu');
  const target=await request(1,'/api/v2/autonomy');expect(target.bundle.sounds.sounds).toHaveLength(1);expect(target.bundle.sounds.sounds[0]).toEqual({id:'old:1',...sound,outputId:'device-default'});expect((await request(1,'/api/v1/soundboard')).currentPlayback).toBeNull();
  const reverse=await request(1,'/api/v2/sounds/export',{operation:'open',workspace:b.workspace,soundId:'old:1',settings:sound});expect(reverse.sha256).toBe(exported.sha256);
  await request(1,'/api/v2/sounds/export',{operation:'close',workspace:b.workspace,id:reverse.id});await request(0,'/api/v2/sounds/export',{operation:'close',workspace:a.workspace,id:exported.id});
  const removed=await request(1,'/api/v2/autonomy/sync',{workspace:b.workspace,edit:{id:'delete_audio_fixture',key:'sound/old:1',base:{...sound,outputId:'device-default'},value:null}});expect(removed.receipt.status).toBe('applied');
  await servers[1].stop();servers[1]=await start(1);await expect(upload(1,b.workspace)).rejects.toThrow('retiré');expect((await request(1,'/api/v2/autonomy')).bundle.sounds.sounds).toHaveLength(0);
 }finally{await Promise.all(servers.map(s=>s.stop()));await Promise.all(roots.map(r=>rm(r,{recursive:true,force:true})));}
 expect(isManagementApiAllowed('POST','/v2/sounds/export')).toBe(true);expect(isRemoteApiAllowed('POST','/v2/sounds/export')).toBe(false);expect(requiredDevicePermissions('POST','/v2/sounds/export',{})).toEqual(['configuration','audio']);
},30000);
