# Windows PowerShell 5.1. Behavioral fixtures for the RC11.7 idle guards only.
# No installer top-level code, HTTP request, process lookup, close or install runs.
# Run this on Windows before using install-rc117-damien.ps1. The slow case takes 5s.
[CmdletBinding()]
param(
    [string]$InstallerPath = (Join-Path $PSScriptRoot 'install-rc117-damien.ps1')
)
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$parseTokens = $null; $parseErrors = $null
$installerAst = [System.Management.Automation.Language.Parser]::ParseFile($InstallerPath, [ref]$parseTokens, [ref]$parseErrors)
if ($parseErrors.Count -gt 0) {
    $messages = @($parseErrors | ForEach-Object { "line $($_.Extent.StartLineNumber): $($_.Message)" })
    throw ('QA_INSTALLER_PARSE_FAILED: ' + ($messages -join '; '))
}

# Import definitions from an explicit allowlist, never dot-source the installer.
# Command/method checks catch accidental inclusion of install or process actions.
# This is a fixture harness for this repository, not a sandbox for untrusted code.
$guardNames = @('Field', 'Require-Bool', 'Require-Array', 'Assert-Fresh', 'Assert-Host-Snapshot', 'Assert-Output-Inventory', 'Assert-Idle', 'Assert-Obs-Unchanged')
$allowedCommands = $guardNames + @('Read-Api', 'Obs-Ids', 'Where-Object', 'ConvertTo-Json')
$allowedMethods = @('ToUpperInvariant', 'Parse', 'IsNullOrWhiteSpace', 'StartNew', 'ToString')
foreach ($guardName in $guardNames) {
    $definitions = @($installerAst.FindAll({
        param($node)
        $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $guardName
    }, $true))
    if ($definitions.Count -ne 1) { throw "QA_GUARD_DEFINITION_COUNT: $guardName" }
    $definition = $definitions[0]
    foreach ($command in @($definition.FindAll({ param($node) $node -is [System.Management.Automation.Language.CommandAst] }, $true))) {
        if ($allowedCommands -cnotcontains $command.GetCommandName()) { throw "QA_UNEXPECTED_GUARD_COMMAND: $guardName" }
    }
    foreach ($invocation in @($definition.FindAll({ param($node) $node -is [System.Management.Automation.Language.InvokeMemberExpressionAst] }, $true))) {
        if ($invocation.Member -isnot [System.Management.Automation.Language.StringConstantExpressionAst] -or $allowedMethods -cnotcontains $invocation.Member.Value) {
            throw "QA_UNEXPECTED_GUARD_METHOD: $guardName"
        }
    }
    . ([ScriptBlock]::Create($definition.Extent.Text))
}

function Reset-Fixtures {
    # Use ConvertFrom-Json, as Invoke-RestMethod does, to exercise [] vs null,
    # missing properties and singleton arrays under Windows PowerShell 5.1.
    $script:snapshotFixture = @'
{
  "configuration": {
    "revision": 1,
    "outputs": {
      "twitch": { "kind": "main", "name": "" },
      "youtube": { "kind": "aitum-suite", "name": "YouTube" }
    }
  },
  "receipts": [],
  "host": {
    "state": { "obs": { "connected": true, "streamingKnown": true, "streaming": false } },
    "outputStatus": {
      "twitch": { "active": false, "observedAt": "", "error": null },
      "youtube": { "active": false, "observedAt": "", "error": null }
    },
    "platforms": {
      "twitch": { "live": false, "observedAt": "", "error": null },
      "youtube": { "live": false, "observedAt": "", "error": null }
    }
  }
}
'@ | ConvertFrom-Json
    $script:runtimeFixture = @'
{
  "obs": { "connected": true, "streamingKnown": true, "streaming": false, "recording": false },
  "controlHub": { "live": { "isLive": false } }
}
'@ | ConvertFrom-Json
    $script:outputFixture = @'
{
  "outputs": [
    { "outputName": "simple_stream", "outputActive": false, "outputFlags": { "OBS_OUTPUT_SERVICE": true } },
    { "outputName": "Replay Buffer", "outputActive": true, "outputFlags": { "OBS_OUTPUT_SERVICE": false } }
  ],
  "streamSuite": {
    "version": "1.2.4",
    "error": null,
    "outputs": [
      { "name": "Twitch", "type": "stream", "active": false },
      { "name": "YouTube", "type": "stream", "active": false },
      { "name": "Unselected", "type": "stream", "active": false }
    ]
  }
}
'@ | ConvertFrom-Json
    $now = [DateTime]::UtcNow.ToString('o')
    foreach ($platform in @('twitch', 'youtube')) {
        $script:snapshotFixture.host.outputStatus.$platform.observedAt = $now
        $script:snapshotFixture.host.platforms.$platform.observedAt = $now
    }
    $script:Role = 'host'
    $script:AuthoritativeIdleAt = $null
    $script:apiCalls = New-Object 'System.Collections.Generic.List[string]'
    $script:apiReadCount = @{}
    $script:apiFailures = @{}
    $script:afterInventory = $null
    $script:inventoryDelayMs = 0
    $script:observedPids = @(6123)
    $script:result = [ordered]@{ obsBefore = @(6123); idleVerifiedAt = $null; nativeOutputCount = 0; suiteStreamCount = 0 }
}

function Copy-Fixture($Value) {
    # Each real HTTP read yields a fresh object graph. Do not let fixture changes
    # mutate configurationBefore and accidentally conceal a concurrent change.
    return ($Value | ConvertTo-Json -Depth 15 | ConvertFrom-Json)
}
function Read-Api([string]$Path) {
    $script:apiCalls.Add($Path)
    if (-not $script:apiReadCount.ContainsKey($Path)) { $script:apiReadCount[$Path] = 0 }
    $script:apiReadCount[$Path]++
    $readKey = $Path + '#' + $script:apiReadCount[$Path]
    if ($script:apiFailures.ContainsKey($readKey)) { throw 'MOCK_READ_UNAVAILABLE' }
    switch -CaseSensitive ($Path) {
        '/api/v2/state' { return (Copy-Fixture $script:snapshotFixture) }
        '/api/v1/state' { return (Copy-Fixture $script:runtimeFixture) }
        '/api/v2/outputs' {
            $reply = Copy-Fixture $script:outputFixture
            if ($script:inventoryDelayMs -gt 0) { Start-Sleep -Milliseconds $script:inventoryDelayMs }
            if ($null -ne $script:afterInventory) { $null = & $script:afterInventory }
            return $reply
        }
        default { throw 'QA_UNEXPECTED_API_PATH' }
    }
}
function Obs-Ids { return $script:observedPids }
function Assert-QA([bool]$Condition, [string]$Description) {
    if (-not $Condition) { throw ('QA_ASSERTION_FAILED: ' + $Description) }
}

$script:passedCases = New-Object 'System.Collections.Generic.List[string]'
$script:failedCases = New-Object 'System.Collections.Generic.List[object]'
function Test-IdleCase([string]$Name, [scriptblock]$Arrange, [string]$Refusal, [scriptblock]$Check) {
    try {
        Reset-Fixtures
        if ($null -ne $Arrange) { $null = & $Arrange }
        $observedError = $null
        try { Assert-Idle } catch { $observedError = $_.Exception.Message }
        if ($Refusal) {
            Assert-QA ($observedError -ceq $Refusal) "Expected $Refusal, got '$observedError'"
            Assert-QA ($null -eq $script:result.idleVerifiedAt) 'A refused case must not produce idle proof'
        } else {
            Assert-QA ($null -eq $observedError) "Expected idle, got '$observedError'"
            Assert-QA ($script:result.idleVerifiedAt -is [string]) 'Accepted case must produce idle proof'
        }
        if ($null -ne $Check) { $null = & $Check }
        $script:passedCases.Add($Name)
    } catch {
        $script:failedCases.Add([pscustomobject]@{ name = $Name; error = $_.Exception.Message })
    }
}

Test-IdleCase 'Idle host, empty receipts, active non-service replay' {} '' {
    $expectedReads = '/api/v2/state,/api/v1/state,/api/v2/outputs,/api/v2/state,/api/v1/state'
    Assert-QA (($script:apiCalls.ToArray() -join ',') -ceq $expectedReads) 'Inventory must be bracketed by both state reads'
    Assert-QA ($script:result.nativeOutputCount -eq 2 -and $script:result.suiteStreamCount -eq 3) 'Evidence must count every native output and Aitum stream'
}
Test-IdleCase 'Terminal receipt statuses remain accepted' {
    $script:snapshotFixture.receipts = @('succeeded', 'partial', 'failed', 'uncertain') | ForEach-Object { [pscustomobject]@{ status = $_ } }
}
Test-IdleCase 'Singleton arrays retain array identity' {
    $script:snapshotFixture.receipts = @([pscustomobject]@{ status = 'succeeded' })
    $script:outputFixture.outputs = @($script:outputFixture.outputs[0])
    $script:outputFixture.streamSuite.outputs = @($script:outputFixture.streamSuite.outputs[1])
} '' {
    Assert-QA ($script:result.nativeOutputCount -eq 1 -and $script:result.suiteStreamCount -eq 1) 'Singleton output arrays must not unwrap'
}
Test-IdleCase 'Confirmed empty Aitum list with no selected Aitum target' {
    $script:snapshotFixture.configuration.outputs.youtube.kind = 'unconfigured'
    $script:snapshotFixture.configuration.outputs.youtube.name = ''
    $script:outputFixture.streamSuite.outputs = @()
} '' { Assert-QA ($script:result.suiteStreamCount -eq 0) 'Real empty Aitum array must stay distinct from missing evidence' }
Test-IdleCase 'Recording is active' { $script:runtimeFixture.obs.recording = $true } 'IDLE_REFUSED_OBS_RECORDING'
Test-IdleCase 'Recording is missing from the full runtime state' { $script:runtimeFixture.obs.PSObject.Properties.Remove('recording') } 'IDLE_REFUSED_OBS_RECORDING'
Test-IdleCase 'Recording is a string, not a boolean' { $script:runtimeFixture.obs.recording = 'false' } 'IDLE_REFUSED_OBS_RECORDING'
Test-IdleCase 'OBS streaming is unknown' { $script:runtimeFixture.obs.streamingKnown = $false } 'IDLE_REFUSED_OBS_KNOWN'
Test-IdleCase 'Projected OBS streaming disagrees' { $script:snapshotFixture.host.state.obs.streaming = $true } 'IDLE_REFUSED_PROJECTED_OBS_STREAMING'
Test-IdleCase 'Control hub live proof is missing' { $script:runtimeFixture.PSObject.Properties.Remove('controlHub') } 'IDLE_REFUSED_CONTROL_HUB'
Test-IdleCase 'Running receipt' { $script:snapshotFixture.receipts = @([pscustomobject]@{ status = 'running' }) } 'IDLE_REFUSED_COMMAND_RUNNING'
Test-IdleCase 'Unknown receipt status' { $script:snapshotFixture.receipts = @([pscustomobject]@{ status = 'pending' }) } 'IDLE_REFUSED_RECEIPT_STATUS_UNKNOWN'
Test-IdleCase 'Missing receipts' { $script:snapshotFixture.PSObject.Properties.Remove('receipts') } 'IDLE_REFUSED_RECEIPTS_MISSING'
Test-IdleCase 'Null receipts' { $script:snapshotFixture.receipts = $null } 'IDLE_REFUSED_RECEIPTS_MISSING'
Test-IdleCase 'Scalar receipt must not pass as an array' { $script:snapshotFixture.receipts = [pscustomobject]@{ status = 'succeeded' } } 'IDLE_REFUSED_RECEIPTS_MISSING'
Test-IdleCase 'Legacy native failure represented as empty outputs' { $script:outputFixture.outputs = @() } 'IDLE_REFUSED_NATIVE_OUTPUTS_EMPTY'
Test-IdleCase 'Missing native outputs' { $script:outputFixture.PSObject.Properties.Remove('outputs') } 'IDLE_REFUSED_NATIVE_OUTPUTS_MISSING'
Test-IdleCase 'Null native outputs' { $script:outputFixture.outputs = $null } 'IDLE_REFUSED_NATIVE_OUTPUTS_MISSING'
Test-IdleCase 'Scalar native output' { $script:outputFixture.outputs = $script:outputFixture.outputs[0] } 'IDLE_REFUSED_NATIVE_OUTPUTS_MISSING'
Test-IdleCase 'An unselected native service is active' {
    $script:outputFixture.outputs += [pscustomobject]@{ outputName = 'Other service'; outputActive = $true; outputFlags = [pscustomobject]@{ OBS_OUTPUT_SERVICE = $true } }
} 'IDLE_REFUSED_NATIVE_SERVICE_ACTIVE'
Test-IdleCase 'Native service flag is unknown' { $script:outputFixture.outputs[0].outputFlags.OBS_OUTPUT_SERVICE = $null } 'IDLE_REFUSED_NATIVE_OUTPUT_STATE_UNKNOWN'
Test-IdleCase 'Native activity is unknown' { $script:outputFixture.outputs[0].outputActive = $null } 'IDLE_REFUSED_NATIVE_OUTPUT_STATE_UNKNOWN'
Test-IdleCase 'Native output name is missing' { $script:outputFixture.outputs[0].PSObject.Properties.Remove('outputName') } 'IDLE_REFUSED_NATIVE_OUTPUT_NAME_UNKNOWN'
Test-IdleCase 'Aitum inventory is missing' { $script:outputFixture.streamSuite = $null } 'IDLE_REFUSED_AITUM_UNAVAILABLE'
Test-IdleCase 'Aitum returned an error' { $script:outputFixture.streamSuite.error = 'MOCK_AITUM_UNAVAILABLE' } 'IDLE_REFUSED_AITUM_UNAVAILABLE'
Test-IdleCase 'Aitum version is missing' { $script:outputFixture.streamSuite.version = '' } 'IDLE_REFUSED_AITUM_VERSION_UNKNOWN'
Test-IdleCase 'Aitum outputs are missing' { $script:outputFixture.streamSuite.PSObject.Properties.Remove('outputs') } 'IDLE_REFUSED_AITUM_OUTPUTS_MISSING'
Test-IdleCase 'Aitum outputs are scalar' { $script:outputFixture.streamSuite.outputs = $script:outputFixture.streamSuite.outputs[1] } 'IDLE_REFUSED_AITUM_OUTPUTS_MISSING'
Test-IdleCase 'An unselected Aitum stream is active' { $script:outputFixture.streamSuite.outputs[2].active = $true } 'IDLE_REFUSED_AITUM_STREAM_ACTIVE'
Test-IdleCase 'An unselected Aitum stream has unknown activity' { $script:outputFixture.streamSuite.outputs[2].active = $null } 'IDLE_REFUSED_AITUM_OUTPUT_STATE_UNKNOWN'
Test-IdleCase 'Aitum output type is missing' { $script:outputFixture.streamSuite.outputs[2].PSObject.Properties.Remove('type') } 'IDLE_REFUSED_AITUM_OUTPUT_STATE_UNKNOWN'
Test-IdleCase 'Selected Aitum stream is absent' { $script:snapshotFixture.configuration.outputs.youtube.name = 'Missing' } 'IDLE_REFUSED_SELECTED_AITUM_OUTPUT_UNKNOWN'
Test-IdleCase 'Selected Aitum name is ambiguous' { $script:outputFixture.streamSuite.outputs += (Copy-Fixture $script:outputFixture.streamSuite.outputs[1]) } 'IDLE_REFUSED_SELECTED_AITUM_OUTPUT_UNKNOWN'
Test-IdleCase 'Selected Aitum output is not a stream' { $script:outputFixture.streamSuite.outputs[1].type = 'recording' } 'IDLE_REFUSED_SELECTED_AITUM_OUTPUT_UNKNOWN'
Test-IdleCase 'Selected native service is valid' {
    $script:snapshotFixture.configuration.outputs.youtube.kind = 'output'
    $script:snapshotFixture.configuration.outputs.youtube.name = 'simple_stream'
}
Test-IdleCase 'Selected native output is not a service' {
    $script:snapshotFixture.configuration.outputs.youtube.kind = 'output'
    $script:snapshotFixture.configuration.outputs.youtube.name = 'Replay Buffer'
} 'IDLE_REFUSED_SELECTED_NATIVE_NOT_SERVICE'
Test-IdleCase 'Selected native name is ambiguous' {
    $script:snapshotFixture.configuration.outputs.youtube.kind = 'output'
    $script:snapshotFixture.configuration.outputs.youtube.name = 'simple_stream'
    $script:outputFixture.outputs += (Copy-Fixture $script:outputFixture.outputs[0])
} 'IDLE_REFUSED_SELECTED_NATIVE_OUTPUT_UNKNOWN'
Test-IdleCase 'Platform output is active' { $script:snapshotFixture.host.outputStatus.twitch.active = $true } 'IDLE_REFUSED_OUTPUT_TWITCH'
Test-IdleCase 'Provider says the live is active' { $script:snapshotFixture.host.platforms.youtube.live = $true } 'IDLE_REFUSED_LIVE_YOUTUBE'
Test-IdleCase 'Platform boolean is not a boolean' { $script:snapshotFixture.host.outputStatus.youtube.active = 'false' } 'IDLE_REFUSED_OUTPUT_YOUTUBE'
Test-IdleCase 'Output observation is older than thirty seconds' { $script:snapshotFixture.host.outputStatus.youtube.observedAt = [DateTime]::UtcNow.AddSeconds(-31).ToString('o') } 'IDLE_REFUSED_OUTPUT_STALE_YOUTUBE'
Test-IdleCase 'Provider observation has a future timestamp' { $script:snapshotFixture.host.platforms.twitch.observedAt = [DateTime]::UtcNow.AddMinutes(1).ToString('o') } 'IDLE_REFUSED_LIVE_STALE_TWITCH'
Test-IdleCase 'Provider observation timestamp is missing' { $script:snapshotFixture.host.platforms.youtube.PSObject.Properties.Remove('observedAt') } 'IDLE_REFUSED_LIVE_STALE_YOUTUBE'
Test-IdleCase 'Observation carries an error despite false activity' { $script:snapshotFixture.host.outputStatus.youtube.error = 'MOCK_STALE' } 'IDLE_REFUSED_PLATFORM_OBSERVATION_ERROR'
Test-IdleCase 'Unknown output configuration' { $script:snapshotFixture.configuration.outputs.youtube.kind = 'unknown' } 'IDLE_REFUSED_CONFIGURATION_UNKNOWN'
Test-IdleCase 'Recording starts during the inventory read' {
    $script:afterInventory = { $script:runtimeFixture.obs.recording = $true }
} 'IDLE_REFUSED_OBS_RECORDING'
Test-IdleCase 'A command begins during the inventory read' {
    $script:afterInventory = { $script:snapshotFixture.receipts = @([pscustomobject]@{ status = 'running' }) }
} 'IDLE_REFUSED_COMMAND_RUNNING'
Test-IdleCase 'Configuration changes during the inventory read' {
    $script:afterInventory = { $script:snapshotFixture.configuration.revision++ }
} 'IDLE_REFUSED_CONFIGURATION_CHANGED'
Test-IdleCase 'OBS PID changes during the inventory read' {
    $script:afterInventory = { $script:observedPids = @(6124) }
} 'OBS_PROCESS_CHANGED'
Test-IdleCase 'Initial V2 state read fails' { $script:apiFailures['/api/v2/state#1'] = $true } 'IDLE_REFUSED_STATE_READ_FAILED'
Test-IdleCase 'Initial recording-state read fails' { $script:apiFailures['/api/v1/state#1'] = $true } 'IDLE_REFUSED_STATE_READ_FAILED'
Test-IdleCase 'Native and Aitum inventory read fails' { $script:apiFailures['/api/v2/outputs#1'] = $true } 'IDLE_REFUSED_OUTPUTS_READ_FAILED'
Test-IdleCase 'Final V2 state read fails' { $script:apiFailures['/api/v2/state#2'] = $true } 'IDLE_REFUSED_FINAL_STATE_READ_FAILED'
Test-IdleCase 'Final recording-state read fails' { $script:apiFailures['/api/v1/state#2'] = $true } 'IDLE_REFUSED_FINAL_STATE_READ_FAILED'
Test-IdleCase 'Inventory is at least five seconds old' { $script:inventoryDelayMs = 5100 } 'IDLE_REFUSED_OUTPUTS_STALE'
Test-IdleCase 'Client accepts fresh host proof without reading local API' {
    $script:Role = 'client'
    $script:AuthoritativeIdleAt = [DateTime]::UtcNow.ToString('o')
} '' {
    Assert-QA ($script:apiCalls.Count -eq 0) 'Client must use host proof, not local stream observations'
    Assert-QA ($script:result.idleVerifiedAt -ceq $script:AuthoritativeIdleAt) 'Client must retain the actual host timestamp'
}
Test-IdleCase 'Client rejects proof exactly thirty seconds old' {
    $script:Role = 'client'
    $script:AuthoritativeIdleAt = [DateTime]::UtcNow.AddSeconds(-30).ToString('o')
} 'HOST_IDLE_PROOF_EXPIRED'
Test-IdleCase 'Client rejects future proof' {
    $script:Role = 'client'
    $script:AuthoritativeIdleAt = [DateTime]::UtcNow.AddMinutes(1).ToString('o')
} 'HOST_IDLE_PROOF_EXPIRED'
Test-IdleCase 'Client rejects missing proof' { $script:Role = 'client' } 'HOST_IDLE_PROOF_REQUIRED'
Test-IdleCase 'Client rejects malformed proof' {
    $script:Role = 'client'
    $script:AuthoritativeIdleAt = 'not-a-timestamp'
} 'HOST_IDLE_PROOF_REQUIRED'

[ordered]@{
    version = 'sd-idle-guard-fixtures-rc11.7-v1'
    installer = $InstallerPath
    powershell = $PSVersionTable.PSVersion.ToString()
    success = ($script:failedCases.Count -eq 0)
    passedCount = $script:passedCases.Count
    failedCount = $script:failedCases.Count
    passed = $script:passedCases.ToArray()
    failures = $script:failedCases.ToArray()
    scope = 'AST parse and simulated guard behavior only; real OBS/Aitum states and installation are not exercised.'
} | ConvertTo-Json -Depth 6
if ($script:failedCases.Count -gt 0) { exit 1 } else { exit 0 }
