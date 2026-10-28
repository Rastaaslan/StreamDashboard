param(
  [switch]$Monitor,
  [string]$DeviceId = 'StreamAgentLocal'
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
try {
  # Explicit process-local opt-in: no startup task, service, or registry changes.
  $env:STREAMDASHBOARD_AGENT_READONLY_OPT_IN = 'I_ACCEPT_READ_ONLY'
  $env:STREAMDASHBOARD_AGENT_DEVICE_ID = $DeviceId
  $mode = if ($Monitor) { '--monitor' } else { '--once' }
  Write-Host 'StreamAgent READ-ONLY QA (no stream/scene/audio writes).' -ForegroundColor Cyan
  if ($Monitor) { Write-Host 'Monitoring until Ctrl+C. No LAN listener is opened.' }
  & $node.Source $bundle $mode '--use-local-obs-config'
  $result = $LASTEXITCODE
} finally {
  $env:STREAMDASHBOARD_AGENT_READONLY_OPT_IN = $oldConsent
  $env:STREAMDASHBOARD_AGENT_DEVICE_ID = $oldDevice
}
if ($result -ne 0) { throw 'The read-only Agent could not reach authenticated local OBS.' }
Write-Host 'READ_ONLY_QA_PASS' -ForegroundColor Green
