import {expect,it} from 'vitest';
import {ObservedAutoModQueue,parseAutomodNotification} from '../integrations/twitch/src/streamcockpit-automod-queue.js';

const hold=(broadcaster='42',id='held1',user='12')=>parseAutomodNotification({
  metadata:{message_type:'notification',subscription_type:'automod.message.hold',subscription_version:'2'},
  payload:{event:{broadcaster_user_id:broadcaster,message_id:id,user_id:user,user_name:'Private',
    reason:'automod',held_at:'2026-11-06T16:00:00Z',message:{text:'SECRET_NOT_FOR_HISTORY'}}},
})!;
const update=(broadcaster='42',id='held1')=>parseAutomodNotification({
  metadata:{message_type:'notification',subscription_type:'automod.message.update',subscription_version:'2'},
  payload:{event:{broadcaster_user_id:broadcaster,message_id:id,status:'denied'}},
})!;

it('F02 keeps only a short-lived observed viewer outcome over a same-account EventSub reconnect, never an actionable old hold',()=>{
  let clock=1000; const q=new ObservedAutoModQueue(()=>clock);
  q.connection('CONNECTED','42');expect(q.receive(hold())).toBe(true);
  clock+=1_000;expect(q.receive(update())).toBe(true);
  expect(q.viewerHistory('42','12',true).entries).toEqual([{status:'denied',observedAt:clock}]);
  q.connection('DISCONNECTED','42');
  expect(q.viewerHistory('42','12',true)).toMatchObject({status:'unavailable',entries:[]});
  q.connection('CONNECTED','42');
  expect(q.snapshot('42',true)).toMatchObject({messages:[],observedAt:null});
  const recalled=q.viewerHistory('42','12',true);
  expect(recalled.entries).toEqual([{status:'denied',observedAt:clock}]);
  expect(JSON.stringify(recalled)).not.toMatch(/Private|SECRET_NOT_FOR_HISTORY|held1/);
  q.connection('CONNECTED','43');
  expect(q.viewerHistory('43','12',true).entries).toHaveLength(0);
});

it('F02 stale same-account observations expire; unknown account or scope never exposes them',()=>{
  let clock=10_000;const q=new ObservedAutoModQueue(()=>clock);
  q.connection('CONNECTED','42');q.receive(hold());
  q.connection('DEGRADED','42');q.connection('CONNECTED','42');
  expect(q.viewerHistory('42','12',false).entries).toHaveLength(0);
  expect(q.viewerHistory('43','12',true).entries).toHaveLength(0);
  expect(q.viewerHistory('42','12',true).entries).toHaveLength(1);
  clock+=15*60*1000;
  expect(q.viewerHistory('42','12',true).entries).toHaveLength(0);
});

it('F02 account identity missing during a disconnect cannot leak history when another broadcaster reconnects',()=>{
  const q=new ObservedAutoModQueue(()=>1234);
  q.connection('CONNECTED','42');q.receive(hold());
  q.connection('DISCONNECTED','');
  expect(q.viewerHistory('42','12',true).entries).toHaveLength(0);
  q.connection('CONNECTED','43');
  expect(q.viewerHistory('43','12',true).entries).toHaveLength(0);
  expect(q.snapshot('43',true).messages).toHaveLength(0);
});
