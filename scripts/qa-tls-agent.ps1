param(
 [Parameter(Mandatory=$true)][ValidateSet('Start','Restart','Pairing','Pair','Read','CloseWindow','Stop','Clean','ConfigurationPrepare','ConfigurationResume','ConfigurationUndo')][string]$Mode,
 [string]$Root,
 [ValidateSet('root','device-runtime')][string]$RuntimeProfile='device-runtime',
 [string]$PackageUri,
 [ValidatePattern('^[a-f0-9]{64}$')][string]$Sha256,
 [string]$PeerOrigin
)
$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue'
function Wait-Condition([scriptblock]$Test){for($i=0;$i -lt 120;$i++){if(&$Test){return};Start-Sleep -Milliseconds 250};throw 'Candidate condition timed out'}
function Owned-Process {
 $process=Get-CimInstance Win32_Process -Filter "ProcessId=$($owner.pid)"
 if(!$process -or $process.ExecutablePath -ne $owner.executable -or $process.CreationDate.ToUniversalTime().ToString('o') -ne $owner.created){throw 'Candidate identity cannot be confirmed; no process will be stopped'}
 return Get-Process -Id $owner.pid
}
function Owned-Port([int]$Port){
 $null=Owned-Process
 $listeners=@(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop)
 if(!$listeners.Count -or @($listeners | Where-Object OwningProcess -ne $owner.pid).Count){throw 'Endpoint is not owned by this candidate'}
 return $listeners
}
function Api([string]$Route,$Body=$null,[string]$Method='GET'){
 $null=Owned-Port $owner.runtimePort
 $parameters=@{Uri=('http://127.0.0.1:'+$owner.runtimePort+$Route);Method=$Method;TimeoutSec=10}
 if($null -ne $Body){$parameters.ContentType='application/json';$parameters.Body=[Text.Encoding]::UTF8.GetBytes(($Body|ConvertTo-Json -Depth 12 -Compress))}
 return Invoke-RestMethod @parameters
}
function Evaluate([string]$Expression){
 $listeners=Owned-Port $owner.debugPort
 if(@($listeners|Where-Object LocalAddress -notin '127.0.0.1','::1').Count){throw 'Debug endpoint must remain on loopback'}
 $pages=Invoke-RestMethod -Uri ('http://127.0.0.1:'+$owner.debugPort+'/json/list') -TimeoutSec 5
 $page=$null;foreach($entry in $pages){if($entry.type -eq 'page' -and ($entry.url.StartsWith('http://127.0.0.1:'+$owner.uiPort+'/mobile/control/') -and ([Uri]$entry.url).AbsolutePath -eq '/mobile/control/')){$page=$entry;break}}
 if(!$page){throw 'Candidate controller page is unavailable'}
 $socket=[Net.WebSockets.ClientWebSocket]::new();$cancel=[Threading.CancellationTokenSource]::new();$cancel.CancelAfter(25000)
 try {
  $null=$socket.ConnectAsync([Uri]$page.webSocketDebuggerUrl,$cancel.Token).GetAwaiter().GetResult()
  $json=@{id=1;method='Runtime.evaluate';params=@{expression=$Expression;awaitPromise=$true;returnByValue=$true}}|ConvertTo-Json -Depth 12 -Compress
  $bytes=[Text.Encoding]::UTF8.GetBytes($json)
  $null=$socket.SendAsync([ArraySegment[byte]]::new($bytes),[Net.WebSockets.WebSocketMessageType]::Text,$true,$cancel.Token).GetAwaiter().GetResult()
  do {
   $stream=[IO.MemoryStream]::new();$buffer=New-Object byte[] 65536
   do{$part=$socket.ReceiveAsync([ArraySegment[byte]]::new($buffer),$cancel.Token).GetAwaiter().GetResult();$stream.Write($buffer,0,$part.Count);if($stream.Length -gt 1048576){throw 'Unexpected debug response size'}}while(!$part.EndOfMessage)
   $message=[Text.Encoding]::UTF8.GetString($stream.ToArray())|ConvertFrom-Json;$stream.Dispose()
  }while($message.id -ne 1)
  if($message.error -or $message.result.exceptionDetails){$diagnostic=[string]$message.result.exceptionDetails.exception.description;throw ('Candidate controller: '+($diagnostic -split '\r?\n')[0])}
  return $message.result.result.value
 }finally{$socket.Dispose();$cancel.Dispose()}
}
if($Mode -eq 'Start'){
 if(!$PackageUri -or !$Sha256){throw 'Package URI and checksum are required'}
 $runtimePort=if($RuntimeProfile -eq 'root'){48133}else{48135};$uiPort=if($RuntimeProfile -eq 'root'){48133}else{48134}
 $ports=@($runtimePort,$uiPort,48136,49139)|Select-Object -Unique
 if(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object LocalPort -in $ports){throw 'Candidate ports occupied; stable processes will not be stopped'}
 $baseline=@(Get-CimInstance Win32_Process|Where-Object Name -in 'obs64.exe','StreamDashboard.exe'|ForEach-Object{@{id=$_.ProcessId;created=$_.CreationDate.ToUniversalTime().ToString('o')}})
 $Root=Join-Path ([IO.Path]::GetTempPath()) ('streamdashboard-qa-'+[guid]::NewGuid().ToString('N'));New-Item -ItemType Directory -Path $Root|Out-Null
 $archive=Join-Path $Root 'candidate.zip';Invoke-WebRequest -UseBasicParsing -Uri $PackageUri -OutFile $archive -TimeoutSec 120
 if((Get-FileHash -Algorithm SHA256 $archive).Hash.ToLowerInvariant() -ne $Sha256){throw 'Package checksum mismatch'}
 $package=Join-Path $Root 'package';Expand-Archive -Path $archive -DestinationPath $package
 if(!(Test-Path (Join-Path $package 'StreamDashboard.exe'))){
  $directories=@(Get-ChildItem -LiteralPath $package -Directory);if($directories.Count -ne 1 -or !(Test-Path (Join-Path $directories[0].FullName 'StreamDashboard.exe'))){throw 'Unexpected candidate archive layout'}
  Get-ChildItem -LiteralPath $directories[0].FullName -Force|Move-Item -Destination $package;Remove-Item -LiteralPath $directories[0].FullName
 }
 $profile=Join-Path $Root 'StreamDashboard-Next';$config=Join-Path $profile 'config';if($RuntimeProfile -eq 'device-runtime'){$config=Join-Path $profile 'device-runtime\config'}
 New-Item -ItemType Directory -Path $config -Force|Out-Null
 $id='qa-'+[guid]::NewGuid().ToString('N');$roles=@('controller','display','services','audio');$capabilities=@('cloud','planning','chat','viewer','audio','storage','obs','clips','global-keys');$routes=@{};foreach($name in @('cloud','planning','chat','viewer','audio','storage','global-keys')){$routes[$name]=$id}
 $installation=@{version=2;revision=0;localDeviceId=$id;preset='custom';runtimeProfile=$RuntimeProfile;configured=$true;background=$true;startAtLogin=$false;devices=@(@{id=$id;name=('TLS QA '+$env:COMPUTERNAME);platform='windows';enabled=$true;roles=$roles;capabilities=$capabilities});routes=$routes}
 [IO.File]::WriteAllText((Join-Path $profile 'installation-v2.json'),($installation|ConvertTo-Json -Depth 12))
 [IO.File]::WriteAllText((Join-Path $config 'dashboard.json'),' {"settings":{"remoteEnabled":true,"launchObs":false}}')
 $owner=@{root=$Root;executable=(Join-Path $package 'StreamDashboard.exe');runtimePort=$runtimePort;uiPort=$uiPort;debugPort=49139;ports=$ports;baseline=$baseline;sha256=$Sha256;deviceId=$id;runtimeProfile=$RuntimeProfile}
}else{
 if(!$Root -or [IO.Path]::GetFullPath($Root) -notmatch '^.+[\\/]streamdashboard-qa-[a-f0-9]{32}$'){throw 'Isolated QA profile required'}
 $owner=Get-Content -Raw (Join-Path $Root 'qa-owner.json')|ConvertFrom-Json
 if($owner.root -ne $Root -or $owner.executable -ne (Join-Path $Root 'package\StreamDashboard.exe')){throw 'Invalid candidate ownership record'}
}
if($Mode -in 'Start','Restart'){
 if($Mode -eq 'Restart' -and (Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object LocalPort -in $owner.ports)){throw 'Candidate ports are not free'}
 $installation=Get-Content -Raw (Join-Path $Root 'StreamDashboard-Next\installation-v2.json')|ConvertFrom-Json
 if(($installation.devices|Where-Object id -eq $installation.localDeviceId).roles -contains 'obs-executor'){throw 'OBS role is forbidden in this hardware fixture'}
 $start=[Diagnostics.ProcessStartInfo]::new();$start.FileName=$owner.executable;$start.Arguments='--qa-profile="'+$Root+'" --agent --remote-debugging-port=49139 --remote-debugging-address=127.0.0.1';$start.UseShellExecute=$false;$start.EnvironmentVariables['NODE_ENV']='test';$start.WorkingDirectory=Split-Path $owner.executable
 $candidate=[Diagnostics.Process]::Start($start);$candidate.ProcessorAffinity=[IntPtr]1;$candidate.PriorityClass='BelowNormal';$record=Get-CimInstance Win32_Process -Filter "ProcessId=$($candidate.Id)"
 if($Mode -eq 'Start'){$owner.pid=$candidate.Id;$owner.created=$record.CreationDate.ToUniversalTime().ToString('o')}else{$owner.pid=$candidate.Id;$owner.created=$record.CreationDate.ToUniversalTime().ToString('o')}
 $owner|ConvertTo-Json -Depth 12|Set-Content -Encoding UTF8 (Join-Path $Root 'qa-owner.json')
 Wait-Condition {Get-NetTCPConnection -State Listen -LocalPort $owner.runtimePort -ErrorAction SilentlyContinue}
 $null=Owned-Port 48136;$info=Api '/api/v1/remote/info';if(!$info.enabled -or $info.transport -ne 'tls'){throw 'HTTPS agent is not ready'}
 if($Mode -eq 'Start'){
  $state=Api '/api/v2/state';$configuration=$state.configuration;foreach($action in $configuration.actions){$action.shortcut=''}
  $null=Api '/api/v2/configuration' @{configuration=$configuration;expectedRevision=$configuration.revision} 'PUT'
 }
 $second=[Diagnostics.Process]::Start($start);if(!$second.WaitForExit(10000)){throw 'Secondary instance did not exit'}
 Wait-Condition {$candidate.Refresh();$candidate.MainWindowHandle -ne 0}
 @{root=$Root;pid=$owner.pid;deviceId=$owner.deviceId;fingerprint=$info.fingerprint;urls=$info.urls;runtimePort=$owner.runtimePort;tlsReady=$true}|ConvertTo-Json -Depth 8 -Compress
}elseif($Mode -eq 'Pairing'){
 Api '/api/v1/remote/pairing' @{management=$true} 'POST'|ConvertTo-Json -Depth 8 -Compress
}elseif($Mode -eq 'Pair'){
 $file=Join-Path $Root 'peer-pair.json'
 try{
  $config=Get-Content -Raw $file|ConvertFrom-Json;$encoded=$config|ConvertTo-Json -Depth 8 -Compress
  $expression='(async()=>{const config='+$encoded+';'+@'
const bridge=globalThis.streamDashboardDesktop,origin=config.origin;
const send=(path,body,credential='')=>bridge.requestPeer({id:crypto.randomUUID(),url:origin+path,method:body===undefined?'GET':'POST',credential,...(body===undefined?{}:{body:JSON.stringify(body)}),timeoutMs:8000});
const old=await bridge.getPeerFingerprint(origin),wrong='00'.repeat(32);
await bridge.trustPeer(origin,wrong,old);
const refused=await send('/api/v1/remote/pair',{id:config.id,code:config.code,name:'TLS hardware QA'});
if(refused.ok)throw Error('Wrong pin accepted');
await bridge.trustPeer(origin,config.fingerprint,wrong);
const paired=await send('/api/v1/remote/pair',{id:config.id,code:config.code,name:'TLS hardware QA'});
if(!paired.ok||paired.status!==201)throw Error('Pairing failed');
const identity=JSON.parse(paired.body);await bridge.setDeviceCredential(origin,identity.credential);
const state=await send('/api/v2/device',undefined,identity.credential);
if(!state.ok||state.status!==200)throw Error('Authenticated read failed');
return {wrongPinRejected:true,paired:true,status:state.status,deviceId:JSON.parse(state.body).device.id};
})()
'@
  Evaluate $expression|ConvertTo-Json -Depth 8 -Compress
 }finally{Remove-Item -LiteralPath $file -ErrorAction SilentlyContinue}
}elseif($Mode -in 'ConfigurationPrepare','ConfigurationResume','ConfigurationUndo'){
 $parameters=@{mode=$Mode;origin=$PeerOrigin;local=('http://127.0.0.1:'+$owner.runtimePort)}|ConvertTo-Json -Compress
 $expression='(async()=>{const parameters='+$parameters+';'+@'
const {openReplica}=await import('/mobile/control/autonomy-store.js');
const {equal}=await import('/mobile/shared/autonomy.js');
const {planConfigurationCopy,runConfigurationCopy}=await import('/mobile/shared/configuration-transfer.js');
const bridge=globalThis.streamDashboardDesktop,store=await openReplica('hardware-configuration-qa');
const request=async(origin,body)=>{
 const route='/api/v2/autonomy'+(body?'/sync':'');
 if(origin===parameters.local){const response=await fetch(origin+route,{method:body?'POST':'GET',headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined});if(!response.ok)throw Error('Local candidate request failed');return response.json();}
 const response=await bridge.requestPeer({id:crypto.randomUUID(),url:origin+route,method:body?'POST':'GET',credential:await bridge.getDeviceCredential(origin),...(body?{body:JSON.stringify(body)}:{}),timeoutMs:8000});
 if(!response.ok||response.status!==200)throw Error('Authenticated peer request failed');return JSON.parse(response.body);
};
let job=store.record.drafts.hardwareConfigurationV2;
const save=async next=>{await store.draft('hardwareConfigurationV2',next);job=next;};
const options={snapshot:request,apply:request,save};
if(parameters.mode==='ConfigurationPrepare'){
 if(job)throw Error('Existing hardware job must be preserved');
 const a=await request(parameters.local),b=await request(parameters.origin);
 const button={id:'qa-config-'+crypto.randomUUID(),label:'QA configuration v\u00e9rifi\u00e9e',type:'sound.stop',value:'',color:'red',shortcut:''};
 const seeded=await request(parameters.local,{workspace:a.workspace,edit:{id:crypto.randomUUID(),key:'action/'+button.id,base:null,value:button,strict:true}});
 if(seeded.receipt.status!=='applied')throw Error('Candidate fixture creation refused');
 job={id:crypto.randomUUID(),source:parameters.local,target:parameters.origin,...planConfigurationCopy(await request(parameters.local),b),status:'pending'};
 job.items=job.items.filter(item=>item.key==='actionSet/root');if(job.items.length!==1)throw Error('Expected one atomic button collection');
 await save(job);let interrupted=false;
 try{await runConfigurationCopy(job,{...options,apply:async(origin,body)=>{await request(origin,body);throw Error('QA lost acknowledgement');}});}catch(error){if(error.message!=='QA lost acknowledgement')throw error;interrupted=true;}
 if(!interrupted||!job.items[0].attempted||job.items[0].complete)throw Error('Interruption not retained');
 return {interrupted:true,receiptNotYetConfirmed:true,jobId:job.id};
}
if(!job||job.target!==parameters.origin)throw Error('Retained QA job missing');
const undo=parameters.mode==='ConfigurationUndo';await runConfigurationCopy(job,options,undo);
const after=await request(parameters.origin),expected=undo?job.items[0].base.items:job.items[0].after.items;
if(!equal(after.bundle.data.configuration.actions,expected))throw Error('Destination configuration mismatch');
return {status:job.status,jobId:job.id,physicalPeerConfirmed:true,exactConfiguration:true,noActionExecuted:true};
})()
'@
 Evaluate $expression|ConvertTo-Json -Depth 8 -Compress
}elseif($Mode -eq 'Read'){
 $encoded=$PeerOrigin|ConvertTo-Json -Compress
 $expression='(async()=>{const origin='+$encoded+';const bridge=globalThis.streamDashboardDesktop;const response=await bridge.requestPeer({id:crypto.randomUUID(),url:origin+"/api/v2/device",method:"GET",credential:await bridge.getDeviceCredential(origin),timeoutMs:5000});return {connected:response.ok&&response.status===200,status:response.status||null,deviceId:response.ok&&response.status===200?JSON.parse(response.body).device.id:null};})()'
 Evaluate $expression|ConvertTo-Json -Compress
}elseif($Mode -eq 'CloseWindow'){
 $candidate=Owned-Process;if(!$candidate.CloseMainWindow()){throw 'No candidate window to close'};Wait-Condition {$candidate.Refresh();$candidate.MainWindowHandle -eq 0};$null=Api '/api/v1/health';@{closed=$true;runtimePreserved=$true}|ConvertTo-Json -Compress
}elseif($Mode -eq 'Stop'){
 $candidate=Owned-Process;Stop-Process -Id $candidate.Id;$null=$candidate.WaitForExit(10000)
 Wait-Condition {-not(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object LocalPort -in $owner.ports)}
 $preserved=$true;foreach($prior in $owner.baseline){$current=Get-CimInstance Win32_Process -Filter "ProcessId=$($prior.id)";if(!$current -or $current.CreationDate.ToUniversalTime().ToString('o') -ne $prior.created){$preserved=$false}}
 $report=@{root=$Root;stopped=$true;portsReleased=$true;stableProcessesPreserved=$preserved};$report|ConvertTo-Json|Set-Content -Encoding UTF8 (Join-Path $Root 'tls-stop-report.json');$report|ConvertTo-Json -Compress
 if(!$preserved){throw 'Stable process preservation check failed'}
}elseif($Mode -eq 'Clean'){
 if(Get-Process -Id $owner.pid -ErrorAction SilentlyContinue){throw 'Stop the owned candidate before removing its package'}
 Remove-Item -LiteralPath (Join-Path $Root 'package') -Recurse -Force;Remove-Item -LiteralPath (Join-Path $Root 'candidate.zip') -Force
 @{packageRemoved=$true;profileAndReportsPreserved=$true}|ConvertTo-Json -Compress
}
