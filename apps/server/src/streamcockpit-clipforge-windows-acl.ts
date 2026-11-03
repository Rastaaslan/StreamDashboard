import {spawnSync} from 'node:child_process';
import {lstatSync,realpathSync} from 'node:fs';
import path from 'node:path';

export type WindowsAclAccess = {sid:string;type:string;rights:number};
export type WindowsAclEvidence = {
  ownerSid:string;currentUserSid:string;protectedInheritance:boolean;
  aces:WindowsAclAccess[];
};
export type WindowsAclVerdict = {qualified:boolean;reasons:string[]};
const SID=/^S-1-[0-9]+(?:-[0-9]+)+$/;
const fail=(code:string):never=>{throw Error('CLIPFORGE_ACL_'+code);};

/** Pure effective DACL policy, not a proof by itself. Access inheritance must
 * be disabled and ONLY the current user, SYSTEM or Administrators may access.
 * Refuses sandbox groups, Everyone, Authenticated Users and unresolved SIDs.
 */
export function assessWindowsClipPrivateAcl(value:unknown):WindowsAclVerdict{
  const v=value as WindowsAclEvidence|null;
  if(!v||typeof v!=='object'||!SID.test(v.ownerSid||'')||
      !SID.test(v.currentUserSid||'')||typeof v.protectedInheritance!=='boolean'||
      !Array.isArray(v.aces))
    return {qualified:false,reasons:['ACL_EVIDENCE_INVALID']};
  const reasons:string[]=[];
  if(v.ownerSid!==v.currentUserSid)reasons.push('OWNER_NOT_CURRENT_USER');
  if(!v.protectedInheritance)reasons.push('INHERITANCE_NOT_PROTECTED');
  if(v.aces.length===0)reasons.push('DACL_EMPTY_OR_UNAVAILABLE');
  const trusted=new Set([v.currentUserSid,'S-1-5-18','S-1-5-32-544']);
  for(const ace of v.aces){
    if(!ace||typeof ace.sid!=='string'||typeof ace.type!=='string'||
        typeof ace.rights!=='number'||!Number.isSafeInteger(ace.rights))
      reasons.push('ACE_INVALID');
    else if(ace.type==='Allow'&&!trusted.has(ace.sid))
      reasons.push('UNTRUSTED_SID_ALLOWED');
    else if(!['Allow','Deny'].includes(ace.type))
      reasons.push('ACE_INVALID');
  }
  if(!v.aces.some(ace=>ace?.sid===v.currentUserSid&&ace.type==='Allow'))
    reasons.push('OWNER_ACCESS_NOT_PRESENT');
  return {qualified:reasons.length===0,reasons:[...new Set(reasons)]};
}

function readAclWindows(directory:string):WindowsAclEvidence {
  if(process.platform!=='win32')fail('WINDOWS_REQUIRED');
  if(typeof directory!=='string'||!path.win32.isAbsolute(directory)||
      !/^[A-Za-z]:[\\/]/.test(directory)||directory.startsWith('\\\\'))
    fail('LOCAL_DIRECTORY_REQUIRED');
  const normalized=path.win32.normalize(directory);
  let current=path.win32.parse(normalized).root;
  for(const part of normalized.slice(current.length).split(/[\\/]/).filter(Boolean)){
    current=path.win32.join(current,part);
    const st=lstatSync(current);
    if(!st.isDirectory()||st.isSymbolicLink())fail('REPARSE_OR_NON_DIRECTORY');
  }
  if(realpathSync.native(normalized).toLowerCase()!==normalized.toLowerCase())
    fail('REPARSE_OR_NON_DIRECTORY');
  const encodedPath=Buffer.from(normalized,'utf8').toString('base64');
  const ps=`$ErrorActionPreference='Stop';$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedPath}'));$a=Get-Acl -LiteralPath $p;$s=[Security.Principal.SecurityIdentifier];$user=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;$owner=$a.GetOwner($s).Value;$rows=@($a.Access|ForEach-Object{$sid='UNRESOLVED';try{$sid=$_.IdentityReference.Translate($s).Value}catch{};[pscustomobject]@{sid=$sid;type=[string]$_.AccessControlType;rights=[int64]$_.FileSystemRights}});[pscustomobject]@{ownerSid=$owner;currentUserSid=$user;protectedInheritance=[bool]$a.AreAccessRulesProtected;aces=$rows}|ConvertTo-Json -Depth 5 -Compress`;
  const cmd=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',
    Buffer.from(ps,'utf16le').toString('base64')],{
    shell:false,windowsHide:true,timeout:15000,maxBuffer:32768,encoding:'utf8',
  });
  if(cmd.error||cmd.status!==0)fail('INSPECTION_UNAVAILABLE');
  let result:unknown;
  try{result=JSON.parse(cmd.stdout.trim());}catch{fail('INSPECTION_UNAVAILABLE');}
  return result as WindowsAclEvidence;
}

/** Read-only DACL inspection. Never changes ACLs, creates files or assumes a
 * chmod(0700) call supplies Windows NTFS isolation.
 */
export function inspectWindowsClipPrivateRoot(directory:string):WindowsAclVerdict {
  try{return assessWindowsClipPrivateAcl(readAclWindows(directory));}
  catch{return {qualified:false,reasons:['INSPECTION_UNAVAILABLE']};}
}
