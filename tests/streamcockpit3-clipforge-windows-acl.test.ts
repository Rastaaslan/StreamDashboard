import {describe,expect,it} from 'vitest';
import {assessWindowsClipPrivateAcl,inspectWindowsClipPrivateRoot,
  type WindowsAclEvidence} from '../apps/server/src/streamcockpit-clipforge-windows-acl.js';

const owner='S-1-5-21-11-22-33-1001';
const privateRoot:WindowsAclEvidence={
  currentUserSid:owner,ownerSid:owner,protectedInheritance:true,
  aces:[
    {sid:owner,type:'Allow',rights:2032127},
    {sid:'S-1-5-18',type:'Allow',rights:2032127},
    {sid:'S-1-5-32-544',type:'Allow',rights:2032127},
  ],
};
describe('F04 Windows NTFS staging admission, never chmod-based assumptions',()=>{
  it('accepts an explicitly isolated DACL only with user, SYSTEM and administrators',()=>{
    expect(assessWindowsClipPrivateAcl(privateRoot)).toEqual({qualified:true,reasons:[]});
  });
  it('rejects inherited ACL or a different owner before any encoding',()=>{
    const modified=structuredClone(privateRoot);
    modified.protectedInheritance=false;
    modified.ownerSid='S-1-5-21-11-22-33-9999';
    expect(assessWindowsClipPrivateAcl(modified)).toEqual({
      qualified:false,reasons:['OWNER_NOT_CURRENT_USER','INHERITANCE_NOT_PROTECTED'],
    });
  });
  it('rejects Everyone, Authenticated Users and local sandbox write groups',()=>{
    for(const sid of ['S-1-1-0','S-1-5-11','S-1-5-32-545','S-1-5-21-11-22-33-2002']){
      const candidate=structuredClone(privateRoot);
      candidate.aces.push({sid,type:'Allow',rights:131086});
      expect(assessWindowsClipPrivateAcl(candidate).reasons)
        .toContain('UNTRUSTED_SID_ALLOWED');
    }
  });
  it('refuses malformed or missing ACL evidence without assuming privacy',()=>{
    expect(assessWindowsClipPrivateAcl(null)).toMatchObject({qualified:false});
    expect(assessWindowsClipPrivateAcl({
      ...privateRoot,aces:[],
    }).reasons).toContain('DACL_EMPTY_OR_UNAVAILABLE');
    expect(assessWindowsClipPrivateAcl({
      ...privateRoot,aces:privateRoot.aces.filter(row=>row.sid!==owner),
    }).reasons).toContain('OWNER_ACCESS_NOT_PRESENT');
  });
  it.skipIf(process.platform!=='win32'||!process.env.SC3_CLIP_ACL_LAB)(
    'reads actual FIXE TEMP DACL and refuses sandbox-shared staging in read-only mode',()=>{
      const result=inspectWindowsClipPrivateRoot(process.env.SC3_CLIP_ACL_LAB!);
      expect(result.qualified).toBe(false);
      expect(result.reasons.length).toBeGreaterThan(0);
    },30000);
});
