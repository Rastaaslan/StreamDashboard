import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planReplicaLink,replicaLinkKey,replicaLocation} from '../../apps/mobile/control/replica-identity.js';

const old='http://192.168.1.12:48133',next='https://192.168.1.80:48136';
const response={workspace:'workspace-one',bundle:{savedAt:100,data:{}}};
const record={...response,version:1,pending:[{id:'edit-one'}],drafts:{title:'Mon brouillon'}};
test('HTTP to HTTPS and changed IP retain the exact original replica without copying its outbox',()=>{
 const entries=[[old,record]],before=structuredClone(entries),plan=planReplicaLink(entries,next,response,'physical-one');
 assert.equal(plan.scope,old);assert.equal(plan.seed,false);assert.equal(plan.link.deviceId,'physical-one');
 assert.deepEqual(entries,before);assert.equal(plan.key,replicaLinkKey(next));
});
test('first association seeds once and retries resolve the same record',()=>{
 const first=planReplicaLink([],next,response,'physical-one');assert.equal(first.seed,true);
 const entries=[[next,record],[first.key,first.link]];
 const retry=planReplicaLink(entries,next,response,'physical-one');assert.equal(retry.seed,false);assert.equal(retry.scope,next);
 const moved=planReplicaLink(entries,'https://new-pc.local:48136',response,'physical-one');assert.equal(moved.scope,next);
});
test('an unrelated workspace never receives the queued edits of a reused address',()=>{
 assert.throws(()=>planReplicaLink([[old,record]],old,{...response,workspace:'replacement'},'physical-two'),/autre espace/);
 const first=planReplicaLink([[old,record]],next,response,'physical-one');
 assert.throws(()=>planReplicaLink([[old,record],[first.key,first.link]],next,{...response,workspace:'replacement'},'physical-two'),/autre identité/);
});
test('a cloned workspace with a different physical identity is diagnosed before any write',()=>{
 const first=planReplicaLink([[old,record]],next,response,'physical-one');
 assert.throws(()=>planReplicaLink([[old,record],[first.key,first.link]],'https://third.local',response,'physical-two'),/autre appareil physique/);
});
test('preexisting installation identities protect a replica before its first endpoint link exists',()=>{
 assert.throws(()=>planReplicaLink([[old,record]],next,response,'physical-two',[{id:'physical-one',endpoint:old}]),/autre appareil physique connu/);
 assert.equal(planReplicaLink([[old,record]],next,response,'physical-one',[{id:'physical-one',endpoint:old}]).scope,old);
});
test('independently edited older copies cannot silently hide each other',()=>{
 assert.throws(()=>planReplicaLink([[old,record],[next,{...record,drafts:{title:'Autre brouillon'}}]],'https://third.local',response,'physical-one'),/Plusieurs copies/);
});
test('legacy peers without a physical descriptor can retain their verified workspace',()=>{
 assert.equal(planReplicaLink([[old,record]],next,response).scope,old);
});
test('local autonomous data cannot be claimed by a remote server',()=>{
 assert.throws(()=>planReplicaLink([],next,{...response,workspace:'local:phone'},'physical-one'),/invalide/);
 assert.throws(()=>replicaLocation(next,{version:1,kind:'endpoint-link',scope:'device-workspace-v1',workspace:'workspace-one'}),/illisible/);
 assert.throws(()=>planReplicaLink([],next,response,'bad/id'),/invalide/);
});
