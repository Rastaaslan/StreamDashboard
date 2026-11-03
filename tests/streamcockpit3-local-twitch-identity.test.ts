import {expect,it} from 'vitest';
import type {Request} from 'express';
import {RemoteAuth} from '../apps/server/src/remote-auth.js';
import {twitchPollActor} from '../apps/server/src/streamcockpit-twitch-poll-router.js';
const req=(token?:string)=>({headers:token?{authorization:'Device '+token}:{}})as Request;
it('a loopback address alone cannot invoke F02/F08; only the trusted IPC session can',()=>{
  const auth=new RemoteAuth();
  expect(()=>twitchPollActor(req(),auth,true,false)).toThrow('unauthorized');
  const local=auth.createLocalTwitchSession();
  expect(twitchPollActor(req(local.credential),auth,true,false)).toMatchObject({id:local.deviceId,canInteract:true});
  expect(auth.permissions(local.deviceId)).toEqual(['chat','cloud','clips']);
  expect(auth.authenticate(local.credential)).toBeNull();
  expect(()=>twitchPollActor(req(local.credential),auth,false,true)).toThrow('unauthorized');
  expect(auth.list()).toEqual([]);expect(auth.serialize()).toEqual([]);expect(auth.serializePairings()).toEqual([]);
  expect(new RemoteAuth().authenticate(local.credential,true)).toBeNull();
  expect(()=>auth.createWsTicket(local.credential)).toThrow();
  auth.revoke(local.deviceId);
  expect(()=>twitchPollActor(req(local.credential),auth,true,false)).toThrow('unauthorized');
});
it('remote management pairing retains the existing explicit chat/cloud requirement',()=>{
  const auth=new RemoteAuth(),invitation=auth.createPairing(undefined,true,['chat','cloud']);
  const paired=auth.pair(invitation.id,invitation.code,'Android');
  expect(twitchPollActor(req(paired.credential),auth,false,true).canInteract).toBe(true);
  expect(auth.serialize()).toHaveLength(1);
  auth.setPermissions(paired.deviceId,['chat']);
  expect(()=>twitchPollActor(req(paired.credential),auth,false,true)).toThrow('forbidden');
});
