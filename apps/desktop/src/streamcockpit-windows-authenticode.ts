import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {lstat,realpath} from 'node:fs/promises';
import {isAbsolute,join,resolve} from 'node:path';
import type {MaintenanceSignerWitness} from './streamcockpit-external-maintenance.js';
import type {UpgradeReadbackFile} from './streamcockpit-upgrade-readback.js';

const execute=promisify(execFile);
const hex40=/^[A-Fa-f0-9]{40}$/,hex64=/^[A-Fa-f0-9]{64}$/;
const local=(p:string)=>typeof p==='string'&&isAbsolute(p)&&/^[A-Za-z]:[\\/]/.test(p)&&
 !p.slice(2).includes(':')&&!/[\x00-\x1f]/.test(p);
export interface NativeWindowsSignature extends MaintenanceSignerWitness {
 sha256:string;version:string;
}
/** Forge writes numeric PE components while the signed inventory retains the exact
 * SemVer. This comparison is only used alongside full-image hash + OS signer. */
export function windowsVersionMatches(actual:string,expected:string):boolean{
 if(!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(expected))return false;
 const numeric=expected.split('-')[0];
 return actual===expected||actual===numeric||actual===numeric+'.0';
}
/** Known application names, never an arbitrary DLL/helper chosen by enumeration. */
export function windowsApplicationEntry(files:UpgradeReadbackFile[]):UpgradeReadbackFile{
 const matches=files.filter(f=>['streamdashboard.exe','streamcockpit.exe'].includes(f.path.toLowerCase()));
 if(matches.length!==1)throw Error('SC3_AUTHENTICODE_APPLICATION_AMBIGUOUS');
 return structuredClone(matches[0]!);
}
/** Pure decoding only: a string is NOT itself an OS-trust attestation. The native
 * entrypoint below exclusively feeds output from the fixed Windows verifier. */
export function decodeWindowsSignatureOutput(output:string,file:string,observedAt:number):NativeWindowsSignature|undefined{
 try{
  if(output.length>8192||!Number.isSafeInteger(observedAt)||observedAt<0)return undefined;
  const row=JSON.parse(output.trim());
  if(!row||Array.isArray(row)||Object.keys(row).sort().join(',')!=='sha256,signer,status,version'||
   typeof row.sha256!=='string'||!hex64.test(row.sha256)||typeof row.signer!=='string'||
   typeof row.version!=='string'||row.version.length>256||/[\x00-\x1f]/.test(row.version)||
   !['Valid','NotSigned','HashMismatch','NotTrusted','UnknownError','NotSupportedFileFormat','Incompatible'].includes(row.status))return undefined;
  if(row.status==='Valid'&&!hex40.test(row.signer))return undefined;
  return {path:file,observedAt,status:row.status==='Valid'?'valid':'invalid',
   signer:hex40.test(row.signer)?row.signer.toUpperCase():'',sha256:row.sha256.toLowerCase(),version:row.version};
 }catch{return undefined}
}

/** Read-only native Authenticode inspection. Never signs, imports certificates,
 * executes the inspected binary, changes an installation, or launches OBS.
 * A FileShare.Read handle pins bytes against ordinary Windows write/delete
 * access during OS signature inspection and SHA256 calculation. Filesystem
 * identity is rechecked afterward. Unavailable, unsigned or untrusted != valid.
 */
export async function inspectWindowsAuthenticode(file:string):Promise<NativeWindowsSignature|undefined>{
 if(process.platform!=='win32'||!local(file)||!file.toLowerCase().endsWith('.exe'))return undefined;
 const full=resolve(file);
 try{
  const before=await lstat(full);
  if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.size<1||before.size>1024**3||
   (await realpath(full)).toLowerCase()!==full.toLowerCase())return undefined;
  const systemRoot=process.env.SystemRoot??'C:\\Windows';
  if(!local(systemRoot))return undefined;
  // No PATH lookup, shell interpolation, user profile script or executable code
  // from the release. The sole data argument is a base64-encoded filename.
  const powershell=join(systemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
  const path64=Buffer.from(full,'utf8').toString('base64');
  const script=`$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${path64}'));$h=[IO.File]::Open($p,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);try{$s=Get-AuthenticodeSignature -LiteralPath $p;$a=[Security.Cryptography.SHA256]::Create();try{$hash=[BitConverter]::ToString($a.ComputeHash($h)).Replace('-','').ToLowerInvariant()}finally{$a.Dispose()};$thumb='';if($null -ne $s.SignerCertificate){$thumb=$s.SignerCertificate.Thumbprint};$version=[Diagnostics.FileVersionInfo]::GetVersionInfo($p).ProductVersion;if($null -eq $version){$version=''};@{status=$s.Status.ToString();signer=$thumb;sha256=$hash;version=$version}|ConvertTo-Json -Compress}finally{$h.Dispose()}`;
  const result=await execute(powershell,['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],
   {shell:false,windowsHide:true,encoding:'utf8',timeout:20000,maxBuffer:16384});
  const after=await lstat(full);
  if(after.isSymbolicLink()||after.nlink!==1||after.ino!==before.ino||after.dev!==before.dev||
   after.size!==before.size||after.mtimeMs!==before.mtimeMs||
   (await realpath(full)).toLowerCase()!==full.toLowerCase())return undefined;
  return decodeWindowsSignatureOutput(result.stdout,full,Date.now());
 }catch{return undefined}
}
