import {describe,expect,it} from 'vitest';
import {
  assessWindowsClipBinaryEvidence,inspectWindowsClipBinaryStatus,
  inspectWindowsClipForgeProvenance,
  type WindowsClipBinaryEvidence,type WindowsClipBinaryPolicy,
} from '../apps/server/src/streamcockpit-clipforge-windows-provenance.js';

const keys=['ffmpeg','ffprobe','supervisor'] as const;
const pins=Object.fromEntries(keys.map(key=>[key,{
  sha256:key==='ffmpeg'?'a'.repeat(64):'b'.repeat(64),
  certThumbprint:key==='supervisor'?'1'.repeat(40):'2'.repeat(40),
}])) as WindowsClipBinaryPolicy;
const fakeEvidence=Object.fromEntries(keys.map(key=>[key,{
  sha256:pins[key].sha256,
  signatureStatus:'Valid',certThumbprint:pins[key].certThumbprint,
}])) as WindowsClipBinaryEvidence;

describe('F04 Windows executable provenance — read-only source admission, NOT release proof',()=>{
  it('pure evaluator only accepts exact SHA-256 and trusted signer for all three roles',()=>{
    const result=assessWindowsClipBinaryEvidence(fakeEvidence,pins);
    expect(result.qualified).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(result.files).toEqual(['ffmpeg.exe','ffprobe.exe','StreamCockpitClipJob.exe']);
  });
  it('denies malformed executable evidence instead of throwing or accepting it',()=>{
    const badEvidence:unknown[]=[
      null,
      {...fakeEvidence,ffmpeg:null},
      {...fakeEvidence,ffmpeg:{...fakeEvidence.ffmpeg,sha256:42}},
      {...fakeEvidence,ffprobe:{...fakeEvidence.ffprobe,certThumbprint:42}},
      {...fakeEvidence,supervisor:{...fakeEvidence.supervisor,signatureStatus:null}},
    ];
    for(const candidate of badEvidence){
      expect(assessWindowsClipBinaryEvidence(candidate as WindowsClipBinaryEvidence,pins))
        .toMatchObject({qualified:false,reasons:['BINARY_EVIDENCE_INVALID']});
    }
  });
  it('fails closed if ANY actual signature is NotSigned, regardless of matching digest',()=>{
    const evidence=structuredClone(fakeEvidence);
    evidence.ffmpeg.signatureStatus='NotSigned';
    expect(assessWindowsClipBinaryEvidence(evidence,pins)).toMatchObject({
      qualified:false,reasons:['FFMPEG_NOT_SIGNED_AND_TRUSTED'],
    });
    evidence.ffprobe.signatureStatus='NotTrusted';
    expect(assessWindowsClipBinaryEvidence(evidence,pins).reasons)
      .toContain('FFPROBE_NOT_SIGNED_AND_TRUSTED');
  });
  it('fails closed on tampered binary content, signer substitution or missing pins',()=>{
    const evidence=structuredClone(fakeEvidence);
    evidence.ffprobe.sha256='0'.repeat(64);
    evidence.supervisor.certThumbprint='f'.repeat(40);
    expect(assessWindowsClipBinaryEvidence(evidence,pins).reasons).toEqual([
      'FFPROBE_SHA256_MISMATCH','SUPERVISOR_SIGNER_MISMATCH',
    ]);
    expect(assessWindowsClipBinaryEvidence(fakeEvidence,{
      ...pins,supervisor:{sha256:'invalid',certThumbprint:'1'.repeat(40)},
    })).toMatchObject({qualified:false,reasons:['TRUST_POLICY_MISSING']});
  });
  it('does not mistake three missing paths for production readiness',async()=>{
    expect(await inspectWindowsClipForgeProvenance({
      ffmpeg:'',ffprobe:'',supervisor:'',
    })).toMatchObject({
      qualified:false,reasons:[process.platform==='win32'?'BINARIES_MISSING':'WINDOWS_ONLY'],
    });
  });
  it.skipIf(process.platform!=='win32'||!process.env.SC3_FFMPEG)(
    'inspects actual FIXE FFmpeg Authenticode in read-only mode without executing it',
    async()=>{
      const result=await inspectWindowsClipBinaryStatus(process.env.SC3_FFMPEG!,'ffmpeg');
      expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(typeof result.signatureStatus).toBe('string');
      expect(result.signatureStatus.length).toBeGreaterThan(0);
      // Local WinGet binaries are not automatically a trusted production supply chain.
      const evidence=structuredClone(fakeEvidence);
      evidence.ffmpeg={...result};
      expect(assessWindowsClipBinaryEvidence(evidence,pins).qualified).toBe(false);
    },30000);
});
