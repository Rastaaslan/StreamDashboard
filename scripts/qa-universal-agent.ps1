param(
 [Parameter(Mandatory=$true)][string]$PackageUri,
 [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{64}$')][string]$Sha256,
 [Parameter(Mandatory=$true)][string]$Loader
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
$ownedLoader=Join-Path $root 'loader.cjs'
Copy-Item -LiteralPath $Loader -Destination $ownedLoader
$start=New-Object Diagnostics.ProcessStartInfo
$start.FileName=Join-Path $package 'StreamDashboard.exe'
$start.Arguments='-r "'+$ownedLoader+'" --role=client --agent'
$start.UseShellExecute=$false
$start.EnvironmentVariables['STREAMDASHBOARD_QA_ROOT']=$root
$start.EnvironmentVariables['APPDATA']=$root
$start.WorkingDirectory=$package
$candidate=[Diagnostics.Process]::Start($start)
$timedOut=-not $candidate.WaitForExit(60000)
if($timedOut){Stop-Process -Id $candidate.Id -ErrorAction SilentlyContinue}
$log=Join-Path $root 'StreamDashboard-Next\logs\streamdashboard.log'
$evidenceFile=Join-Path $root 'agent-evidence.json'
$evidence=if(Test-Path $evidenceFile){Get-Content -Raw $evidenceFile | ConvertFrom-Json}else{[pscustomobject]@{passed=$false;error='Preload test did not complete'}}
$preserved=$true
foreach($process in $baseline){$current=Get-CimInstance Win32_Process -Filter "ProcessId=$($process.ProcessId)";if(!$current -or $current.CreationDate -ne $process.CreationDate){$preserved=$false}}
$cleanShutdown=(Test-Path $log) -and ((Get-Content -Raw $log) -match 'Shutdown complete')
$portsFree=-not (Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object LocalPort -in 48134,48135)
$report=[pscustomobject]@{root=$root;sha256=$Sha256;candidatePid=$candidate.Id;exitCode=$candidate.ExitCode;timedOut=$timedOut;cleanShutdown=$cleanShutdown;portsReleased=$portsFree;stableProcessesPreserved=$preserved;agent=$evidence}
$report | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 (Join-Path $root 'hardware-report.json')
$report | ConvertTo-Json -Depth 8
if(!$evidence.passed -or !$cleanShutdown -or !$preserved -or !$portsFree -or $timedOut){throw 'Hardware verification incomplete; see the preserved isolated profile.'}
