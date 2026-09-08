import { describe, expect, it } from 'vitest'; import { DeadlineTimer } from '../src/timer/timer.js';
describe('DeadlineTimer',()=>{let now=1000;const timer=()=>new DeadlineTimer(()=>now);
it('starts from an absolute deadline and expires without becoming negative',()=>{const t=timer();t.start(300);expect(t.remaining).toBe(300);now+=301000;expect(t.remaining).toBe(0)});
it('pauses, resumes and resets',()=>{const t=timer();t.start(60);now+=10000;t.pause();expect(t.remaining).toBe(50);now+=20000;expect(t.remaining).toBe(50);t.resume();now+=1000;expect(t.remaining).toBe(49);t.reset();expect(t.remaining).toBe(60)});
it('adds positive and negative time, clamps at zero, and sets duration',()=>{const t=timer();t.start(60);t.add(60);expect(t.remaining).toBe(120);t.add(-999);expect(t.remaining).toBe(0);t.set(30);expect(t.remaining).toBe(30)});
it.each([0,-1,1.2,86401,NaN])('rejects invalid duration %s',value=>{expect(()=>timer().start(value)).toThrow()});
});
