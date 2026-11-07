import {execFile} from 'node:child_process';
import {lstat,realpath} from 'node:fs/promises';
import {basename,isAbsolute,join,resolve} from 'node:path';
import {inspectWindowsAuthenticode} from './streamcockpit-windows-authenticode.js';
import {squirrelFailure,type SquirrelRelease} from './streamcockpit-squirrel-contract.js';

export interface SquirrelNativeState {
 registry:Array<{name:string;kind:'String'|'ExpandString'|'DWord'|'QWord'|'Binary'|'MultiString';value:unknown}>;
 shortcuts:Array<{path:string;data:string|null}>;
}
const same=(a:string,b:string)=>resolve(a).toLowerCase()===resolve(b).toLowerCase();
const local=(p:unknown):p is string=>typeof p==='string'&&isAbsolute(p)&&/^[A-Za-z]:[\\/]/.test(p)&&
 !p.slice(2).includes(':')&&!/[\x00-\x1f]/.test(p);
export function validateSquirrelNativeState(value:unknown,installationRoot:string):SquirrelNativeState {
 const s=value as SquirrelNativeState;
 if(!s||Object.keys(s).sort().join('|')!=='registry|shortcuts'||!Array.isArray(s.registry)||
  !s.registry.length||s.registry.length>64||!Array.isArray(s.shortcuts)||s.shortcuts.length<2||s.shortcuts.length>64||
  JSON.stringify(s).length>512*1024)throw squirrelFailure('NATIVE_STATE_INVALID');
 const names=new Set<string>(),paths=new Set<string>();
 for(const r of s.registry){
  if(!r||Object.keys(r).sort().join('|')!=='kind|name|value'||typeof r.name!=='string'||r.name.length>256||
   /[\x00-\x1f]/.test(r.name)||names.has(r.name.toLowerCase())||
   !['String','ExpandString','DWord','QWord','Binary','MultiString'].includes(r.kind))
   throw squirrelFailure('NATIVE_STATE_INVALID');
  names.add(r.name.toLowerCase());
  const v=r.value;
  if((['String','ExpandString'].includes(r.kind)&&(typeof v!=='string'||v.length>32768))||
   (r.kind==='DWord'&&(!Number.isSafeInteger(v)||(v as number)<-2147483648||(v as number)>2147483647))||
   (r.kind==='QWord'&&(typeof v!=='string'||!(/^-?\d{1,19}$/).test(v)))||
   (r.kind==='Binary'&&(typeof v!=='string'||!(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/).test(v)))||
   (r.kind==='MultiString'&&(!Array.isArray(v)||v.length>256||v.some(x=>typeof x!=='string'||x.length>32768))))
   throw squirrelFailure('NATIVE_STATE_INVALID');
 }
 const location=s.registry.find(r=>r.name==='InstallLocation'),version=s.registry.find(r=>r.name==='DisplayVersion');
 if(location?.kind!=='String'||typeof location.value!=='string'||!same(location.value,installationRoot)||
  version?.kind!=='String'||typeof version.value!=='string')throw squirrelFailure('REGISTRATION_MISMATCH');
 for(const link of s.shortcuts){
  if(!link||Object.keys(link).sort().join('|')!=='data|path'||!local(link.path)||!link.path.toLowerCase().endsWith('.lnk')||
   paths.has(link.path.toLowerCase())||(link.data!==null&&(typeof link.data!=='string'||link.data.length>128*1024||
    Buffer.from(link.data,'base64').toString('base64')!==link.data)))throw squirrelFailure('NATIVE_STATE_INVALID');
  paths.add(link.path.toLowerCase());
 }
 return {registry:s.registry.map(r=>({name:r.name,kind:r.kind,value:r.value})).sort((a,b)=>a.name.localeCompare(b.name)),
  shortcuts:s.shortcuts.map(l=>({path:l.path,data:l.data})).sort((a,b)=>a.path.localeCompare(b.path))};
}
/** Fixed trusted .NET API bridge. No Update.exe --update retry loop, FullInstall,
 * KillAllProcesses, remote feed, shell interpolation or automatic app start.
 * Squirrel maintenance hooks exit before Cockpit opens any user data. */
const bridge=String.raw`$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$nativeRequest=[Console]::In.ReadToEnd()|ConvertFrom-Json
$nativeRoot=[IO.Path]::GetFullPath($nativeRequest.root)
$nativeUpdater=Join-Path $nativeRequest.feed 'SquirrelApi.exe'
$nativeHandle=[IO.File]::Open($nativeUpdater,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
try{
 $nativeHash=[Security.Cryptography.SHA256]::Create()
 try{$nativeDigest=[BitConverter]::ToString($nativeHash.ComputeHash($nativeHandle)).Replace('-','').ToLowerInvariant()}finally{$nativeHash.Dispose()}
 if($nativeDigest -cne $nativeRequest.release.updater.sha256){throw 'UPDATER_CHANGED'}
 Add-Type -AssemblyName System.Drawing
 $nativeAssembly=[Reflection.Assembly]::LoadFrom($nativeUpdater)
 $nativeManager=[Activator]::CreateInstance($nativeAssembly.GetType('Squirrel.UpdateManager',$true),[object[]]@($nativeRequest.feed,$nativeRequest.release.packageId,[IO.Path]::GetDirectoryName($nativeRoot),$null))
 $nativeZipType=$nativeAssembly.GetType('NuGet.ZipPackage',$true)
 function New-NativePackage([string]$nativePackageFile){return [Activator]::CreateInstance($nativeZipType,[object[]]@($nativePackageFile))}
 function New-NativeLink([string]$nativeLinkFile){return [Activator]::CreateInstance($nativeAssembly.GetType('Squirrel.Shell.ShellLink',$true),[object[]]@($nativeLinkFile))}
 try{
  if([IO.Path]::GetFullPath($nativeManager.RootAppDirectory) -ine $nativeRoot){throw 'ROOT_CHANGED'}
  $nativeRegistryPath='Software\Microsoft\Windows\CurrentVersion\Uninstall\'+$nativeRequest.release.packageId
  function Read-NativeRegistry {
   $nativeKey=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($nativeRegistryPath,$false)
   if($null -eq $nativeKey){throw 'REGISTRATION_MISSING'}
   try{
    if($nativeKey.SubKeyCount -ne 0){throw 'REGISTRY_SUBKEYS'}
    if($nativeKey.GetValue('InstallLocation') -ine $nativeRoot){throw 'REGISTRATION_MISMATCH'}
    foreach($nativeName in @($nativeKey.GetValueNames()|Sort-Object)){
     $nativeKind=$nativeKey.GetValueKind($nativeName).ToString()
     $nativeValue=$nativeKey.GetValue($nativeName,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
     if($nativeKind -eq 'Binary'){$nativeValue=[Convert]::ToBase64String($nativeValue)}
     if($nativeKind -eq 'QWord'){$nativeValue=$nativeValue.ToString([Globalization.CultureInfo]::InvariantCulture)}
     @{name=$nativeName;kind=$nativeKind;value=$nativeValue}
    }
   }finally{$nativeKey.Dispose()}
  }
  $nativeReleaseParser=$nativeAssembly.GetType('Squirrel.ReleaseEntry',$true).GetMethod('ParseReleaseFile',[Reflection.BindingFlags]'Public,Static')
  $nativeLocalReleases=$nativeReleaseParser.Invoke($null,[object[]]@([IO.File]::ReadAllText((Join-Path (Join-Path $nativeRoot 'packages') 'RELEASES'))))
  $nativeLatest=@($nativeLocalReleases|Where-Object {!$_.IsDelta}|Sort-Object Version -Descending)[0]
  $nativePackage=New-NativePackage((Join-Path (Join-Path $nativeRoot 'packages') $nativeLatest.Filename))
  $nativeAppExe=Join-Path (Join-Path $nativeRoot ('app-'+$nativeLatest.Version.ToString())) 'StreamDashboard.exe'
  $nativeFileInfo=[Diagnostics.FileVersionInfo]::GetVersionInfo($nativeAppExe)
  $nativeProduct=@($nativeFileInfo.ProductName,$nativePackage.Title,$nativeFileInfo.FileDescription,'StreamDashboard')|Where-Object {![string]::IsNullOrWhiteSpace($_)}|Select-Object -First 1
  $nativeCompany=@($nativeFileInfo.CompanyName,(@($nativePackage.Authors)|Select-Object -First 1),$nativePackage.Id)|Where-Object {![string]::IsNullOrWhiteSpace($_)}|Select-Object -First 1
  foreach($nativePart in @($nativeProduct,$nativeCompany)){
   if($nativePart.Length -gt 128 -or $nativePart.IndexOfAny([IO.Path]::GetInvalidFileNameChars()) -ge 0 -or $nativePart -match '[. ]$'){throw 'SHORTCUT_NAME_INVALID'}
  }
  $nativeDesktop=[Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory)
  $nativeMenu=Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::StartMenu)) ('Programs\'+$nativeCompany)
  $nativePathList=New-Object 'System.Collections.Generic.List[string]'
  $nativePathList.Add((Join-Path $nativeDesktop ($nativeProduct+'.lnk')))
  $nativePathList.Add((Join-Path $nativeMenu ($nativeProduct+'.lnk')))
  $nativePinned=Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::ApplicationData)) 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar'
  if([IO.Directory]::Exists($nativePinned)){
   if((Get-Item -LiteralPath $nativePinned -Force).LinkType){throw 'PINNED_DIRECTORY_UNTRUSTED'}
   foreach($nativePin in [IO.Directory]::GetFiles($nativePinned,'*.lnk')){
    $nativePinLink=$null
    try{
     $nativePinLink=New-NativeLink($nativePin)
     if($nativePinLink.Target.StartsWith($nativeRoot+'\',[StringComparison]::OrdinalIgnoreCase)){$nativePathList.Add($nativePin)}
    }catch{continue}finally{if($null -ne $nativePinLink){$nativePinLink.Dispose()}}
   }
  }
  $nativePaths=@($nativePathList|Sort-Object -Unique)
  try{
   function Read-NativeShortcuts {
    foreach($nativeLinkPath in $nativePaths){
     $nativeData=$null
     if([IO.File]::Exists($nativeLinkPath)){
      $nativeItem=Get-Item -LiteralPath $nativeLinkPath -Force
      if($nativeItem.LinkType -or $nativeItem.Length -gt 65536){throw 'SHORTCUT_UNTRUSTED'}
      $nativeExisting=New-NativeLink($nativeLinkPath)
      try{
       if(!$nativeExisting.Target.StartsWith($nativeRoot+'\',[StringComparison]::OrdinalIgnoreCase) -or
        @('Update.exe','StreamDashboard.exe') -inotcontains [IO.Path]::GetFileName($nativeExisting.Target)){throw 'FOREIGN_SHORTCUT'}
      }finally{$nativeExisting.Dispose()}
      $nativeData=[Convert]::ToBase64String([IO.File]::ReadAllBytes($nativeLinkPath))
     }
     @{path=$nativeLinkPath;data=$nativeData}
    }
   }
   if($nativeRequest.action -eq 'restore'){
    if((@($nativeRequest.state.shortcuts.path|Sort-Object) -join '|') -ine ($nativePaths -join '|')){throw 'SHORTCUT_PATHS_CHANGED'}
    $null=Read-NativeShortcuts
    $nativeBefore=@(Read-NativeRegistry)
    $nativeKey=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($nativeRegistryPath,$true)
    try{
     foreach($nativeName in $nativeKey.GetValueNames()){if(@($nativeRequest.state.registry.name) -cnotcontains $nativeName){$nativeKey.DeleteValue($nativeName,$false)}}
     foreach($nativeRow in $nativeRequest.state.registry){
      $nativeValue=$nativeRow.value
      if($nativeRow.kind -eq 'Binary'){$nativeValue=[Convert]::FromBase64String($nativeValue)}
      if($nativeRow.kind -eq 'QWord'){$nativeValue=[long]::Parse($nativeValue,[Globalization.CultureInfo]::InvariantCulture)}
      if($nativeRow.kind -eq 'MultiString'){$nativeValue=[string[]]$nativeValue}
      if($nativeRow.kind -eq 'DWord'){$nativeValue=[int]$nativeValue}
      $nativeKey.SetValue($nativeRow.name,$nativeValue,[Microsoft.Win32.RegistryValueKind]$nativeRow.kind)
     }
     $nativeKey.Flush()
    }finally{$nativeKey.Dispose()}
    foreach($nativeLink in $nativeRequest.state.shortcuts){
     if($null -eq $nativeLink.data){if([IO.File]::Exists($nativeLink.path)){[IO.File]::Delete($nativeLink.path)}}
     else{[IO.File]::WriteAllBytes($nativeLink.path,[Convert]::FromBase64String($nativeLink.data))}
    }
   }elseif($nativeRequest.action -eq 'apply'){
    $nativeBefore=@(Read-NativeRegistry)
    if(($nativeBefore|Where-Object {$_.name -eq 'DisplayVersion'}).value -cne $nativeRequest.release.fromVersion){throw 'VERSION_CHANGED'}
    $null=Read-NativeShortcuts
    $nativeInfo=$nativeManager.CheckForUpdate($true,$null,[Enum]::Parse($nativeAssembly.GetType('Squirrel.UpdaterIntention',$true),'Update')).GetAwaiter().GetResult()
    $nativeApply=@($nativeInfo.ReleasesToApply)
    if($nativeInfo.IsBootstrapping -or $nativeInfo.CurrentlyInstalledVersion.Version.ToString() -cne $nativeRequest.release.fromVersion -or
     $nativeInfo.FutureReleaseEntry.Version.ToString() -cne $nativeRequest.release.version -or $nativeApply.Count -ne 1 -or
     $nativeApply[0].IsDelta -or $nativeApply[0].Filename -cne $nativeRequest.release.package.path -or
     $nativeApply[0].Filesize -ne $nativeRequest.release.package.bytes -or
     $nativeApply[0].SHA1 -ine $nativeRequest.release.package.sha1){throw 'NATIVE_RELEASE_MISMATCH'}
    $nativeNew=New-NativePackage((Join-Path $nativeRequest.feed $nativeRequest.release.package.path))
    $nativeOld=New-NativePackage((Join-Path (Join-Path $nativeRoot 'packages') $nativeInfo.CurrentlyInstalledVersion.Filename))
    $nativeNewFileInfo=[Diagnostics.FileVersionInfo]::GetVersionInfo((Join-Path $nativeRequest.preparedApplication 'StreamDashboard.exe'))
    if($nativeNewFileInfo.ProductName -cne $nativeFileInfo.ProductName -or $nativeNewFileInfo.CompanyName -cne $nativeFileInfo.CompanyName -or
     $nativeNewFileInfo.FileDescription -cne $nativeFileInfo.FileDescription -or $nativeNew.Id -cne $nativeRequest.release.packageId -or
     $nativeNew.Title -cne $nativeOld.Title -or ($nativeNew.Authors -join '|') -cne ($nativeOld.Authors -join '|')){throw 'NATIVE_METADATA_MIGRATION_REQUIRED'}
    $null=$nativeManager.DownloadReleases($nativeInfo.ReleasesToApply,$null).GetAwaiter().GetResult()
    $null=$nativeManager.ApplyReleases($nativeInfo,$null).GetAwaiter().GetResult()
    $nativeKey=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($nativeRegistryPath,$true)
    try{
     if($nativeKey.GetValue('InstallLocation') -ine $nativeRoot){throw 'REGISTRATION_CHANGED'}
     $nativeKey.SetValue('DisplayVersion',$nativeRequest.release.version,[Microsoft.Win32.RegistryValueKind]::String)
     $nativeKey.SetValue('InstallDate',[DateTime]::Now.ToString('yyyyMMdd'),[Microsoft.Win32.RegistryValueKind]::String)
     $nativeKey.SetValue('EstimatedSize',[int]($nativeRequest.release.package.bytes/1024),[Microsoft.Win32.RegistryValueKind]::DWord)
     $nativeKey.Flush()
    }finally{$nativeKey.Dispose()}
   }elseif($nativeRequest.action -ne 'read'){throw 'ACTION_INVALID'}
   $nativeFinalRegistry=@(Read-NativeRegistry)
   $nativeFinalReleases=$nativeReleaseParser.Invoke($null,[object[]]@([IO.File]::ReadAllText((Join-Path (Join-Path $nativeRoot 'packages') 'RELEASES'))))
   $nativeFinalRelease=@($nativeFinalReleases|Where-Object {!$_.IsDelta}|Sort-Object Version -Descending)[0]
   $nativeFinalVersion=$nativeFinalRelease.Version.ToString()
   if($nativeFinalRelease.PackageName -cne $nativeRequest.release.packageId -or
    $nativeFinalVersion -cne ($nativeFinalRegistry|Where-Object {$_.name -eq 'DisplayVersion'}).value -or
    @($nativeRequest.release.fromVersion,$nativeRequest.release.version) -cnotcontains $nativeFinalVersion){throw 'NATIVE_ACTIVE_VERSION_MISMATCH'}
   if($nativeFinalVersion -ceq $nativeRequest.release.version){
    if($nativeFinalRelease.Filename -cne $nativeRequest.release.package.path -or
     $nativeFinalRelease.Filesize -ne $nativeRequest.release.package.bytes -or
     $nativeFinalRelease.SHA1 -ine $nativeRequest.release.package.sha1){throw 'NATIVE_ACTIVE_PACKAGE_MISMATCH'}
    $nativePackageHandle=[IO.File]::Open((Join-Path (Join-Path $nativeRoot 'packages') $nativeFinalRelease.Filename),[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
    try{
     $nativePackageHash=[Security.Cryptography.SHA256]::Create()
     try{$nativePackageDigest=[BitConverter]::ToString($nativePackageHash.ComputeHash($nativePackageHandle)).Replace('-','').ToLowerInvariant()}finally{$nativePackageHash.Dispose()}
     if($nativePackageHandle.Length -ne $nativeRequest.release.package.bytes -or $nativePackageDigest -cne $nativeRequest.release.package.sha256){throw 'NATIVE_ACTIVE_PACKAGE_CHANGED'}
    }finally{$nativePackageHandle.Dispose()}
   }
   @{registry=$nativeFinalRegistry;shortcuts=@(Read-NativeShortcuts)}|ConvertTo-Json -Depth 8 -Compress
  }finally{}
 }finally{$nativeManager.Dispose()}
}finally{$nativeHandle.Dispose()}`;
export async function nativeSquirrelState(action:'read'|'apply'|'restore',root:string,feed:string,
 release:SquirrelRelease,signer:string,state?:SquirrelNativeState,preparedApplication?:string):Promise<SquirrelNativeState>{
 if(process.platform!=='win32'||!local(root)||!local(feed)||basename(root).toLowerCase()!==release.packageId.toLowerCase())
  throw squirrelFailure('NATIVE_ROOT_INVALID');
 if(action==='restore')state=validateSquirrelNativeState(state,root);
 const updater=join(feed,'SquirrelApi.exe'),stat=await lstat(updater);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size!==release.updater.bytes||
  !same(await realpath(updater),updater))throw squirrelFailure('UPDATER_UNTRUSTED');
 const native=await inspectWindowsAuthenticode(updater);
 if(!native||native.status!=='valid'||native.signer!==signer||native.sha256!==release.updater.sha256)
  throw squirrelFailure('UPDATER_UNTRUSTED');
 const systemRoot=process.env.SystemRoot??'C:\\Windows';
 if(!local(systemRoot))throw squirrelFailure('WINDOWS_REQUIRED');
 const executable=join(systemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
 try{
  const output=await new Promise<string>((resolveOutput,reject)=>{
   const child=execFile(executable,['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(bridge,'utf16le').toString('base64')],
    {shell:false,windowsHide:true,encoding:'utf8',timeout:120000,maxBuffer:1024*1024},
    (error,stdout)=>error?reject(squirrelFailure('NATIVE_UNCONFIRMED')):resolveOutput(stdout));
   child.stdin?.on('error',()=>{});
   child.stdin?.end(JSON.stringify({action,root,feed,release,state,preparedApplication}));
  });
  return validateSquirrelNativeState(JSON.parse(output),root);
 }catch{throw squirrelFailure('NATIVE_UNCONFIRMED')}
}
