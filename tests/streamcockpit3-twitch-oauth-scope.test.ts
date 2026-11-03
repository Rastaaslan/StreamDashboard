import {expect,it,vi} from 'vitest';
import {TwitchClient,REQUESTED_SCOPES} from '../integrations/twitch/src/client.js';

it('real Device Code request includes the scopes used by integrated F02 and F08, without elevating existing tokens',async()=>{
  let requested:URLSearchParams|undefined;
  const transport=vi.fn(async(_url:unknown,init?:RequestInit)=>{
    requested=new URLSearchParams(String(init?.body));
    return Response.json({device_code:'fixture-private',user_code:'CODE',verification_uri:'https://www.twitch.tv/activate',expires_in:60,interval:1});
  });
  const client=new TwitchClient({clientId:'fixture',accessToken:'',refreshToken:'',broadcasterId:'',userName:'',displayName:''},undefined,transport as typeof fetch);
  try{
    await client.startDeviceAuthorization();
    const scopes=requested!.get('scopes')!.split(' ');
    expect(new Set(scopes).size).toBe(scopes.length);
    for(const scope of ['channel:manage:polls','channel:manage:predictions','channel:manage:raids','moderator:manage:shoutouts','moderator:manage:shield_mode','moderator:manage:automod_settings','moderator:manage:automod'])
      expect(scopes).toContain(scope);
    expect(scopes).toEqual([...REQUESTED_SCOPES]);
    expect(client.controlCapabilities().createClip).toBe(false);
    expect(JSON.stringify(client.state)).not.toContain('fixture-private');
  }finally{client.close()}
});
