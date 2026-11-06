import {expect,it} from 'vitest';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {startDashboardServer} from '../apps/server/src/index.js';

it('keeps the maintenance observation capability private to native main and rejects a controller-only runtime',async()=>{
 const root=await mkdtemp(join(tmpdir(),'sc3-private-maintenance-runtime-'));
 const server=await startDashboardServer({port:0,dataDir:root,obsEnabled:false,timerAuthority:false,remoteEnabled:false,
  logger:{info(){},warn(){},error(){}}});
 try{
  expect(server.maintenanceObservationConfiguration).toBeTypeOf('function');
  await expect(server.maintenanceObservationConfiguration!()).rejects.toThrow('MAINTENANCE_AUTHORITY_UNAVAILABLE');
  const response=await fetch(server.url+'/api/diagnostics');expect(response.status).toBe(200);
  const publicBody=await response.text();expect(publicBody).not.toContain('maintenanceObservationConfiguration');
  expect(JSON.stringify(server.state())).not.toContain('maintenanceObservationConfiguration');
  for(const endpoint of ['/api/v1/maintenance/observation','/api/v1/maintenanceObservationConfiguration']){
   const result=await fetch(server.url+endpoint);expect(result.ok).toBe(false);
  }
 }finally{await server.stop();await rm(root,{recursive:true,force:true})}
});
it('does not wire the native observation capability to any renderer or public route',async()=>{
 const server=await readFile(new URL('../apps/server/src/index.ts',import.meta.url),'utf8');
 const preload=await readFile(new URL('../apps/desktop/src/preload.cts',import.meta.url),'utf8');
 expect(server.match(/maintenanceObservationConfiguration/g)).toHaveLength(2); // type + native handle implementation only
 expect(preload).not.toContain('maintenanceObservationConfiguration');
 expect(preload).not.toContain('runMaintenanceEnvelope');
});
