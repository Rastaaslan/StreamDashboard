import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { YouTubeApiError, YouTubeClient, YouTubeMetadataVerificationError } from '../integrations/youtube/src/client.js';
import { ControlService, type ControlAdapter } from '../apps/server/src/control-service.js';
import type { SecretStore } from '../apps/server/src/storage.js';

const directories: string[] = [];
const controls: ControlService[] = [];
afterEach(async () => {
  for (const control of controls.splice(0)) await control.stop();
  for (const directory of directories.splice(0)) await rm(directory, {recursive:true, force:true});
});
const configuration = {clientId:'client-test', channelId:'channel-test', broadcastId:'selected-live'};
const json = (value:unknown, status=200) => new Response(JSON.stringify(value), {status, headers:{'Content-Type':'application/json'}});
const broadcast = (status='ready', id='selected-live', scheduledStartTime?:string) => ({
  id,
  snippet:{title:'Prepared stream', channelId:'channel-test', ...(scheduledStartTime ? {scheduledStartTime} : {})},
  status:{lifeCycleStatus:status},
  contentDetails:{boundStreamId:'linked-stream'}
});
function fixture(
  respond:(url:URL, init:RequestInit)=>Response|Promise<Response>,
  options:{clientId?:string; expired?:boolean; configuration?:()=>typeof configuration}={}
) {
  const calls:Array<{url:URL; init:RequestInit}>=[];
  let tokens:Record<string,string> = {
    clientId:options.clientId ?? configuration.clientId,
    accessToken:'TEST_ACCESS_TOKEN_PRIVATE',
    refreshToken:'TEST_REFRESH_TOKEN_PRIVATE',
    expiresAt:String(Date.now() + (options.expired ? -1 : 3_600_000))
  };
  const secrets = {
    getYouTubeTokens:async()=>tokens,
    setYouTubeTokens:async(value:Record<string,string>)=>{tokens=value;},
    getGoogleClientSecret:async()=>'TEST_CLIENT_SECRET_PRIVATE'
  } as unknown as SecretStore;
  const transport:typeof fetch = async (input, init={}) => {
    const url=new URL(input instanceof Request ? input.url : String(input));
    calls.push({url,init});
    return respond(url,init);
  };
  return {client:new YouTubeClient(secrets,options.configuration??(()=>({...configuration})),transport),calls};
}
async function controller(client:YouTubeClient) {
  const directory=await mkdtemp(path.join(os.tmpdir(),'sd-youtube-reliability-'));
  directories.push(directory);
  const adapter:ControlAdapter = {
    live:vi.fn(async()=>client.live()),
    output:vi.fn(async()=>{}),
    settle:vi.fn(async(_platform,start,requestId)=>client.transition(start,requestId)),
    metadata:vi.fn(async()=>{}),
    action:vi.fn(async()=>{})
  };
  const file=path.join(directory,'control.json');
  const control=await ControlService.open(file,adapter,()=>{},async()=>{});
  controls.push(control);
  return {control,adapter,file};
}
const start = (id='youtube_start_001') => ({id,action:'live.start',platform:'youtube' as const,issuedAt:new Date().toISOString()});

describe('YouTube metadata confirmation and read-only diagnosis',()=>{
  const requested={title:'Spooktober',description:"Jeu d'horreur en cours !",youtubeCategoryId:'20',twitchGameId:'',tags:['DeadIsland2','Action','Horror','zombie','chill','fun','gaming','Halloween','survie']};
  const snippet=(overrides:Record<string,unknown>={})=>({title:requested.title,description:requested.description,categoryId:requested.youtubeCategoryId,channelId:configuration.channelId,tags:[...requested.tags],...overrides});
  function updateFixture(observed:Record<string,unknown>|null){
    let reads=0;
    return fixture((url,init)=>{
      if(url.pathname.endsWith('/liveBroadcasts'))return json({items:[broadcast()]});
      expect(url.pathname).toBe('/youtube/v3/videos');
      if(init.method==='PUT')return json({id:configuration.broadcastId,snippet:snippet()});
      expect(url.searchParams.get('id')).toBe(configuration.broadcastId);
      const value=++reads===1?snippet({defaultLanguage:'fr',defaultAudioLanguage:'fr'}):observed;
      return json({items:value?[{id:configuration.broadcastId,snippet:value}]:[]});
    });
  }
  it('confirms a permutation of exactly the requested tags and preserves languages without mutating the request',async()=>{
    const input=structuredClone(requested),before=structuredClone(input);
    const {client,calls}=updateFixture(snippet({tags:[...requested.tags].reverse()}));
    await expect(client.update(input)).resolves.toBeUndefined();
    expect(input).toEqual(before);
    const writes=calls.filter(({init})=>init.method==='PUT');
    expect(writes).toHaveLength(1);
    expect(JSON.parse(String(writes[0].init.body))).toEqual({id:configuration.broadcastId,snippet:{title:requested.title,description:requested.description,categoryId:'20',tags:requested.tags,defaultLanguage:'fr',defaultAudioLanguage:'fr'}});
    expect(calls).toHaveLength(4);
  });
  it.each([
    ['title','titre',{title:'PRIVATE_PROVIDER_VALUE'}],
    ['description','description',{description:requested.description+' '}],
    ['categoryId','catégorie YouTube',{categoryId:'27'}],
    ['tags','tags',{tags:requested.tags.slice(1)}],
  ])('identifies the divergent %s field without exposing its values or repeating the write',async(field,label,overrides)=>{
    const {client,calls}=updateFixture(snippet(overrides as Record<string,unknown>));
    const error=await client.update(requested).catch((value:unknown)=>value);
    expect(error).toBeInstanceOf(YouTubeMetadataVerificationError);
    expect(error).toMatchObject({fields:[field]});
    expect(String(error)).toContain(String(label));
    expect(String(error)).not.toContain('PRIVATE_PROVIDER_VALUE');
    expect(String(error)).not.toContain('TEST_ACCESS_TOKEN_PRIVATE');
    expect(calls.filter(({init})=>init.method==='PUT')).toHaveLength(1);
    expect(calls).toHaveLength(4);
  });
  it.each([
    ['case',requested.tags.map(tag=>tag.toLowerCase())],
    ['additional tag',[...requested.tags,'extra']],
    ['duplicate replacing a tag',[requested.tags[1],...requested.tags.slice(1)]],
  ])('rejects changed tag content (%s) even when the other fields match',async(_label,tags)=>{
    const {client}=updateFixture(snippet({tags}));
    await expect(client.update(requested)).rejects.toMatchObject({fields:['tags']});
  });
  it('reports all unconfirmed fields when the verification returns no video',async()=>{
    const {client}=updateFixture(null);
    await expect(client.update(requested)).rejects.toMatchObject({fields:['title','description','categoryId','tags']});
  });
  it('reads only the selected broadcast public fields through GETs and ignores extra provider data',async()=>{
    const observed=snippet({defaultLanguage:'fr',access_token:'PRIVATE_EXTRA_FIELD',raw:{secret:'PRIVATE_EXTRA_FIELD'}});
    const {client,calls}=fixture(url=>url.pathname.endsWith('/liveBroadcasts')
      ?json({items:[{...broadcast(),access_token:'PRIVATE_EXTRA_FIELD'}]})
      :json({items:[{id:configuration.broadcastId,snippet:observed,raw:{secret:'PRIVATE_EXTRA_FIELD'}}],access_token:'PRIVATE_EXTRA_FIELD'}));
    const value=await client.readMetadata();
    expect(value).toEqual({broadcastId:configuration.broadcastId,channelId:configuration.channelId,title:requested.title,description:requested.description,youtubeCategoryId:'20',tags:requested.tags});
    expect(JSON.stringify(value)).not.toContain('PRIVATE_EXTRA_FIELD');
    expect(JSON.stringify(value)).not.toContain('TEST_ACCESS_TOKEN_PRIVATE');
    expect(calls).toHaveLength(2);
    expect(calls.every(({init})=>init.method===undefined||init.method==='GET')).toBe(true);
    expect(calls.every(({init})=>init.body===undefined)).toBe(true);
    expect(calls.map(({url})=>[url.pathname,url.searchParams.get('id')])).toEqual([
      ['/youtube/v3/liveBroadcasts',configuration.broadcastId],['/youtube/v3/videos',configuration.broadcastId]
    ]);
  });
  it('reads absent tags as an empty list without inventing other metadata',async()=>{
    const {client}=fixture(url=>url.pathname.endsWith('/liveBroadcasts')?json({items:[broadcast()]}):json({items:[{id:configuration.broadcastId,snippet:snippet({tags:undefined})}]}));
    expect(await client.readMetadata()).toMatchObject({title:requested.title,description:requested.description,youtubeCategoryId:'20',tags:[]});
  });
  it.each([
    {id:'other-video',snippet:snippet()},
    {id:configuration.broadcastId,snippet:snippet({channelId:'other-channel'})},
  ])('does not return a video from another target or channel',async video=>{
    const {client,calls}=fixture(url=>url.pathname.endsWith('/liveBroadcasts')?json({items:[broadcast()]}):json({items:[video]}));
    await expect(client.readMetadata()).rejects.toThrow('Vidéo YouTube introuvable sur la chaîne sélectionnée');
    expect(calls.every(({init})=>init.method===undefined||init.method==='GET')).toBe(true);
  });
  it('ignores metadata returned after the configured target has changed',async()=>{
    let selected={...configuration};
    const {client,calls}=fixture(url=>{
      if(url.pathname.endsWith('/liveBroadcasts'))return json({items:[broadcast()]});
      selected={...selected,broadcastId:'new-selection'};
      return json({items:[{id:configuration.broadcastId,snippet:snippet()}]});
    },{configuration:()=>({...selected})});
    await expect(client.readMetadata()).rejects.toThrow('La cible YouTube a changé pendant la lecture');
    expect(calls).toHaveLength(2);
  });
});

describe('YouTube discovery and safe diagnostics',()=>{
  it('finds prepared broadcasts beyond completed first-page events and preserves their date',async()=>{
    const scheduled='2027-02-14T18:00:00Z';
    const {client,calls}=fixture(url=>{
      const token=url.searchParams.get('pageToken');
      if(!token)return json({items:Array.from({length:50},(_,i)=>broadcast('complete','past-'+i)),nextPageToken:'next/+ token'});
      expect(token).toBe('next/+ token');
      return json({items:[broadcast('ready','prepared',scheduled),broadcast('created','undated'),broadcast('revoked','revoked')]});
    });
    expect(await client.broadcasts()).toEqual([
      {id:'prepared',title:'Prepared stream',channelId:'channel-test',status:'ready',bound:true,scheduledStartTime:scheduled},
      {id:'undated',title:'Prepared stream',channelId:'channel-test',status:'created',bound:true,scheduledStartTime:null}
    ]);
    expect(calls).toHaveLength(2);
    for(const {url} of calls){
      expect(url.pathname).toBe('/youtube/v3/liveBroadcasts');
      expect(url.searchParams.get('mine')).toBe('true');
      expect(url.searchParams.get('broadcastType')).toBe('all');
      expect(url.searchParams.get('maxResults')).toBe('50');
      expect(url.searchParams.has('broadcastStatus')).toBe(false);
    }
  });
  it('fails explicitly on repeating pagination instead of silently truncating or looping',async()=>{
    const {client,calls}=fixture(()=>json({items:[],nextPageToken:'repeated'}));
    await expect(client.broadcasts()).rejects.toMatchObject({name:'YouTubeApiError',reason:'invalidPagination'});
    expect(calls).toHaveLength(2);
  });
  it('returns the authorized channel identity, including pagination and deduplication',async()=>{
    const {client,calls}=fixture(url=>url.searchParams.has('pageToken')
      ? json({items:[{id:'channel-1',snippet:{title:'First',customUrl:'@first'}},{id:'channel-2',snippet:{title:'Second'}}]})
      : json({items:[{id:'channel-1',snippet:{title:'First',customUrl:'@first'}}],nextPageToken:'second'}));
    expect(await client.authorizedChannels()).toEqual([{id:'channel-1',title:'First',customUrl:'@first'},{id:'channel-2',title:'Second'}]);
    expect(calls.every(({url})=>url.pathname==='/youtube/v3/channels'&&url.searchParams.get('mine')==='true'&&url.searchParams.get('part')==='id,snippet')).toBe(true);
  });
  it('does not advertise or use a token authorized for a different OAuth client',async()=>{
    const {client,calls}=fixture(()=>{throw new Error('Network must not be reached');},{clientId:'other-client'});
    expect(await client.status()).toMatchObject({configured:true,connected:false});
    await expect(client.broadcasts()).rejects.toThrow('Connectez YouTube');
    expect(calls).toHaveLength(0);
  });
  it.each(['quotaExceeded','insufficientPermissions','liveStreamingNotEnabled','invalidTransition'])('keeps the useful %s reason without leaking provider payloads',async reason=>{
    const privateText='PROVIDER_MESSAGE_WITH_TEST_ACCESS_TOKEN_PRIVATE';
    const {client}=fixture(()=>json({error:{message:privateText,errors:[{reason,message:privateText}]}},403));
    const error=await client.broadcasts().catch((value:unknown)=>value);
    expect(error).toBeInstanceOf(YouTubeApiError);
    expect(error).toMatchObject({httpStatus:403,reason});
    expect(String(error)).not.toContain(privateText);
    expect(String(error)).not.toContain('TEST_ACCESS_TOKEN_PRIVATE');
  });
  it('sanitizes OAuth token errors and network exceptions',async()=>{
    const expired=fixture(()=>json({error:'invalid_client',error_description:'TEST_CLIENT_SECRET_PRIVATE'},400),{expired:true});
    const tokenError=await expired.client.broadcasts().catch((value:unknown)=>value);
    expect(tokenError).toMatchObject({httpStatus:400,reason:'invalid_client'});
    expect(String(tokenError)).not.toContain('TEST_CLIENT_SECRET_PRIVATE');
    const offline=fixture(()=>{throw new Error('TEST_ACCESS_TOKEN_PRIVATE in raw fetch error');});
    const networkError=await offline.client.broadcasts().catch((value:unknown)=>value);
    expect(networkError).toMatchObject({httpStatus:0,reason:'networkError'});
    expect(String(networkError)).not.toContain('TEST_ACCESS_TOKEN_PRIVATE');
  });
});

describe('YouTube signal and broadcast diagnosis',()=>{
  it('reports active ingestion separately from a prepared broadcast, without exposing ingestion credentials',async()=>{
    const {client,calls}=fixture(url=>url.pathname.endsWith('/liveStreams')
      ? json({items:[{status:{streamStatus:'active'},cdn:{ingestionInfo:{streamName:'PRIVATE_RTMP_KEY',ingestionAddress:'PRIVATE_RTMP_ADDRESS'}}}]})
      : json({items:[broadcast('ready')]}));
    const state=await client.broadcastState();
    expect(state).toEqual({id:'selected-live',channelId:'channel-test',broadcastState:'ready',live:false,bound:true,ingestionStatus:'active',observedAt:expect.any(String)});
    expect(Number.isFinite(Date.parse(state.observedAt))).toBe(true);
    expect(JSON.stringify(state)).not.toContain('PRIVATE_RTMP');
    expect(calls).toHaveLength(2);
    expect(calls[1].url.searchParams.get('part')).toBe('status');
    expect(calls[1].url.searchParams.get('id')).toBe('linked-stream');
  });
  it('leaves unbound ingestion unknown and preserves the exact transitional broadcast state',async()=>{
    const {client,calls}=fixture(()=>json({items:[{...broadcast('liveStarting'),contentDetails:{}}]}));
    expect(await client.broadcastState()).toMatchObject({broadcastState:'liveStarting',live:false,bound:false,ingestionStatus:null});
    expect(calls).toHaveLength(1);
  });
  it('surfaces a failed ingestion observation as a safe API error instead of inventing an inactive signal',async()=>{
    const {client}=fixture(url=>url.pathname.endsWith('/liveStreams')
      ? json({error:{message:'PRIVATE_PROVIDER_DETAILS',errors:[{reason:'quotaExceeded'}]}},403)
      : json({items:[broadcast('ready')]}));
    const error=await client.broadcastState().catch((value:unknown)=>value);
    expect(error).toMatchObject({name:'YouTubeApiError',reason:'quotaExceeded',httpStatus:403});
    expect(String(error)).not.toContain('PRIVATE_PROVIDER_DETAILS');
  });
});

describe('YouTube transitions and durable command confirmation',()=>{
  it.each(['live','liveStarting','testStarting'])('does not POST a new live transition while status is %s',async status=>{
    const {client,calls}=fixture(()=>json({items:[broadcast(status)]}));
    await client.transition(true,'same_operation');
    expect(calls).toHaveLength(1);
    expect(calls.some(({init})=>init.method==='POST')).toBe(false);
  });
  it('waits for active ingestion and sends an accepted transition once despite stale observations',async()=>{
    let active=false;
    const {client,calls}=fixture(url=>{
      if(url.pathname.endsWith('/liveStreams'))return json({items:[{status:{streamStatus:active?'active':'inactive'}}]});
      if(url.pathname.endsWith('/transition'))return json({id:'selected-live',status:{lifeCycleStatus:'liveStarting'}});
      return json({items:[broadcast()]});
    });
    await client.transition(true,'same_operation');
    expect(calls.filter(({init})=>init.method==='POST')).toHaveLength(0);
    active=true;
    await client.transition(true,'same_operation');
    await client.transition(true,'same_operation');
    await client.transition(true,'same_operation');
    expect(calls.filter(({init})=>init.method==='POST')).toHaveLength(1);
  });
  it('does not dispatch twice when the same operation reads ingestion concurrently',async()=>{
    const {client,calls}=fixture(url=>{
      if(url.pathname.endsWith('/liveStreams'))return json({items:[{status:{streamStatus:'active'}}]});
      if(url.pathname.endsWith('/transition'))return json({id:'selected-live',status:{lifeCycleStatus:'liveStarting'}});
      return json({items:[broadcast()]});
    });
    await Promise.all([client.transition(true,'parallel_operation'),client.transition(true,'parallel_operation')]);
    expect(calls.filter(({init})=>init.method==='POST')).toHaveLength(1);
  });
  it('observes a redundant transition through to live without issuing a second POST',async()=>{
    let posted=false, observations=0;
    const {client,calls}=fixture(url=>{
      if(url.pathname.endsWith('/transition')){
        posted=true;
        return json({error:{errors:[{reason:'redundantTransition'}]}},403);
      }
      if(url.pathname.endsWith('/liveStreams'))return json({items:[{status:{streamStatus:'active'}}]});
      const status=posted&&++observations>=3?'live':'ready';
      return json({items:[broadcast(status)]});
    });
    const {control,adapter}=await controller(client);
    expect(await control.execute(start())).toMatchObject({status:'succeeded',platforms:{youtube:{status:'succeeded',live:true}}});
    expect(calls.filter(({init})=>init.method==='POST')).toHaveLength(1);
    expect(adapter.output).toHaveBeenCalledTimes(1);
    expect(vi.mocked(adapter.settle!).mock.calls.every(args=>args[2]==='youtube_start_001')).toBe(true);
  });
  it.each([true,false])('records a lost transition acknowledgement honestly (later live=%s), without replay after restart',async laterLive=>{
    let posted=false;
    const {client,calls}=fixture(url=>{
      if(url.pathname.endsWith('/transition')){posted=true;throw new Error('Raw exception containing TEST_ACCESS_TOKEN_PRIVATE');}
      if(url.pathname.endsWith('/liveStreams'))return json({items:[{status:{streamStatus:'active'}}]});
      return json({items:[broadcast(posted&&laterLive?'live':'ready')]});
    });
    const {control,adapter,file}=await controller(client);
    const receipt=await control.execute(start());
    expect(receipt.status).toBe(laterLive?'succeeded':'uncertain');
    expect(receipt.platforms?.youtube?.status).toBe(laterLive?'succeeded':'uncertain');
    expect(JSON.stringify(receipt)).not.toContain('TEST_ACCESS_TOKEN_PRIVATE');
    expect(calls.filter(({init})=>init.method==='POST')).toHaveLength(1);
    expect(adapter.settle).toHaveBeenCalledTimes(1);
    await control.stop();
    const reopened=await ControlService.open(file,adapter,()=>{},async()=>{});
    controls.push(reopened);
    expect((await reopened.execute(start())).status).toBe(receipt.status);
    expect(calls.filter(({init})=>init.method==='POST')).toHaveLength(1);
  });
  it('keeps a definite provider rejection actionable and does not retry it',async()=>{
    const {client,calls}=fixture(url=>{
      if(url.pathname.endsWith('/transition'))return json({error:{message:'PRIVATE_PROVIDER_DETAILS',errors:[{reason:'invalidTransition'}]}},403);
      if(url.pathname.endsWith('/liveStreams'))return json({items:[{status:{streamStatus:'active'}}]});
      return json({items:[broadcast()]});
    });
    const {control}=await controller(client);
    const receipt=await control.execute(start());
    expect(receipt.status).toBe('failed');
    expect(receipt.platforms?.youtube?.message).toContain('invalidTransition');
    expect(receipt.platforms?.youtube?.message).not.toContain('PRIVATE_PROVIDER_DETAILS');
    expect(calls.filter(({init})=>init.method==='POST')).toHaveLength(1);
  });
  it('does not restart an already live platform',async()=>{
    const {client,calls}=fixture(()=>json({items:[broadcast('live')]}));
    const {control,adapter}=await controller(client);
    expect(await control.execute(start())).toMatchObject({status:'succeeded',platforms:{youtube:{live:true}}});
    expect(adapter.output).not.toHaveBeenCalled();
    expect(adapter.settle).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
  });
  it('reports unknown confirmation after output as uncertain and never reuses a stale stopped status',async()=>{
    const {client}=fixture(()=>json({items:[broadcast()]}));
    const {control,adapter}=await controller(client);
    adapter.live=vi.fn().mockResolvedValueOnce(false).mockRejectedValue(new Error('Observation unavailable'));
    const receipt=await control.execute({...start('youtube_stop_001'),action:'live.stop'});
    expect(receipt).toMatchObject({status:'uncertain',platforms:{youtube:{status:'uncertain'}}});
    expect(receipt.platforms?.youtube).not.toHaveProperty('live');
    expect(adapter.output).toHaveBeenCalledTimes(1);
    expect(adapter.settle).toHaveBeenCalledTimes(1);
  });
  it('recovers an uncertain OBS dispatch through observation without sending a YouTube transition',async()=>{
    const {client}=fixture(()=>json({items:[broadcast()]}));
    const {control,adapter}=await controller(client);
    adapter.live=vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    adapter.output=vi.fn(async()=>{throw Object.assign(new Error('OBS acknowledgement lost'),{name:'ACTION_UNCERTAIN'});});
    expect((await control.execute(start())).status).toBe('succeeded');
    expect(adapter.output).toHaveBeenCalledTimes(1);
    expect(adapter.settle).not.toHaveBeenCalled();
  });
});
