import {
  inspectWindowsClipForgeProvenance,type WindowsClipBinaryPaths,
  type WindowsClipBinaryPolicy,
} from '../apps/server/src/streamcockpit-clipforge-windows-provenance.js';
import {inspectWindowsClipPrivateRoot} from '../apps/server/src/streamcockpit-clipforge-windows-acl.js';

/** Read-only G2 preflight; never probes/encodes a user replay or starts OBS.
 * Environment values are host-provisioned, never accepted from a remote client.
 */
async function main(){
  const paths:WindowsClipBinaryPaths={
    ffmpeg:process.env.SC3_F04_FFMPEG||'',
    ffprobe:process.env.SC3_F04_FFPROBE||'',
    supervisor:process.env.SC3_F04_SUPERVISOR||'',
  };
  const makePin=(kind:'FFMPEG'|'FFPROBE'|'SUPERVISOR')=>({
    sha256:process.env['SC3_F04_'+kind+'_SHA256']||'',
    certThumbprint:process.env['SC3_F04_'+kind+'_SIGNER_SHA1']||'',
  });
  const policy:WindowsClipBinaryPolicy={
    ffmpeg:makePin('FFMPEG'),ffprobe:makePin('FFPROBE'),
    supervisor:makePin('SUPERVISOR'),
  };
  const binaries=await inspectWindowsClipForgeProvenance(paths,policy);
  const outputRoot=process.env.SC3_F04_OUTPUT_ROOT||'';
  const acl=outputRoot
    ?inspectWindowsClipPrivateRoot(outputRoot)
    :{qualified:false,reasons:['OUTPUT_ROOT_NOT_CONFIGURED']};
  // This is not a production admission token: live OBS source pinning, a
  // signed packaged helper, replay UI and electrical durability remain absent.
  const result={
    product:'StreamCockpit 3.0',scope:'F04 Windows read-only preflight',
    binaries:{qualified:binaries.qualified,reasons:binaries.reasons},
    outputAcl:acl,
    releaseEligible:false,
    blockers:[
      'OBS_REPLAY_SOURCE_GRANT_NOT_HARDWARE_QUALIFIED',
      'WINDOWS_STAGING_POWER_LOSS_NOT_TESTED',
      'DESKTOP_ANDROID_CONSENT_AND_ROLLBACK_NOT_QUALIFIED',
      'SIGNED_RELEASE_ARTIFACTS_NOT_VERIFIED',
    ],
  };
  console.log(JSON.stringify(result,null,2));
  if(process.argv.includes('--final')){
    console.error('SC3_F04_RELEASE_BLOCKED: actual OBS source, private ACL, trusted binaries and hardware/rollback evidence required.');
    process.exitCode=1;
  }
}
main().catch(()=>{
  console.error('SC3_F04_PREFLIGHT_UNAVAILABLE');
  process.exitCode=1;
});
