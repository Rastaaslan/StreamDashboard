import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createBinaryHash,createIdentityHash} from '../../apps/mobile/shared/planning-engine.js';
test('incremental browser byte hashes match native SHA-256 across boundaries without changing text identities',()=>{
 const bytes=Uint8Array.from({length:131077},(_,index)=>(index*17)%256);
 for(const step of [1,3,63,64,65536]){
  const hash=createBinaryHash();for(let at=0;at<bytes.length;at+=step)hash.update(bytes.subarray(at,at+step));
  assert.equal(hash.digest(),createHash('sha256').update(bytes).digest('hex'));assert.equal(hash.digest(),hash.digest());
  assert.throws(()=>hash.update(new Uint8Array()),/Invalid/);
 }
 const text='Identité publiée · été 🎵';
 assert.equal(createIdentityHash('sha256').update(text).digest('hex'),createHash('sha256').update(text).digest('hex'));
 assert.equal(createBinaryHash().digest(),createHash('sha256').digest('hex'));
});
