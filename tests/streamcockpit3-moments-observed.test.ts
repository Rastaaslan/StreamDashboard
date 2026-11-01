import { expect, it } from 'vitest';
import { MomentsPipeline, type MomentsStorage } from '../apps/server/src/streamcockpit-moments.js';
import type { MomentInput } from '../packages/core/src/streamcockpit-moments.js';

class Memory implements MomentsStorage {
  data: string | null = null;
  async read() { return this.data; }
  async compareAndSwap(expected: string | null, replacement: string) {
    if (expected !== this.data) return false;
    this.data = replacement;
    return true;
  }
}
const marker: MomentInput = { sessionId: 'live_01', correlationId: 'manual_01',
  source: 'manual', instant: 1720000000000, title: 'Moments fixture',
  status: 'observed' };

it('F09 distinguishes no durable journal from an observed empty session', async () => {
  const storage = new Memory();
  const pipeline = new MomentsPipeline(storage);
  expect(await pipeline.exportObserved('live_01')).toBeUndefined();
  await pipeline.record(marker);
  const observed = await pipeline.exportObserved('live_01');
  expect(observed?.markers).toHaveLength(1);
  expect(observed?.markers[0]?.title).toBe('Moments fixture');
  expect((await pipeline.exportObserved('some_other_session'))?.markers).toEqual([]);
});

it('F09 fails closed on corrupt journal and never writes during read', async () => {
  const storage = new Memory();
  const pipeline = new MomentsPipeline(storage);
  storage.data = '{"payload":"fake","sha256":"invalid"}';
  const before = storage.data;
  await expect(pipeline.exportObserved('live_01')).rejects.toThrow('CORRUPT_MOMENTS');
  expect(storage.data).toBe(before);
});

it('F09 exports immutable snapshots and validates session ID before exposing data', async () => {
  const storage = new Memory();
  const pipeline = new MomentsPipeline(storage);
  await pipeline.record(marker);
  const first = await pipeline.exportObserved('live_01');
  if (!first) throw Error('unexpected missing journal');
  first.markers[0].title = 'altered client state';
  const again = await pipeline.exportObserved('live_01');
  expect(again?.markers[0]?.title).toBe('Moments fixture');
  await expect(pipeline.exportObserved('../secrets')).rejects.toThrow('INVALID_MOMENT');
});
