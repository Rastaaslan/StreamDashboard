[CmdletBinding()]
param([int]$TimeoutSeconds = 25)

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $Root

$envFile = Join-Path $Root '.env'
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*([^#][^=]*)=(.*)$') {
      $name, $value = $matches[1].Trim(), $matches[2].Trim()
      if (-not [Environment]::GetEnvironmentVariable($name, 'Process')) { [Environment]::SetEnvironmentVariable($name, $value, 'Process') }
    }
  }
}
$PublicUrl = if ($env:PUBLIC_URL) { $env:PUBLIC_URL.TrimEnd('/') } else { 'http://127.0.0.1:47832' }
$HealthUrl = 'http://127.0.0.1:47832/api/state'
$status = [ordered]@{ OBS = $false; StreamDashboard = $false }

function Test-Endpoint([string]$Url) { try { Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 2 | Out-Null; return $true } catch { return $false } }
function Wait-Endpoint([string]$Url) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do { if (Test-Endpoint $Url) { return $true }; Start-Sleep -Milliseconds 500 } while ((Get-Date) -lt $deadline)
  return $false
}
function Resolve-LaunchCommand([string]$File) {
  if (($IsWindows -or $PSVersionTable.PSVersion.Major -lt 6) -and $File -in @('npm', 'pnpm', 'yarn', 'npx')) {
    $cmd = Get-Command ($File + '.cmd') -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
  }
  $resolved = Get-Command $File -ErrorAction SilentlyContinue
  if ($resolved -and $resolved.CommandType -eq 'Application') { return $resolved.Source }
  return $File
}
function Start-Detached([string]$File, [string[]]$Arguments, [string]$Directory) {
  Start-Process -FilePath (Resolve-LaunchCommand $File) -ArgumentList $Arguments -WorkingDirectory $Directory -WindowStyle Minimized | Out-Null
}

$status.OBS = $null -ne (Get-Process -Name 'obs64', 'obs32' -ErrorAction SilentlyContinue | Select-Object -First 1)
if (-not $status.OBS) {
  $candidates = @($env:OBS_EXE_PATH, "$env:ProgramFiles\obs-studio\bin\64bit\obs64.exe", "${env:ProgramFiles(x86)}\obs-studio\bin\32bit\obs32.exe") | Where-Object { $_ }
  $obsExe = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($obsExe) { try { Start-Process -FilePath $obsExe -WorkingDirectory (Split-Path $obsExe) | Out-Null; Start-Sleep -Seconds 2; $status.OBS = $true } catch { Write-Warning "OBS n'a pas pu démarrer: $_" } }
  else { Write-Warning 'OBS est introuvable; StreamDashboard reste utilisable en mode autonome.' }
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Warning 'Node.js 20+ est requis.' }
else {
  if (-not (Test-Path (Join-Path $Root 'node_modules'))) { & npm install }
  if (Test-Endpoint $HealthUrl) { $status.StreamDashboard = $true }
  else { Start-Detached 'npm' @('start') $Root; $status.StreamDashboard = Wait-Endpoint $HealthUrl }
  if ($status.StreamDashboard) { Start-Process $PublicUrl | Out-Null }
}

Write-Host "`nÉtat du cockpit :"
foreach ($item in $status.GetEnumerator()) { Write-Host ('{0,-22} {1}' -f $item.Key, $(if ($item.Value) { 'OK' } else { 'INDISPONIBLE' })) }
if (-not $status.StreamDashboard) { Write-Warning "Cockpit indisponible; consultez la fenêtre puis réessayez." }
