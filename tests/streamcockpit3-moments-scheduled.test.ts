import { describe, expect, it } from 'vitest';
import type { CalendarItem } from '../packages/contracts/src/index.js';
import { ScheduledMomentBinding } from '../apps/server/src/streamcockpit-moments-scheduled.js';

const now = Date.parse('2030-01-01T20:00:00Z');
const event = (id = 'live_1', extra: Partial<CalendarItem> = {}): CalendarItem => ({
  id, title: 'Minecraft prévu', category: 'live', kind: 'LIVE',
  startAtUtc: new Date(now - 5 * 60_000).toISOString(),
  endAtUtc: new Date(now + 90 * 60_000).toISOString(), ...extra,
});
function observer(binding: ScheduledMomentBinding, options: {
  connected?: boolean; streamingKnown?: boolean; streaming?: boolean;
  connectionGeneration?: number; planning?: CalendarItem[]; observedAt?: number;
} = {}) {
  binding.observe({connected:true, streamingKnown:true, streaming:false,
    connectionGeneration:1, observedAt:now, ...options,
    planning:()=>options.planning ?? [event()]});
}

describe('F09 scheduled live only after real FIXE OBS start and explicit choice', () => {
  it('never guesses a scheduled session on startup already live or from time alone', () => {
    const tracker = new ScheduledMomentBinding();
    observer(tracker, {streaming:true});
    expect(tracker.snapshot()).toEqual({available:false,candidates:[],sessionId:undefined});
    expect(() => tracker.select('live_1')).toThrow('MOMENTS_SCHEDULE_NOT_VERIFIED');
    observer(tracker, {streaming:false});
    expect(tracker.snapshot().available).toBe(false);
    observer(tracker, {streaming:true});
    expect(tracker.snapshot()).toMatchObject({available:true,candidates:[{id:'live_1'}]});
    expect(tracker.activeSessionId()).toBeUndefined();
  });

  it('a paired explicit event selection binds an opaque stable ID and cannot switch mid-live', () => {
    const tracker = new ScheduledMomentBinding();
    observer(tracker);observer(tracker,{streaming:true,planning:[event('series::20300101'),event('other')]});
    expect(tracker.snapshot().candidates).toHaveLength(2);
    const sessionId=tracker.select('series::20300101');
    expect(sessionId).toMatch(/^scheduled_[a-f0-9]{64}$/);
    expect(sessionId).not.toContain('series');
    expect(tracker.activeSessionId()).toBe(sessionId);
    expect(tracker.select('series::20300101')).toBe(sessionId);
    expect(() => tracker.select('other')).toThrow('MOMENTS_SCHEDULE_ALREADY_BOUND');
    observer(tracker,{streaming:false});
    expect(tracker.activeSessionId()).toBeUndefined();
    expect(() => tracker.select('series::20300101')).toThrow('MOMENTS_SCHEDULE_NOT_VERIFIED');
  });

  it('disconnect, unknown observation and new OBS connection erase the binding, no restore by guessing', () => {
    const tracker=new ScheduledMomentBinding();
    observer(tracker);observer(tracker,{streaming:true});
    tracker.select('live_1');
    observer(tracker,{connected:false,streaming:true});
    expect(tracker.activeSessionId()).toBeUndefined();
    observer(tracker,{streaming:true,connectionGeneration:2});
    expect(tracker.snapshot().available).toBe(false);
    observer(tracker,{streaming:false,connectionGeneration:2});
    observer(tracker,{streaming:true,connectionGeneration:2});
    tracker.select('live_1');
    observer(tracker,{streaming:true,streamingKnown:false,connectionGeneration:2});
    expect(tracker.activeSessionId()).toBeUndefined();
  });

  it('freezes candidates at the OBS start: later planning edits cannot invent identities', () => {
    const tracker=new ScheduledMomentBinding();
    observer(tracker);
    observer(tracker,{streaming:true,planning:[event('soon',{startAtUtc:new Date(now+40*60_000).toISOString()}),event('draft',{draft:true}),event('valid')]});
    expect(tracker.snapshot().candidates).toHaveLength(1);
    expect(tracker.snapshot().candidates[0].id).toBe('valid');
    expect(() => tracker.select('draft')).toThrow('MOMENTS_SCHEDULE_NOT_VERIFIED');
    expect(() => tracker.select('soon')).toThrow('MOMENTS_SCHEDULE_NOT_VERIFIED');
    observer(tracker,{streaming:true,planning:[event('added_after_start')]});
    expect(() => tracker.select('added_after_start')).toThrow('MOMENTS_SCHEDULE_NOT_VERIFIED');
  });

  it('does not offer deleted or transferred calendar occurrences as live identities', () => {
    const tracker = new ScheduledMomentBinding();
    observer(tracker);
    observer(tracker, {streaming:true, planning:[
      event('pending_deletion', {deletionPending:true}),
      event('transferred', {transferredTo:'remote'}),
      event('transfer_intent', {transferId:'pending'}),
      event('retained'),
    ]});
    expect(tracker.snapshot().candidates.map(candidate => candidate.id)).toEqual(['retained']);
    for (const id of ['pending_deletion','transferred','transfer_intent'])
      expect(() => tracker.select(id)).toThrow('MOMENTS_SCHEDULE_NOT_VERIFIED');
  });

  it('refuses duplicated or excessive candidate lists rather than selecting an arbitrary event', () => {
    const duplicate=new ScheduledMomentBinding();
    observer(duplicate);observer(duplicate,{streaming:true,planning:[event('same'),event('same')]});
    expect(duplicate.snapshot()).toMatchObject({available:true,candidates:[]});
    const excessive=new ScheduledMomentBinding();
    observer(excessive);observer(excessive,{streaming:true,planning:Array.from({length:21},(_,i)=>event('live_'+i))});
    expect(excessive.snapshot().candidates).toHaveLength(0);
  });
});

it('F09 a broken calendar expansion fails closed without breaking OBS observation', () => {
  const tracker=new ScheduledMomentBinding();
  observer(tracker);
  expect(()=>tracker.observe({connected:true,streamingKnown:true,streaming:true,
    connectionGeneration:1,observedAt:now,planning:()=>{throw new Error('private calendar failure');}})).not.toThrow();
  expect(tracker.snapshot()).toEqual({available:false,candidates:[],sessionId:undefined});
  observer(tracker,{streaming:false});
  expect(()=>tracker.observe({connected:true,streamingKnown:true,streaming:true,
    connectionGeneration:1,observedAt:now,
    planning:()=>[null as unknown as CalendarItem]})).not.toThrow();
  expect(tracker.activeSessionId()).toBeUndefined();
});
