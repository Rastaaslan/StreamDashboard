import { describe, expect, it, vi } from 'vitest';
import { createDjiRelayPublisher } from '../apps/mobile/control/dji-relay-publisher.js';

describe('DJI telemetry publishing over already authenticated dashboard link', () => {
  it('never publishes without an active trusted dashboard selection', async () => {
    const localRead=vi.fn(async()=>({status:'ok'}));
    const remoteWrite=vi.fn(async()=>({ok:true}));
    const publisher=createDjiRelayPublisher({localRead,remoteWrite,canPublish:()=>false});
    expect(await publisher.tick()).toBe(false);
    expect(localRead).not.toHaveBeenCalled();
    publisher.destroy();
  });
  it('publishes read-only battery state at most once per cadence', async () => {
    let at=120_000;
    const packet={status:'ok',observedAt:new Date().toISOString()};
    const localRead=vi.fn(async()=>packet);
    const remoteWrite=vi.fn(async()=>({ok:true}));
    const publisher=createDjiRelayPublisher({localRead,remoteWrite,canPublish:()=>true,now:()=>at,intervalMs:30_000});
    expect(await publisher.tick()).toBe(true);
    expect(await publisher.tick()).toBe(false);
    at+=35_000;
    expect(await publisher.tick()).toBe(true);
    expect(remoteWrite).toHaveBeenCalledTimes(2);
    expect(remoteWrite).toHaveBeenCalledWith(packet);
    publisher.destroy();
  });
  it('stops publishing if pairing goes offline while the USB read is pending', async () => {
    let online=true;
    let resolveRead!: (measurement:any)=>void;
    const localRead=vi.fn(()=>new Promise<any>(resolve=>{resolveRead=resolve;}));
    const remoteWrite=vi.fn(async()=>true);
    const publisher=createDjiRelayPublisher({localRead,remoteWrite,canPublish:()=>online});
    const tick=publisher.tick();
    await Promise.resolve();
    online=false;
    resolveRead({status:'ok'});
    expect(await tick).toBe(false);
    expect(remoteWrite).not.toHaveBeenCalled();
    publisher.destroy();
  });
  it('publishes unavailable state to clear stale battery readings after RX unplug', async () => {
    const remoteWrite=vi.fn(async()=>true);
    const publisher=createDjiRelayPublisher({
      localRead:async()=>({status:'unavailable',reason:'receiver-unavailable'}),
      remoteWrite,canPublish:()=>true,
    });
    expect(await publisher.tick()).toBe(true);
    expect(remoteWrite).toHaveBeenCalledWith({status:'unavailable',reason:'receiver-unavailable'});
    publisher.destroy();
  });
});
