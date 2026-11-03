import {it,expect,vi} from 'vitest';
import {TwitchClient} from '../integrations/twitch/src/client.js';

function fixture(mode:'ok'|'update-denied'|'no-scope'='ok'){
  const requests:any[]=[];
  const fetchApi=vi.fn(async(input:unknown,init?:RequestInit)=>{
    const url=String(input);
    if(url.endsWith('/validate'))return Response.json({
      client_id:'client',user_id:'42',scopes:mode==='no-scope'?[]:['moderator:manage:automod'],expires_in:3600,
    });
    if(url.endsWith('/eventsub/subscriptions')){
      const body=JSON.parse(String(init?.body));
      requests.push(body);
      if(mode==='update-denied'&&body.type==='automod.message.update')return Response.json({message:'forbidden'}, {status:403});
      return Response.json({data:[{id:'eventsub-subscription'}]}, {status:202});
    }
    throw Error('Unexpected transport');
  });
  const client=new TwitchClient({clientId:'client',accessToken:'PRIVATE',refreshToken:'',broadcasterId:'42',
    userName:'streamer',displayName:'Streamer'},async()=>undefined,fetchApi as typeof fetch);
  return {client,requests};
}
it('F02 AutoMod V2 subscriptions use exact broadcaster/moderator and existing scope',async()=>{
  const f=fixture();
  expect(await f.client.validateSession()).toBe(true);
  expect(f.client.automodEventSubRequested()).toBe(true);
  expect(await f.client.subscribeEventSub('session_test')).toEqual({automodSubscribed:true});
  expect(f.requests).toEqual(['automod.message.hold','automod.message.update'].map(type=>({
    type,version:'2',condition:{broadcaster_user_id:'42',moderator_user_id:'42'},
    transport:{method:'websocket',session_id:'session_test'},
  })));
});
it('F02 missing AutoMod scope cannot attempt subscription',async()=>{
  const f=fixture('no-scope');expect(await f.client.validateSession()).toBe(true);
  expect(await f.client.subscribeEventSub('session_test')).toEqual({automodSubscribed:false});
  expect(f.requests).toEqual([]);
});
it('F02 failed optional AutoMod update subscription stays unavailable without crashing chat',async()=>{
  const f=fixture('update-denied');expect(await f.client.validateSession()).toBe(true);
  expect(await f.client.subscribeEventSub('session_test')).toEqual({automodSubscribed:false});
  expect(f.requests).toHaveLength(2);
});
