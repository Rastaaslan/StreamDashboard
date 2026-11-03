import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { lstatSync, realpathSync } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';

type Kind = 'ffmpeg' | 'ffprobe' | 'supervisor';
const names: Record<Kind,string> = {
  ffmpeg: 'ffmpeg.exe', ffprobe: 'ffprobe.exe', supervisor: 'StreamCockpitClipJob.exe',
};
const keys: Kind[] = ['ffmpeg','ffprobe','supervisor'];
const hex64 = /^[0-9a-f]{64}$/i, hex40 = /^[0-9a-f]{40}$/i;
const fail = (code:string): never => { throw Error('CLIPFORGE_PROVENANCE_' + code); };
export type WindowsClipBinaryPaths = Record<Kind,string>;
export type WindowsClipBinaryPolicy = Record<Kind,{sha256:string;certThumbprint:string}>;
export type WindowsClipBinaryEvidence = Record<Kind,{
  sha256:string; signatureStatus:string; certThumbprint:string|null;
}>;
export type AdmissionResult = {qualified:boolean; reasons:string[]; files:string[]};

/** Pure evidence comparison only. Never use caller-supplied evidence as release proof. */
export function assessWindowsClipBinaryEvidence(
  evidence:WindowsClipBinaryEvidence,policy:WindowsClipBinaryPolicy): AdmissionResult {
  const reasons:string[]=[];
  if (!policy || !evidence || keys.some(key=>{
    const pin=policy[key], item=evidence[key];
    return !pin || !item || typeof pin.sha256!=='string' || !hex64.test(pin.sha256) ||
      typeof pin.certThumbprint!=='string' || !hex40.test(pin.certThumbprint);
  })) return {qualified:false,reasons:['TRUST_POLICY_MISSING'],files:keys.map(key=>names[key])};
  for (const key of keys) {
    const signed=evidence[key];
    if (signed.signatureStatus!=='Valid') reasons.push(key.toUpperCase()+'_NOT_SIGNED_AND_TRUSTED');
    if (signed.sha256.toLowerCase()!==policy[key].sha256.toLowerCase())
      reasons.push(key.toUpperCase()+'_SHA256_MISMATCH');
    if (signed.certThumbprint?.toUpperCase()!==policy[key].certThumbprint.toUpperCase())
      reasons.push(key.toUpperCase()+'_SIGNER_MISMATCH');
  }
  return {qualified:reasons.length===0,reasons,files:keys.map(key=>names[key])};
}

function requireLocalRegular(file:string,expectedName:string){
  if (process.platform!=='win32') fail('WINDOWS_ONLY');
  if(typeof file!=='string'||!path.win32.isAbsolute(file)||
      !/^[A-Za-z]:[\\/]/.test(file)||file.startsWith('\\\\')||
      path.win32.basename(file).toLowerCase()!==expectedName.toLowerCase())
    fail('LOCAL_ABSOLUTE_PATH_REQUIRED');
  const normalized=path.win32.normalize(file);
  let current=path.win32.parse(normalized).root;
  for (const name of normalized.slice(current.length).split(/[\\/]/).filter(Boolean)) {
    current=path.win32.join(current,name);
    const st=lstatSync(current);
    if(st.isSymbolicLink())fail('REPARSE_PATH_UNTRUSTED');
  }
  const st=lstatSync(normalized);
  if(!st.isFile()||st.nlink!==1||st.size<=0||st.size>512*1024*1024)
    fail('EXECUTABLE_NOT_REGULAR');
  if(realpathSync.native(normalized).toLowerCase()!==normalized.toLowerCase())
    fail('REPARSE_PATH_UNTRUSTED');
  return {normalized,st};
}

async function digestPinnedFile(file:string,expectedName:string){
  const {normalized,st}=requireLocalRegular(file,expectedName);
  const handle=await open(normalized,'r');
  try {
    const before=await handle.stat();
    if(before.size!==st.size||before.mtimeMs!==st.mtimeMs||
        before.ctimeMs!==st.ctimeMs||before.nlink!==1)fail('EXECUTABLE_CHANGED');
    const hash=createHash('sha256');
    let count=0;
    for await(const chunk of handle.createReadStream({autoClose:false})){
      count+=chunk.length;
      if(count>512*1024*1024)fail('EXECUTABLE_TOO_LARGE');
      hash.update(chunk);
    }
    const after=await handle.stat();
    const current=requireLocalRegular(normalized,expectedName).st;
    if(count!==before.size||after.size!==before.size||
        after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs||
        current.size!==before.size||current.mtimeMs!==before.mtimeMs||
        current.ctimeMs!==before.ctimeMs)fail('EXECUTABLE_CHANGED');
    return hash.digest('hex');
  } finally { await handle.close(); }
}

/** Reads Windows Authenticode via PowerShell with encoded path; never a shell command. */
function readAuthenticode(file:string): {signatureStatus:string;certThumbprint:string|null} {
  const encodedPath=Buffer.from(file,'utf8').toString('base64');
  const script=`$ErrorActionPreference='Stop';$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedPath}'));$s=Get-AuthenticodeSignature -LiteralPath $p;[pscustomobject]@{signatureStatus=[string]$s.Status;certThumbprint=$(if($s.SignerCertificate){[string]$s.SignerCertificate.Thumbprint}else{$null})} | ConvertTo-Json -Compress`;
  const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',
    Buffer.from(script,'utf16le').toString('base64')],{
    shell:false,windowsHide:true,timeout:15000,maxBuffer:16384,encoding:'utf8',
  });
  if(result.error || result.status!==0)fail('SIGNATURE_INSPECTION_UNAVAILABLE');
  let data:unknown;
  try{data=JSON.parse(result.stdout.trim());}catch{fail('SIGNATURE_INSPECTION_UNAVAILABLE');}
  if(!data||typeof data!=='object'||Array.isArray(data))fail('SIGNATURE_INSPECTION_UNAVAILABLE');
  const s=data as Record<string,unknown>;
  if(typeof s.signatureStatus!=='string'||
      (s.certThumbprint!==null&&typeof s.certThumbprint!=='string'))
    fail('SIGNATURE_INSPECTION_UNAVAILABLE');
  return {signatureStatus:s.signatureStatus as string,certThumbprint:s.certThumbprint as string|null};
}

/** Host-only, READ-ONLY admission. No public API, spawn of codec, signature creation,
 * install, or bypass for locally compiled test helpers. Release trust pins are external.
 */
export async function inspectWindowsClipBinaryStatus(file:string,kind:Kind){
  const sha256=await digestPinnedFile(file,names[kind]);
  const signature=readAuthenticode(file);
  if((await digestPinnedFile(file,names[kind]))!==sha256)fail('EXECUTABLE_CHANGED');
  return {sha256,...signature};
}

export async function inspectWindowsClipForgeProvenance(
  paths:WindowsClipBinaryPaths,policy?:WindowsClipBinaryPolicy):Promise<AdmissionResult> {
  if(process.platform!=='win32')return {qualified:false,reasons:['WINDOWS_ONLY'],files:keys.map(key=>names[key])};
  if(!paths||keys.some(key=>!paths[key]))
    return {qualified:false,reasons:['BINARIES_MISSING'],files:keys.map(key=>names[key])};
  const evidence={} as WindowsClipBinaryEvidence;
  try{
    for(const key of keys){
      evidence[key]=await inspectWindowsClipBinaryStatus(paths[key],key);
    }
  }catch(error){
    const code=error instanceof Error && /^CLIPFORGE_PROVENANCE_[A-Z_]+$/.test(error.message)
      ?error.message.slice('CLIPFORGE_PROVENANCE_'.length):'BINARY_INSPECTION_UNAVAILABLE';
    return {qualified:false,reasons:[code],files:keys.map(key=>names[key])};
  }
  if(!policy)return {qualified:false,reasons:['TRUST_POLICY_MISSING'],files:keys.map(key=>names[key])};
  return assessWindowsClipBinaryEvidence(evidence,policy);
}
