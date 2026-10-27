param(
 [Parameter(Mandatory=$true)][string]$PackageUri,
 [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{64}$')][string]$Sha256
)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
if(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object LocalPort -in 48134,48135){throw 'Candidate ports occupied; stable processes will not be stopped.'}
$baseline=@(Get-CimInstance Win32_Process | Where-Object Name -in 'obs64.exe','StreamDashboard.exe' | Select-Object Name,ProcessId,CreationDate)
$root=Join-Path ([IO.Path]::GetTempPath()) ('streamdashboard-qa-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root | Out-Null
$archive=Join-Path $root 'candidate.zip'
Invoke-WebRequest -UseBasicParsing -Uri $PackageUri -OutFile $archive -TimeoutSec 120
if((Get-FileHash -Algorithm SHA256 $archive).Hash.ToLowerInvariant() -ne $Sha256){throw 'Package checksum mismatch'}
$package=Join-Path $root 'package'
Expand-Archive -Path $archive -DestinationPath $package
$start=New-Object Diagnostics.ProcessStartInfo
$start.FileName=Join-Path $package 'StreamDashboard.exe'
$start.Arguments='--qa-profile="'+$root+'" --role=client --agent'
$start.UseShellExecute=$false
$start.EnvironmentVariables['NODE_ENV']='test'
$start.WorkingDirectory=$package
$candidate=[Diagnostics.Process]::Start($start)
$checks=New-Object 'Collections.Generic.List[string]'
$failure=$null
$origin='http://127.0.0.1:48135'
function Wait-Condition([scriptblock]$Test){for($i=0;$i -lt 100;$i++){if(&$Test){return};Start-Sleep -Milliseconds 100};throw 'Test condition timed out'}
function Api([string]$Route,$Body=$null,[string]$Method='POST'){
 $owner=Get-NetTCPConnection -State Listen -LocalPort 48135 -ErrorAction Stop
 if($owner.OwningProcess -ne $candidate.Id){throw 'Endpoint does not belong to the candidate'}
 if($null -eq $Body){return Invoke-RestMethod -Uri ($origin+$Route) -TimeoutSec 5}
 return Invoke-RestMethod -Uri ($origin+$Route) -Method $Method -ContentType 'application/json' -Body ($Body | ConvertTo-Json -Compress) -TimeoutSec 10
}
try {
 Wait-Condition {Get-NetTCPConnection -State Listen -LocalPort 48135 -ErrorAction SilentlyContinue}
 $installation=Get-Content -Raw (Join-Path $root 'StreamDashboard-Next\installation-v2.json') | ConvertFrom-Json
 if(($installation.devices | Where-Object id -eq $installation.localDeviceId).roles -contains 'obs-executor'){throw 'OBS must be disabled'}
 if((Api '/api/v2/device').device.id -ne $installation.localDeviceId){throw 'Wrong isolated device identity'}
 $candidate.Refresh();if($candidate.MainWindowHandle -ne 0){throw 'Unexpected agent window'}
 $checks.Add('headless-runtime-ready')
 $second=[Diagnostics.Process]::Start($start);if(!$second.WaitForExit(10000)){throw 'Second instance did not release its lock'}
 Wait-Condition {$candidate.Refresh();$candidate.MainWindowHandle -ne 0}
 if(!$candidate.CloseMainWindow()){throw 'Dashboard could not be closed'}
 Wait-Condition {$candidate.Refresh();$candidate.MainWindowHandle -eq 0}
 $null=Api '/api/v1/health';$checks.Add('dashboard-close-preserves-runtime')
 $stream=New-Object IO.MemoryStream;$writer=New-Object IO.BinaryWriter($stream)
 $writer.Write([Text.Encoding]::ASCII.GetBytes('RIFF'));$writer.Write([int]160036);$writer.Write([Text.Encoding]::ASCII.GetBytes('WAVEfmt '));$writer.Write([int]16);$writer.Write([int16]1);$writer.Write([int16]1);$writer.Write([int]8000);$writer.Write([int]16000);$writer.Write([int16]2);$writer.Write([int16]16);$writer.Write([Text.Encoding]::ASCII.GetBytes('data'));$writer.Write([int]160000);$writer.Write((New-Object byte[] 160000));$writer.Flush()
 $sound=Invoke-RestMethod -Uri ($origin+'/api/v2/sounds/upload?name=Silent-QA&extension=wav') -Method POST -ContentType 'application/octet-stream' -Body $stream.ToArray() -TimeoutSec 10
 $writer.Dispose();$stream.Dispose()
 $null=Api ('/api/v1/soundboard/sounds/'+$sound.id) @{outputId='device-default';volume=0} 'PUT'
 $played=Api '/api/v2/actions' @{id='qa_silent_play';issuedAt=[DateTime]::UtcNow.ToString('o');action='sound.play';soundId=$sound.id}
 if($played.status -ne 'succeeded'){throw ('Silent playback failed: '+$played.message)}
 $stopped=Api '/api/v2/actions' @{id='qa_silent_stop';issuedAt=[DateTime]::UtcNow.ToString('o');action='sound.stop'}
 if($stopped.status -ne 'succeeded'){throw 'Silent playback stop failed'}
 $candidate.Refresh();if($candidate.MainWindowHandle -ne 0){throw 'Audio exposed a visible window'}
 $checks.Add('silent-local-audio-without-obs')
}catch{$failure=$_.Exception.Message}finally{
 # Deliberate interruption of this temporary agent only, after the audio stop.
 # Graceful shutdown is qualified separately by the Electron test suite.
 if(!$candidate.HasExited){Stop-Process -Id $candidate.Id -ErrorAction SilentlyContinue;$null=$candidate.WaitForExit(10000)}
}
$preserved=$true
foreach($process in $baseline){$current=Get-CimInstance Win32_Process -Filter "ProcessId=$($process.ProcessId)";if(!$current -or $current.CreationDate -ne $process.CreationDate){$preserved=$false}}
$portsFree=-not (Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object LocalPort -in 48134,48135)
$report=[pscustomobject]@{root=$root;sha256=$Sha256;candidatePid=$candidate.Id;stoppedByHarness=$true;portsReleased=$portsFree;stableProcessesPreserved=$preserved;passed=(!$failure -and $preserved -and $portsFree);checks=$checks.ToArray();error=$failure}
$report | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 (Join-Path $root 'hardware-report.json')
$report | ConvertTo-Json -Depth 8
if(!$report.passed){throw 'Hardware verification incomplete; see the preserved isolated profile.'}
