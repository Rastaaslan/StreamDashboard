import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ControlService } from '../apps/server/src/control-service.js';
const now = () => new Date().toISOString();
const command = () => ({ id: 'stop_once_'+Math.random().toString(36).slice(2, 12), issuedAt: now(), action: 'live.stop' });
describe('Twitch-only live stop lag and idempotency', () => {
  it('waits for delayed Twitch API offline confirmation while sending OBS stop exactly once', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'sd-stop-'));
    try {
      let polls = 0;
      const output = vi.fn(async() => {});
      const control = await ControlService.open(path.join(dir,'control.json'), {
        live: vi.fn(async()=> ++polls >= 5 ? false : true), output,
        outputActive: () => false, metadata:vi.fn(), action:vi.fn(),
      },()=>{},async()=>{});
      const result = await control.execute(command());
      expect(result.status).toBe('succeeded');
      expect(result.platforms?.twitch?.status).toBe('succeeded');
      expect(polls).toBeGreaterThanOrEqual(5);
      expect(output).toHaveBeenCalledTimes(1);
      expect(output).toHaveBeenCalledWith('twitch',false,false);
      await control.stop();
    } finally { await rm(dir,{recursive:true,force:true}); }
  });
  it('reports OBS confirmed off but Twitch not yet confirmed without repeating side effects', async () => {
    const dir=await mkdtemp(path.join(os.tmpdir(),'sd-stop-'));
    try {
      const output=vi.fn(async()=>{});
      const control=await ControlService.open(path.join(dir,'control.json'),{
        live:vi.fn(async()=>true), output,
        outputActive:()=>false, metadata:vi.fn(), action:vi.fn(),
      },()=>{},async()=>{});
      const result=await control.execute(command());
      expect(result.status).toBe('uncertain');
      expect(result.platforms?.twitch?.message).toMatch(/Sortie OBS arrêtée et confirmée/);
      expect(output).toHaveBeenCalledTimes(1);
      await control.stop();
    } finally { await rm(dir,{recursive:true,force:true}); }
  });
});
