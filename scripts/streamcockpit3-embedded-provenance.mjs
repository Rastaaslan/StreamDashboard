import {extractFile,getRawHeader} from '@electron/asar';
import {NtExecutable,NtExecutableResource} from 'resedit';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {spawnSync} from 'node:child_process';

const fail=code=>{throw Error('SC3_ARTIFACT_'+code)};
const canonical=value=>JSON.stringify(value);
export function assertSameEmbeddedCommit(expected,windows,android){
  const keys=['schemaVersion','product','version','sourceCommit','sourceTreeSha256','sourceTreeDirty'];
  for(const item of [windows,android]){
    if(!item||typeof item!=='object'||Array.isArray(item)||
      Object.keys(item).sort().join('|')!==[...keys].sort().join('|')||
      item.schemaVersion!==1||item.product!=='Le StreamCockpit'||
      !/^3\.0\./.test(item.version)||
      !/^[a-f0-9]{40}$/.test(item.sourceCommit)||
      !/^[a-f0-9]{64}$/.test(item.sourceTreeSha256)||
      item.sourceTreeDirty!==false)fail('EMBEDDED_PROVENANCE_INVALID');
    if(item.sourceCommit.toLowerCase()!==expected.toLowerCase())
      fail('EMBEDDED_COMMIT_MISMATCH');
  }
  if(canonical(windows)!==canonical(android))
    fail('EMBEDDED_ARTIFACT_MISMATCH');
  return {sourceCommit:expected,sourceTreeSha256:windows.sourceTreeSha256};
}
function readApkBuild(apk){
  // Read one well-known asset without extracting or modifying APK bytes.
  // Input path is base64-encoded: never interpolate user-provided paths.
  const encoded=Buffer.from(apk,'utf8').toString('base64');
  const script=`$ErrorActionPreference='Stop';Add-Type -AssemblyName System.IO.Compression;Add-Type -AssemblyName System.IO.Compression.FileSystem;$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'));$z=[System.IO.Compression.ZipFile]::OpenRead($p);try{$e=$z.GetEntry('assets/public/streamcockpit-build.json');if($null -eq $e){throw 'Missing build provenance'};if($e.Length -gt 8192){throw 'Oversized build provenance'};$s=$e.Open();try{$reader=New-Object System.IO.StreamReader($s,[Text.Encoding]::UTF8);try{[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($reader.ReadToEnd()))}finally{$reader.Dispose()}}finally{$s.Dispose()}}finally{$z.Dispose()}`;
  const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',
    Buffer.from(script,'utf16le').toString('base64')],{shell:false,encoding:'utf8',
    windowsHide:true,timeout:20000,maxBuffer:128*1024});
  if(result.error||result.status!==0||!result.stdout.trim())
    fail('ANDROID_EMBEDDED_PROVENANCE_MISSING');
  try{return JSON.parse(Buffer.from(result.stdout.trim(),'base64').toString('utf8'))}
  catch{fail('ANDROID_EMBEDDED_PROVENANCE_INVALID')}
}
export function verifyEmbeddedArtifactProvenance(windowsExe,apk,expectedCommit){
  if(process.platform!=='win32')fail('WINDOWS_REQUIRED');
  const asar=join(dirname(windowsExe),'resources','app.asar');
  let manifest,integrity,headerHash;
  try{
    const bytes=extractFile(asar,'resources/streamcockpit-build.json');
    if(bytes.length>8192)fail('EMBEDDED_PROVENANCE_INVALID');
    manifest=JSON.parse(bytes.toString('utf8'));
    const pe=NtExecutable.from(readFileSync(windowsExe),{ignoreCert:true});
    if(pe.is32bit())fail('WINDOWS_X64_REQUIRED');
    const rows=NtExecutableResource.from(pe).entries.filter(row=>
      row.type==='INTEGRITY'&&row.id==='ELECTRONASAR');
    if(rows.length!==1)fail('ASAR_INTEGRITY_MISSING');
    integrity=JSON.parse(Buffer.from(rows[0].bin).toString('utf8'));
    headerHash=createHash('sha256').update(getRawHeader(asar).headerString).digest('hex');
  }catch(error){
    if(error instanceof Error&&error.message.startsWith('SC3_ARTIFACT_'))throw error;
    fail('WINDOWS_EMBEDDED_PROVENANCE_MISSING');
  }
  if(!Array.isArray(integrity)||integrity.length!==1||
    integrity[0].file?.replaceAll('\\','/')!=='resources/app.asar'||
    integrity[0].alg!=='SHA256'||integrity[0].value!==headerHash)
    fail('ASAR_INTEGRITY_MISMATCH');
  return assertSameEmbeddedCommit(expectedCommit,manifest,readApkBuild(apk));
}
