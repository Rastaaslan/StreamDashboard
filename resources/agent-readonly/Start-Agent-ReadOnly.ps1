param(
  [switch]$Monitor,
  [string]$DeviceId = 'StreamAgentLocal',
  [ValidateRange(0,5)][int]$RestartLimit = 3
)
$ErrorActionPreference = 'Stop'
$bundle = Join-Path $PSScriptRoot 'StreamAgent-ReadOnly.mjs'
if (!(Test-Path -LiteralPath $bundle)) { throw 'QA bundle missing.' }
if ($DeviceId -notmatch '^[A-Za-z0-9_-]{1,96}$') { throw 'Invalid device identifier.' }
$node = Get-Command node.exe -ErrorAction Stop
$version = (& $node.Source --version)
$major = [int](($version.TrimStart('v')).Split('.')[0])
if ($major -lt 22) { throw 'Node.js 22 or newer is required.' }
$oldConsent = $env:STREAMDASHBOARD_AGENT_READONLY_OPT_IN
$oldDevice = $env:STREAMDASHBOARD_AGENT_DEVICE_ID
$lock = $null
$lockPath = Join-Path $PSScriptRoot 'Agent-ReadOnly.monitor.lock'
$result = 0
try {
  # A live OS file handle, not a PID file, fences two monitoring launchers.
  # An abandoned file alone does not grant ownership; OpenOrCreate must succeed
  # with FileShare.None. No service, registry or startup task is installed.
  if ($Monitor) {
    $lock = [IO.File]::Open($lockPath,[IO.FileMode]::OpenOrCreate,
      [IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
  }
  $env:STREAMDASHBOARD_AGENT_READONLY_OPT_IN = 'I_ACCEPT_READ_ONLY'
  $env:STREAMDASHBOARD_AGENT_DEVICE_ID = $DeviceId
  $mode = if ($Monitor) { '--monitor' } else { '--once' }
  Write-Host 'StreamAgent READ-ONLY (no stream/scene/audio writes).' -ForegroundColor Cyan
  if ($Monitor) { Write-Host 'Monitoring and reconnecting until Ctrl+C. No listener without explicit mTLS configuration.' }
  $restarts = 0
  while ($true) {
    & $node.Source $bundle $mode '--use-local-obs-config'
    $result = $LASTEXITCODE
    if (!$Monitor -or $result -eq 0 -or $restarts -ge $RestartLimit) { break }
    $restarts++
    Write-Host 'Agent unavailable; bounded restart pending.' -ForegroundColor Yellow
    Start-Sleep -Milliseconds ([Math]::Min(1000 * [Math]::Pow(2,$restarts-1),5000))
  }
} finally {
  $env:STREAMDASHBOARD_AGENT_READONLY_OPT_IN = $oldConsent
  $env:STREAMDASHBOARD_AGENT_DEVICE_ID = $oldDevice
  if ($null -ne $lock) {
    $lock.Dispose()
    Remove-Item -LiteralPath $lockPath -ErrorAction SilentlyContinue
  }
}
if ($result -ne 0) { throw 'Read-only Agent unavailable after the bounded restart budget.' }
if ($Monitor) { Write-Host 'READ_ONLY_MONITOR_STOPPED' -ForegroundColor Cyan }
else { Write-Host 'READ_ONLY_QA_PASS' -ForegroundColor Green }
