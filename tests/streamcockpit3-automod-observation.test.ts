import {describe,it,expect} from 'vitest';
import {parseAutomodNotification,ObservedAutoModQueue} from '../integrations/twitch/src/streamcockpit-automod-queue.js';

const notify=(type:'automod.message.hold'|'automod.message.update',event:Record<string,unknown>)=>({
  metadata:{message_type:'notification',subscription_type:type,subscription_version:'2'},
  payload:{event:{broadcaster_user_id:'42',message_id:'message-one',...event}},
});
const hold=()=>notify('automod.message.hold',{
  user_id:'123',user_name:'Viewer',reason:'automod',held_at:'2026-11-03T15:00:00Z',
  message:{text:'Please review this message'},});
const update=(status='approved')=>notify('automod.message.update',{status});
describe('F02 EventSub AutoMod observations — never an authoritative full Twitch queue',()=>{
  it('parses v2 hold/update, not unrelated or malformed traffic',()=>{
    expect(parseAutomodNotification(hold())).toMatchObject({kind:'hold',message:{
      id:'message-one',broadcasterId:'42',userId:'123',text:'Please review this message'}});
    expect(parseAutomodNotification(update())).toEqual({kind:'update',broadcasterId:'42',id:'message-one',status:'approved'});
    expect(parseAutomodNotification({...hold(),metadata:{message_type:'notification',subscription_type:'automod.message.hold',subscription_version:'1'}})).toBeNull();
    expect(parseAutomodNotification(notify('automod.message.hold',{user_id:'bad',message:{text:'hello'}}))).toBeNull();
    expect(parseAutomodNotification(notify('automod.message.update',{status:'PENDING'}))).toBeNull();
    expect(parseAutomodNotification({metadata:{message_type:'session_welcome'}})).toBeNull();
  });
  it('does not expose an empty queue as verified Twitch truth',()=>{
    const q=new ObservedAutoModQueue(()=>1000);
    expect(q.snapshot('42',true)).toMatchObject({status:'unavailable',messages:[]});
    q.connection('CONNECTED','42');
    expect(q.snapshot('42',true)).toMatchObject({status:'partial-observation',observedAt:null,messages:[]});
    expect(q.snapshot('42',false)).toMatchObject({status:'unavailable',messages:[]});
  });
  it('allows only the observed broadcaster and clears on disconnect/account change',()=>{
    const q=new ObservedAutoModQueue(()=>1000);
    const notice=parseAutomodNotification(hold())!;
    expect(q.receive(notice)).toBe(false);
    q.connection('CONNECTED','42');
    expect(q.receive(notice)).toBe(true);
    expect(q.snapshot('42',true).messages).toHaveLength(1);
    expect(q.snapshot('43',true)).toMatchObject({status:'unavailable',messages:[]});
    q.connection('DEGRADED','42');
    expect(q.snapshot('42',true)).toMatchObject({status:'unavailable',messages:[]});
    q.connection('CONNECTED','43');
    expect(q.receive(notice)).toBe(false);
    expect(q.snapshot('43',true).messages).toHaveLength(0);
  });
  it('update notification removes message; late hold cannot resurrect it',()=>{
    const q=new ObservedAutoModQueue(()=>1000);q.connection('CONNECTED','42');
    expect(q.receive(parseAutomodNotification(update('denied'))!)).toBe(true);
    expect(q.receive(parseAutomodNotification(hold())!)).toBe(false);
    expect(q.snapshot('42',true).messages).toHaveLength(0);
    q.connection('DISCONNECTED','42');q.connection('CONNECTED','42');
    expect(q.receive(parseAutomodNotification(hold())!)).toBe(true);
    expect(q.snapshot('42',true).messages).toHaveLength(1);
    expect(q.receive(parseAutomodNotification(update())!)).toBe(true);
    expect(q.snapshot('42',true).messages).toHaveLength(0);
  });
  it('bounds message text, ids, user name and queue',()=>{
    const q=new ObservedAutoModQueue(()=>1000);q.connection('CONNECTED','42');
    for(let i=0;i<75;i++){
      const v=notify('automod.message.hold',{message_id:'held_'+i,user_id:'123',
        user_name:'A'.repeat(200),reason:'automod',held_at:'2026-11-03T15:00:00Z',message:{text:'B'.repeat(800)}});
      expect(q.receive(parseAutomodNotification(v)!)).toBe(true);
    }
    const items=q.snapshot('42',true).messages;
    expect(items).toHaveLength(50);
    expect(items[0]?.id).toBe('held_25');
    expect(items[49]?.text).toHaveLength(500);
    expect(items[49]?.userName).toHaveLength(100);
  });
  it('uses detached snapshot values and does not leak messages through a returned array',()=>{
    const q=new ObservedAutoModQueue(()=>1000);q.connection('CONNECTED','42');
    q.receive(parseAutomodNotification(hold())!);
    const v=q.snapshot('42',true).messages;
    v[0].text='tampered';
    v.push({...v[0],id:'fake'});
    expect(q.snapshot('42',true).messages).toMatchObject([{text:'Please review this message'}]);
  });
});
