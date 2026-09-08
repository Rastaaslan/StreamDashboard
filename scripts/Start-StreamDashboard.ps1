[CmdletBinding()]
param([int]$TimeoutSeconds = 25)

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $Root

# Import the simple KEY=VALUE launcher configuration without overwriting values
# explicitly supplied by the calling shell.
$envFile = Join-Path $Root '.env'
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*([^#][^=]*)=(.*)$') {
      $name, $value = $matches[1].Trim(), $matches[2].Trim()
      if (-not [Environment]::GetEnvironmentVariable($name, 'Process')) {
        [Environment]::SetEnvironmentVariable($name, $value, 'Process')
      }
    }
  }
}

$StreamToolUrl = if ($env:STREAMTOOL_URL) { $env:STREAMTOOL_URL.TrimEnd('/') } else { 'http://127.0.0.1:47830' }
$DamPlannerUrl = if ($env:DAMPLANNER_URL) { $env:DAMPLANNER_URL.TrimEnd('/') } else { 'http://127.0.0.1:47831' }
$PublicUrl = if ($env:PUBLIC_URL) { $env:PUBLIC_URL.TrimEnd('/') } else { 'http://127.0.0.1:47832' }
$DashboardHealth = 'http://127.0.0.1:47832/api/state'
$status = [ordered]@{ OBS = $false; StreamTool = $false; damPlanner = $false; StreamDashboard = $false }

function Test-Endpoint([string]$Url) {
  try { Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 2 | Out-Null; return $true } catch { return $false }
}
function Wait-Endpoint([string]$Url) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do { if (Test-Endpoint $Url) { return $true }; Start-Sleep -Milliseconds 500 } while ((Get-Date) -lt $deadline)
  return $false
}
function Start-Detached([string]$File, [string[]]$Arguments, [string]$Directory) {
  Start-Process -FilePath $File -ArgumentList $Arguments -WorkingDirectory $Directory -WindowStyle Minimized | Out-Null
}
function Start-Repository([string]$Name, [string]$HealthUrl) {
  if (Test-Endpoint $HealthUrl) { return $true }
  try {
    $bootstrapOutput = & npm run --silent bootstrap -- --project $Name --json
    $jsonLine = $bootstrapOutput | Where-Object { $_ -and $_.TrimStart().StartsWith('{') } | Select-Object -Last 1
    if (-not $jsonLine) { throw "$Name : le bootstrap n'a retourne aucune configuration JSON exploitable" }
    $json = $jsonLine | ConvertFrom-Json
    if (-not $json -or -not $json.manager -or -not $json.dir -or -not $json.args) {
      throw "$Name : configuration bootstrap incomplete"
    }
    Start-Detached ([string]$json.manager) ([string[]]$json.args) ([string]$json.dir)
    return Wait-Endpoint $HealthUrl
  } catch { Write-Warning "$Name n'a pas pu demarrer: $_"; return $false }
}

# OBS is considered active by its Windows process. A launch failure is non-fatal.
$status.OBS = $null -ne (Get-Process -Name 'obs64', 'obs32' -ErrorAction SilentlyContinue | Select-Object -First 1)
if (-not $status.OBS) {
  $obsCandidates = @($env:OBS_EXE_PATH, "$env:ProgramFiles\obs-studio\bin\64bit\obs64.exe", "${env:ProgramFiles(x86)}\obs-studio\bin\32bit\obs32.exe") | Where-Object { $_ }
  $obsExe = $obsCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($obsExe) { try { Start-Process -FilePath $obsExe -WorkingDirectory (Split-Path $obsExe) | Out-Null; Start-Sleep -Seconds 2; $status.OBS = $true } catch { Write-Warning "OBS n'a pas pu demarrer: $_" } }
  else { Write-Warning 'OBS est introuvable; les autres services vont quand meme demarrer.' }
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Warning 'Node.js 20+ est requis pour les services.' }
else {
  if (-not (Test-Path (Join-Path $Root 'node_modules'))) { try { & npm install } catch { Write-Warning "Installation npm impossible: $_" } }
  $status.StreamTool = Start-Repository 'StreamTool' "$StreamToolUrl/api/state"
  $status.damPlanner = Start-Repository 'damPlanner' "$DamPlannerUrl/api/calendar"
  if (Test-Endpoint $DashboardHealth) { $status.StreamDashboard = $true }
  else { try { Start-Detached 'npm' @('start') $Root; $status.StreamDashboard = Wait-Endpoint $DashboardHealth } catch { Write-Warning "StreamDashboard n'a pas pu demarrer: $_" } }
  if ($status.StreamDashboard) { Start-Process $PublicUrl | Out-Null }
}

Write-Host "`nEtat du setup :"
foreach ($item in $status.GetEnumerator()) { Write-Host ('{0,-19} {1}' -f ($item.Key + ' ' + ('.' * [Math]::Max(1, 17 - $item.Key.Length))), $(if ($item.Value) { 'OK' } else { 'ECHEC' })) }
if (-not $status.StreamDashboard) { Write-Warning "Dashboard indisponible; ouvrez $PublicUrl apres correction." }
