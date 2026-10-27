# RC11.7 offline installer. Windows PowerShell 5.1. No download or forced stop.
# Rollback also requires fresh idle evidence. If unavailable, keep both runtimes and stop.
# Source installation remains the observed RC11.4. Missing legacy API evidence
# is a refusal, never an assumption of idle. Recheck after both PCs return online.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidateSet('host', 'client')][string]$Role,
    [Parameter(Mandatory = $true)][string]$StageRuntime,
    [Parameter(Mandatory = $true)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$ExpectedExeSha,
    [Parameter(Mandatory = $true)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$ExpectedAsarSha,
    [string]$AuthoritativeIdleAt
)
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$activeRuntime = 'C:\Users\damie\StreamDashboard-RC10\out\StreamDashboard-win32-x64'
$activeExe = Join-Path $activeRuntime 'StreamDashboard.exe'
$profileRoot = Join-Path $env:APPDATA 'StreamDashboard-Next'
$stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')
$backupRoot = Join-Path $env:LOCALAPPDATA "StreamDashboard-Next\backups\rc11.7-$stamp"
$profileBackup = Join-Path $backupRoot 'profile'
$previousRuntime = "$activeRuntime.pre-rc11.7-$stamp"
$failedRuntime = "$activeRuntime.failed-rc11.7-$stamp"
$apiPort = if ($Role -eq 'host') { 48133 } else { 48135 }
$oldMoved = $false; $newMoved = $false; $appClosed = $false
$phase = 'PREFLIGHT'
$result = [ordered]@{
    version = 'sd-installer-rc11.7-v1'; role = $Role; success = $false
    startedAt = [DateTime]::UtcNow.ToString('o'); finishedAt = $null
    phase = $phase; error = $null; errorLine = $null; errorType = $null; rollback = 'NOT_NEEDED'; shortcutWarning = $null
    profileBackup = $profileBackup; previousRuntime = $previousRuntime
    backupVerified = $false; criticalFiles = 0; obsBefore = @(); obsAfter = @(); obsUnchanged = $false
    idleVerifiedAt = $null; nativeOutputCount = 0; suiteStreamCount = 0
}

function Field($Value, [string]$Name) {
    if ($null -eq $Value) { return $null }
    $property = $Value.PSObject.Properties[$Name]
    if ($null -ne $property) { return $property.Value }
    return $null
}
function Require-Bool($Value, [bool]$Expected, [string]$Code) {
    if ($Value -isnot [bool] -or $Value -ne $Expected) { throw ("IDLE_REFUSED_" + $Code.ToUpperInvariant()) }
}
function Read-Api([string]$Path) {
    Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$apiPort$Path" -TimeoutSec 2 -Headers @{ 'Cache-Control' = 'no-cache' }
}
function Health-Is([string]$Version) {
    try {
        $health = Read-Api '/api/v1/health'
        return ((Field $health 'ok') -is [bool] -and (Field $health 'ok') -eq $true -and (Field $health 'status') -eq 'ready' -and (Field $health 'version') -eq $Version)
    } catch { return $false }
}
function Wait-Health([string]$Version) {
    $watch = [Diagnostics.Stopwatch]::StartNew()
    do {
        if (Health-Is $Version) { return $true }
        Start-Sleep -Milliseconds 300
    } while ($watch.Elapsed.TotalSeconds -lt 45)
    return $false
}
function Require-Array($Value, [string]$Name, [string]$Code) {
    # Field() enumerates arrays in the PowerShell pipeline. Inspect the raw
    # property so missing, null, scalar and a genuine empty [] stay distinct.
    if ($null -eq $Value) { throw ("IDLE_REFUSED_" + $Code) }
    $property = $Value.PSObject.Properties[$Name]
    if ($null -eq $property -or $property.Value -isnot [System.Array]) { throw ("IDLE_REFUSED_" + $Code) }
    return ,($property.Value)
}
function Assert-Fresh($Value, [string]$Code) {
    if ($Value -isnot [string] -or $Value -notmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,7})?Z$') { throw ("IDLE_REFUSED_" + $Code) }
    try { $observedMoment = [DateTimeOffset]::Parse($Value, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::None) }
    catch { throw ("IDLE_REFUSED_" + $Code) }
    $observedAge = ([DateTimeOffset]::UtcNow - $observedMoment).TotalSeconds
    if ($observedAge -lt 0 -or $observedAge -ge 30) { throw ("IDLE_REFUSED_" + $Code) }
}
function Assert-Host-Snapshot($Snapshot, $RuntimeState) {
    $snapshotHost = Field $Snapshot 'host'
    $hostState = Field $snapshotHost 'state'
    # The V2 remote projection omits recording in RC11.4. The loopback V1
    # snapshot retains it; never substitute a missing value with false.
    $obsState = Field $RuntimeState 'obs'
    Require-Bool (Field $obsState 'connected') $true 'OBS_CONNECTED'
    Require-Bool (Field $obsState 'streamingKnown') $true 'OBS_KNOWN'
    Require-Bool (Field $obsState 'streaming') $false 'OBS_STREAMING'
    Require-Bool (Field $obsState 'recording') $false 'OBS_RECORDING'
    $projectedObs = Field $hostState 'obs'
    Require-Bool (Field $projectedObs 'connected') $true 'PROJECTED_OBS_CONNECTED'
    Require-Bool (Field $projectedObs 'streamingKnown') $true 'PROJECTED_OBS_KNOWN'
    Require-Bool (Field $projectedObs 'streaming') $false 'PROJECTED_OBS_STREAMING'
    $receipts = Require-Array $Snapshot 'receipts' 'RECEIPTS_MISSING'
    foreach ($receipt in $receipts) {
        $receiptStatus = Field $receipt 'status'
        if ($receiptStatus -ceq 'running') { throw 'IDLE_REFUSED_COMMAND_RUNNING' }
        if (@('succeeded', 'partial', 'failed', 'uncertain') -cnotcontains $receiptStatus) { throw 'IDLE_REFUSED_RECEIPT_STATUS_UNKNOWN' }
    }
    foreach ($platform in @('twitch', 'youtube')) {
        $platformCode = $platform.ToUpperInvariant()
        $outputState = Field (Field $snapshotHost 'outputStatus') $platform
        $liveState = Field (Field $snapshotHost 'platforms') $platform
        Require-Bool (Field $outputState 'active') $false "OUTPUT_$platformCode"
        Require-Bool (Field $liveState 'live') $false "LIVE_$platformCode"
        Assert-Fresh (Field $outputState 'observedAt') "OUTPUT_STALE_$platformCode"
        Assert-Fresh (Field $liveState 'observedAt') "LIVE_STALE_$platformCode"
        if ((Field $outputState 'error') -or (Field $liveState 'error')) { throw 'IDLE_REFUSED_PLATFORM_OBSERVATION_ERROR' }
    }
    $hub = Field $snapshotHost 'controlHub'
    if ($null -eq $hub) { $hub = Field $hostState 'controlHub' }
    if ($null -eq $hub) { $hub = Field $RuntimeState 'controlHub' }
    Require-Bool (Field (Field $hub 'live') 'isLive') $false 'CONTROL_HUB'
    $configuration = Field $Snapshot 'configuration'
    $revision = Field $configuration 'revision'
    if (($revision -isnot [int] -and $revision -isnot [long]) -or $revision -lt 0) { throw 'IDLE_REFUSED_CONFIGURATION_UNKNOWN' }
    foreach ($platform in @('twitch', 'youtube')) {
        $target = Field (Field $configuration 'outputs') $platform
        if (@('main', 'output', 'aitum-suite', 'unconfigured') -cnotcontains (Field $target 'kind')) { throw 'IDLE_REFUSED_CONFIGURATION_UNKNOWN' }
        if ((Field $target 'name') -isnot [string]) { throw 'IDLE_REFUSED_CONFIGURATION_UNKNOWN' }
    }
    return $configuration
}
function Assert-Output-Inventory($Inventory, $Configuration) {
    $nativeOutputs = Require-Array $Inventory 'outputs' 'NATIVE_OUTPUTS_MISSING'
    # The legacy endpoint maps a failed GetOutputList to []. It is not proof
    # that all streams stopped, even when the Aitum half of the request worked.
    if ($nativeOutputs.Count -eq 0) { throw 'IDLE_REFUSED_NATIVE_OUTPUTS_EMPTY' }
    foreach ($nativeOutput in $nativeOutputs) {
        $nativeName = Field $nativeOutput 'outputName'
        $nativeActive = Field $nativeOutput 'outputActive'
        $serviceFlag = Field (Field $nativeOutput 'outputFlags') 'OBS_OUTPUT_SERVICE'
        if ($nativeName -isnot [string] -or [string]::IsNullOrWhiteSpace($nativeName)) { throw 'IDLE_REFUSED_NATIVE_OUTPUT_NAME_UNKNOWN' }
        if ($nativeActive -isnot [bool] -or $serviceFlag -isnot [bool]) { throw 'IDLE_REFUSED_NATIVE_OUTPUT_STATE_UNKNOWN' }
        if ($serviceFlag) { Require-Bool $nativeActive $false 'NATIVE_SERVICE_ACTIVE' }
    }
    $suite = Field $Inventory 'streamSuite'
    if ($null -eq $suite -or (Field $suite 'error')) { throw 'IDLE_REFUSED_AITUM_UNAVAILABLE' }
    $suiteVersion = Field $suite 'version'
    if ($suiteVersion -isnot [string] -or [string]::IsNullOrWhiteSpace($suiteVersion)) { throw 'IDLE_REFUSED_AITUM_VERSION_UNKNOWN' }
    $suiteOutputs = Require-Array $suite 'outputs' 'AITUM_OUTPUTS_MISSING'
    $suiteStreams = 0
    foreach ($suiteOutput in $suiteOutputs) {
        $suiteName = Field $suiteOutput 'name'
        $suiteType = Field $suiteOutput 'type'
        $suiteActive = Field $suiteOutput 'active'
        if ($suiteName -isnot [string] -or [string]::IsNullOrWhiteSpace($suiteName) -or $suiteType -isnot [string] -or [string]::IsNullOrWhiteSpace($suiteType) -or $suiteActive -isnot [bool]) { throw 'IDLE_REFUSED_AITUM_OUTPUT_STATE_UNKNOWN' }
        # Inspect every Aitum stream, including destinations not selected in
        # Dashboard. Other output types cannot substitute for a named stream.
        if ($suiteType -ceq 'stream') { Require-Bool $suiteActive $false 'AITUM_STREAM_ACTIVE'; $suiteStreams++ }
    }
    foreach ($platform in @('twitch', 'youtube')) {
        $target = Field (Field $Configuration 'outputs') $platform
        $targetKind = Field $target 'kind'
        $targetName = Field $target 'name'
        if ($targetKind -ceq 'output') {
            $selectedOutputs = @($nativeOutputs | Where-Object { (Field $_ 'outputName') -ceq $targetName })
            if ($selectedOutputs.Count -ne 1) { throw 'IDLE_REFUSED_SELECTED_NATIVE_OUTPUT_UNKNOWN' }
            Require-Bool (Field (Field $selectedOutputs[0] 'outputFlags') 'OBS_OUTPUT_SERVICE') $true 'SELECTED_NATIVE_NOT_SERVICE'
            Require-Bool (Field $selectedOutputs[0] 'outputActive') $false 'SELECTED_NATIVE_ACTIVE'
        } elseif ($targetKind -ceq 'aitum-suite') {
            $selectedOutputs = @($suiteOutputs | Where-Object { (Field $_ 'name') -ceq $targetName -and (Field $_ 'type') -ceq 'stream' })
            if ($selectedOutputs.Count -ne 1) { throw 'IDLE_REFUSED_SELECTED_AITUM_OUTPUT_UNKNOWN' }
            Require-Bool (Field $selectedOutputs[0] 'active') $false 'SELECTED_AITUM_ACTIVE'
        }
    }
    $result.nativeOutputCount = $nativeOutputs.Count
    $result.suiteStreamCount = $suiteStreams
}
function Assert-Idle {
    if ($Role -eq 'client') {
        if ($AuthoritativeIdleAt -notmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,7})?Z$') { throw 'HOST_IDLE_PROOF_REQUIRED' }
        $proof = [DateTimeOffset]::Parse($AuthoritativeIdleAt, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::None)
        $age = ([DateTimeOffset]::UtcNow - $proof).TotalSeconds
        if ($age -lt 0 -or $age -ge 30) { throw 'HOST_IDLE_PROOF_EXPIRED' }
        $result.idleVerifiedAt = $AuthoritativeIdleAt
        return
    }
    try { $before = Read-Api '/api/v2/state'; $runtimeBefore = Read-Api '/api/v1/state' }
    catch { throw 'IDLE_REFUSED_STATE_READ_FAILED' }
    $configurationBefore = Assert-Host-Snapshot $before $runtimeBefore
    $inventoryAge = [Diagnostics.Stopwatch]::StartNew()
    try { $inventory = Read-Api '/api/v2/outputs' }
    catch { throw 'IDLE_REFUSED_OUTPUTS_READ_FAILED' }
    Assert-Output-Inventory $inventory $configurationBefore
    # Re-read after inventory I/O: a command or recording may have begun during
    # that request. A changed configuration also invalidates the observation.
    try { $after = Read-Api '/api/v2/state'; $runtimeAfter = Read-Api '/api/v1/state' }
    catch { throw 'IDLE_REFUSED_FINAL_STATE_READ_FAILED' }
    $configurationAfter = Assert-Host-Snapshot $after $runtimeAfter
    if (($configurationBefore | ConvertTo-Json -Compress -Depth 12) -cne ($configurationAfter | ConvertTo-Json -Compress -Depth 12)) { throw 'IDLE_REFUSED_CONFIGURATION_CHANGED' }
    if ($inventoryAge.Elapsed.TotalSeconds -ge 5) { throw 'IDLE_REFUSED_OUTPUTS_STALE' }
    Assert-Obs-Unchanged
    $result.idleVerifiedAt = [DateTime]::UtcNow.ToString('o')
}
function Runtime-Processes {
    @(Get-CimInstance Win32_Process | Where-Object {
        $_.ExecutablePath -and $_.ExecutablePath.StartsWith($activeRuntime + '\', [StringComparison]::OrdinalIgnoreCase)
    })
}
function Obs-Ids {
    @(Get-CimInstance Win32_Process -Filter "Name='obs64.exe' OR Name='obs32.exe' OR Name='obs.exe'" | ForEach-Object { [int]$_.ProcessId } | Sort-Object)
}
function Assert-Obs-Unchanged {
    if ((@(Obs-Ids) -join ',') -ne ($result.obsBefore -join ',')) { throw 'OBS_PROCESS_CHANGED' }
}
function Close-Dashboard {
    $processes = @(Runtime-Processes)
    $main = @($processes | Where-Object { $_.ExecutablePath -ieq $activeExe -and $_.CommandLine -and $_.CommandLine -notmatch '--type=' })
    if ($main.Count -ne 1) { throw 'ONE_DASHBOARD_MAIN_REQUIRED' }
    $window = Get-Process -Id $main[0].ProcessId
    if ($window.MainWindowHandle -eq 0) { throw 'DASHBOARD_MAIN_WINDOW_REQUIRED' }
    Assert-Idle
    if (-not $window.CloseMainWindow()) { throw 'DASHBOARD_CLOSE_REFUSED' }
    $watch = [Diagnostics.Stopwatch]::StartNew()
    while (-not $window.HasExited) {
        if ($watch.Elapsed.TotalSeconds -ge 20) { throw 'DASHBOARD_MAIN_STILL_RUNNING' }
        Start-Sleep -Milliseconds 250
        $window.Refresh()
    }
    $watch.Restart()
    while (@(Runtime-Processes).Count -gt 0) {
        if ($watch.Elapsed.TotalSeconds -ge 15) { throw 'DASHBOARD_CHILD_STILL_RUNNING' }
        Start-Sleep -Milliseconds 250
    }
}
function Sha([string]$Path) { (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
function Assert-Runtime-Hashes([string]$Directory) {
    if ((Sha (Join-Path $Directory 'StreamDashboard.exe')) -ine $ExpectedExeSha) { throw 'EXE_HASH_MISMATCH' }
    if ((Sha (Join-Path $Directory 'resources\app.asar')) -ine $ExpectedAsarSha) { throw 'ASAR_HASH_MISMATCH' }
}
function Asar-Version([string]$Path) {
    # ASAR: 8-byte size pickle, header pickle (JSON length at byte 12), then data.
    $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    $reader = New-Object IO.BinaryReader($stream)
    try {
        if ($reader.ReadUInt32() -ne 4) { throw 'ASAR_HEADER_INVALID' }
        $headerSize = [long]$reader.ReadUInt32()
        if ($headerSize -lt 8 -or $headerSize -gt 16777216 -or 8 + $headerSize -gt $stream.Length) { throw 'ASAR_HEADER_INVALID' }
        $null = $reader.ReadUInt32()
        $jsonLength = [int]$reader.ReadUInt32()
        if ($jsonLength -lt 1 -or $jsonLength -gt $headerSize - 8) { throw 'ASAR_HEADER_INVALID' }
        $header = [Text.Encoding]::UTF8.GetString($reader.ReadBytes($jsonLength)) | ConvertFrom-Json
        $entry = Field (Field $header 'files') 'package.json'
        if ($null -eq $entry -or (Field $entry 'unpacked') -eq $true -or [string](Field $entry 'offset') -notmatch '^\d+$') { throw 'ASAR_PACKAGE_INVALID' }
        $length = [long](Field $entry 'size')
        $offset = [long](Field $entry 'offset')
        if ($length -lt 1 -or $length -gt 1048576 -or $offset -lt 0 -or 8 + $headerSize + $offset + $length -gt $stream.Length) { throw 'ASAR_PACKAGE_INVALID' }
        $null = $stream.Seek(8 + $headerSize + $offset, [IO.SeekOrigin]::Begin)
        $manifest = [Text.Encoding]::UTF8.GetString($reader.ReadBytes([int]$length)) | ConvertFrom-Json
        return (Field $manifest 'version')
    } finally { $reader.Dispose(); $stream.Dispose() }
}
function Backup-Profile {
    $configRoot = if ($Role -eq 'client') { Join-Path $profileRoot 'device-runtime\config' } else { Join-Path $profileRoot 'config' }
    $critical = @(Get-ChildItem -LiteralPath $configRoot -File -Force -Recurse)
    if ($critical.Count -lt 1) { throw 'CONFIG_FILES_MISSING' }
    $required = @('secure\credentials.dat')
    if ($Role -eq 'client') { $required += @('device-role.json', 'device-runtime\secure\credentials.dat') }
    elseif (Test-Path -LiteralPath (Join-Path $profileRoot 'device-role.json')) { $required += 'device-role.json' }
    foreach ($relative in $required) { $critical += Get-Item -LiteralPath (Join-Path $profileRoot $relative) }
    if (@(Get-ChildItem -LiteralPath $profileRoot -Force -Recurse | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count) { throw 'PROFILE_REPARSE_POINT' }
    $manifest = @{}
    foreach ($file in $critical) {
        if ($file.PSIsContainer) { throw 'CRITICAL_FILE_INVALID' }
        $relative = $file.FullName.Substring($profileRoot.Length + 1)
        $manifest[$relative] = Sha $file.FullName
    }
    $allFiles = @(Get-ChildItem -LiteralPath $profileRoot -File -Force -Recurse)
    & "$env:SystemRoot\System32\robocopy.exe" $profileRoot $profileBackup /E /COPY:DAT /DCOPY:DAT /R:1 /W:1 /XJ /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -lt 0 -or $LASTEXITCODE -gt 7) { throw 'PROFILE_COPY_FAILED' }
    if (@(Get-ChildItem -LiteralPath $profileBackup -File -Force -Recurse).Count -ne $allFiles.Count) { throw 'PROFILE_FILE_COUNT_MISMATCH' }
    foreach ($file in $allFiles) {
        $copy = Get-Item -LiteralPath (Join-Path $profileBackup $file.FullName.Substring($profileRoot.Length + 1))
        if ($copy.Length -ne $file.Length) { throw 'PROFILE_FILE_LENGTH_MISMATCH' }
    }
    foreach ($relative in $manifest.Keys) {
        if ((Sha (Join-Path $profileRoot $relative)) -ne $manifest[$relative] -or (Sha (Join-Path $profileBackup $relative)) -ne $manifest[$relative]) { throw 'PROFILE_CRITICAL_HASH_MISMATCH' }
    }
    $result.criticalFiles = $manifest.Count
    $result.backupVerified = $true
}
function Start-Dashboard { $null = Start-Process -FilePath $activeExe -WorkingDirectory $activeRuntime -ArgumentList "--role=$Role" -PassThru }
function Update-Shortcuts {
    $desktop = [Environment]::GetFolderPath('Desktop')
    $shell = New-Object -ComObject WScript.Shell
    try {
        $label = if ($Role -eq 'host') { 'Regie' } else { 'Jeu' }
        $linkPath = Join-Path $desktop "StreamDashboard RC11.7 $label.lnk"
        if (Test-Path -LiteralPath $linkPath) { throw 'NEW_SHORTCUT_ALREADY_EXISTS' }
        $link = $shell.CreateShortcut($linkPath)
        $link.TargetPath = $activeExe; $link.WorkingDirectory = $activeRuntime
        $link.Arguments = "--role=$Role"; $link.IconLocation = "$activeExe,0"; $link.Save()
        foreach ($oldLink in @(Get-ChildItem -LiteralPath $desktop -Filter '*StreamDashboard*RC11.4*.lnk' -File)) {
            $target = $shell.CreateShortcut($oldLink.FullName)
            if ($target.TargetPath -ieq $activeExe) {
                $archive = Join-Path $backupRoot 'shortcuts'
                $null = New-Item -ItemType Directory -Path $archive -Force
                Move-Item -LiteralPath $oldLink.FullName -Destination (Join-Path $archive $oldLink.Name)
            }
        }
    } finally { $null = [Runtime.InteropServices.Marshal]::ReleaseComObject($shell) }
}

try {
    if ($env:USERPROFILE.TrimEnd('\') -ine 'C:\Users\damie') { throw 'EXPECTED_WINDOWS_USER_REQUIRED' }
    $null = New-Item -ItemType Directory -Path $backupRoot
    $result.obsBefore = @(Obs-Ids)
    $stageItem = Get-Item -LiteralPath $StageRuntime
    if (-not $stageItem.PSIsContainer -or $stageItem.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'STAGING_DIRECTORY_INVALID' }
    $StageRuntime = $stageItem.FullName.TrimEnd('\')
    if ($StageRuntime -ieq $activeRuntime -or $StageRuntime.StartsWith($activeRuntime + '\', [StringComparison]::OrdinalIgnoreCase) -or $activeRuntime.StartsWith($StageRuntime + '\', [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetPathRoot($StageRuntime) -ine [IO.Path]::GetPathRoot($activeRuntime)) { throw 'STAGING_PATH_INVALID' }
    if (-not (Test-Path -LiteralPath $activeExe -PathType Leaf) -or -not (Test-Path -LiteralPath $profileRoot -PathType Container)) { throw 'EXISTING_INSTALLATION_REQUIRED' }
    if ((Get-Item -LiteralPath $activeRuntime).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'ACTIVE_REPARSE_POINT' }
    Assert-Runtime-Hashes $StageRuntime
    if ((Asar-Version (Join-Path $StageRuntime 'resources\app.asar')) -ne '2.0.0-rc.11.7') { throw 'STAGING_VERSION_MISMATCH' }
    if (-not (Health-Is '2.0.0-rc.11.4')) { throw 'CURRENT_RC114_HEALTH_REQUIRED' }
    $phase = 'CLOSE'
    Close-Dashboard
    $appClosed = $true
    Assert-Obs-Unchanged
    $phase = 'BACKUP'
    Backup-Profile
    Assert-Obs-Unchanged
    Assert-Runtime-Hashes $StageRuntime
    if (@(Runtime-Processes).Count) { throw 'DASHBOARD_RESTARTED_DURING_BACKUP' }
    $phase = 'SWAP'
    [IO.Directory]::Move($activeRuntime, $previousRuntime); $oldMoved = $true
    [IO.Directory]::Move($StageRuntime, $activeRuntime); $newMoved = $true
    $phase = 'BOOT'
    Start-Dashboard
    if (-not (Wait-Health '2.0.0-rc.11.7')) { throw 'RC117_BOOT_FAILED' }
    Assert-Runtime-Hashes $activeRuntime
    Assert-Obs-Unchanged
    try { Update-Shortcuts } catch { $result.shortcutWarning = 'SHORTCUT_UPDATE_INCOMPLETE' }
    $result.success = $true
    $phase = 'READY'
} catch {
    $reason = $_.Exception.Message
    $result.errorLine = $_.InvocationInfo.ScriptLineNumber
    $result.errorType = $_.Exception.GetType().Name
    $result.error = if ($reason -cmatch '^[A-Z0-9_]+$') { $reason } else { 'INSTALL_OPERATION_FAILED' }
    if ($oldMoved) {
        $result.rollback = 'PENDING'
        try {
            if (@(Runtime-Processes).Count) { Close-Dashboard }
            if (@(Runtime-Processes).Count) { throw 'ROLLBACK_PROCESS_REMAINS' }
            if (Test-Path -LiteralPath $activeRuntime) {
                if (-not $newMoved) { throw 'ROLLBACK_ACTIVE_PATH_OCCUPIED' }
                [IO.Directory]::Move($activeRuntime, $failedRuntime)
            }
            [IO.Directory]::Move($previousRuntime, $activeRuntime)
            $result.rollback = 'BINARY_RESTORED'
            Start-Dashboard
            if (Wait-Health '2.0.0-rc.11.4') { $result.rollback = 'BINARY_RESTORED_READY' }
        } catch { $result.rollback = 'BLOCKED_NO_FORCED_STOP' }
    } elseif ($appClosed -and @(Runtime-Processes).Count -eq 0) {
        try {
            Start-Dashboard
            $result.rollback = if (Wait-Health '2.0.0-rc.11.4') { 'ORIGINAL_RESTARTED_READY' } else { 'ORIGINAL_RESTART_UNCONFIRMED' }
        } catch { $result.rollback = 'ORIGINAL_RESTART_FAILED' }
    }
} finally {
    try {
        $result.obsAfter = @(Obs-Ids)
        $result.obsUnchanged = (($result.obsBefore -join ',') -eq ($result.obsAfter -join ','))
        if ($result.success -and -not $result.obsUnchanged) { $result.success = $false; $result.error = 'OBS_PROCESS_CHANGED' }
    } catch { $result.obsUnchanged = $false; $result.success = $false; $result.error = 'OBS_VERIFICATION_FAILED' }
    $result.phase = $phase
    $result.finishedAt = [DateTime]::UtcNow.ToString('o')
    $json = $result | ConvertTo-Json -Depth 6
    if (Test-Path -LiteralPath $backupRoot -PathType Container) { $json | Set-Content -LiteralPath (Join-Path $backupRoot 'installation.json') -Encoding UTF8 }
    Write-Output $json
}
if ($result.success) { exit 0 } else { exit 1 }
