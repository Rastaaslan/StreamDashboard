# Run locally by the trusted operator, separately on FIXE and the portable.
# Never contacts OBS, starts StreamDashboard, or changes existing credentials.
[CmdletBinding(SupportsShouldProcess)]
param(
  [Parameter(Mandatory)][ValidateSet('FIXE','Portable')][string]$MachineRole,
  [Parameter(Mandatory)][ValidateSet('Install','Rollback')][string]$Action,
  [Parameter(Mandatory)][string]$InstallDir,
  [Parameter(Mandatory)][string]$ProfileDir,
  [Parameter(Mandatory)][string]$BackupDir,
  [string]$CandidateDir,
  [string]$Manifest,
  [switch]$RestoreProfile
)
$ErrorActionPreference = 'Stop'
function LocalPath([string]$Value) {
  $full = [IO.Path]::GetFullPath($Value).TrimEnd('\')
  if ($full.StartsWith('\\') -or $full -eq [IO.Path]::GetPathRoot($full).TrimEnd('\')) { throw 'A local, non-root directory is required.' }
  return $full
}
$InstallDir = LocalPath $InstallDir; $ProfileDir = LocalPath $ProfileDir; $BackupDir = LocalPath $BackupDir
foreach ($pair in @(@($InstallDir,$ProfileDir),@($InstallDir,$BackupDir),@($ProfileDir,$BackupDir))) {
  if ($pair[0] -eq $pair[1] -or $pair[0].StartsWith($pair[1]+'\',[StringComparison]::OrdinalIgnoreCase) -or $pair[1].StartsWith($pair[0]+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Installation, profile and backup directories must be disjoint.' }
}
if (Get-Process -Name 'StreamDashboard','StreamDashboard Next' -ErrorAction SilentlyContinue) { throw 'Close StreamDashboard manually first. This script never stops processes; OBS stays untouched.' }
if (!(Test-Path -LiteralPath $InstallDir -PathType Container) -or !(Test-Path -LiteralPath $ProfileDir -PathType Container)) { throw 'Existing installation and profile paths are required.' }
if ($Action -eq 'Install') {
  if (!$CandidateDir -or !$Manifest) { throw 'A qualified candidate and its SHA-256 manifest are required.' }
  $CandidateDir = LocalPath $CandidateDir
  foreach ($other in @($InstallDir,$ProfileDir,$BackupDir)) {
    if ($CandidateDir -eq $other -or $CandidateDir.StartsWith($other+'\',[StringComparison]::OrdinalIgnoreCase) -or $other.StartsWith($CandidateDir+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Candidate must be separate from installation, profile and backup.' }
  }
  if (Get-ChildItem -LiteralPath $CandidateDir -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }) { throw 'Candidate must not contain links or junctions.' }
  if (Test-Path -LiteralPath $BackupDir) { throw 'Choose a new backup directory. Existing backups are never overwritten.' }
  $proof = Get-Content -LiteralPath $Manifest -Raw | ConvertFrom-Json
  if ($proof.version -ne '2.1.0-alpha.8' -or !$proof.files.Count) { throw 'Unexpected candidate manifest.' }
  foreach ($file in $proof.files) {
    $target = [IO.Path]::GetFullPath((Join-Path $CandidateDir $file.path))
    if (!$target.StartsWith($CandidateDir+'\',[StringComparison]::OrdinalIgnoreCase) -or (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $file.sha256) { throw 'Candidate integrity verification failed.' }
  }
  $actual = @(Get-ChildItem -LiteralPath $CandidateDir -Recurse -File)
  if ($actual.Count -ne $proof.files.Count) { throw 'Candidate contains unlisted files.' }
  if (!$PSCmdlet.ShouldProcess($MachineRole, 'Back up installation and complete profile, then replace application files')) { return }
  New-Item -ItemType Directory -Path $BackupDir | Out-Null
  Copy-Item -LiteralPath $InstallDir -Destination (Join-Path $BackupDir 'installation') -Recurse -Force
  Copy-Item -LiteralPath $ProfileDir -Destination (Join-Path $BackupDir 'profile') -Recurse -Force
  @{ machine=$MachineRole; computer=$env:COMPUTERNAME; user=$env:USERNAME; install=$InstallDir; profile=$ProfileDir; version=$proof.version; created=(Get-Date).ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $BackupDir 'backup.json')
  # Preserve the original directory as well; no deleting a live installation.
  $previous = $InstallDir + '.cb199-before-' + (Get-Date -Format 'yyyyMMddHHmmss')
  Move-Item -LiteralPath $InstallDir -Destination $previous
  try { Copy-Item -LiteralPath $CandidateDir -Destination $InstallDir -Recurse -Force }
  catch { throw "Copy failed. Original installation remains at $previous; restore it manually before launching." }
} else {
  if (!(Test-Path -LiteralPath (Join-Path $BackupDir 'installation') -PathType Container) -or !(Test-Path -LiteralPath (Join-Path $BackupDir 'profile') -PathType Container)) { throw 'Incomplete backup; refusing rollback.' }
  $record = Get-Content -LiteralPath (Join-Path $BackupDir 'backup.json') -Raw | ConvertFrom-Json
  if ($record.computer -ne $env:COMPUTERNAME -or $record.user -ne $env:USERNAME -or $record.machine -ne $MachineRole -or $record.install -ne $InstallDir -or $record.profile -ne $ProfileDir) { throw 'Backup belongs to another machine, user or paths.' }
  if (!$PSCmdlet.ShouldProcess($MachineRole, 'Restore application; optionally restore profile after preserving its current state')) { return }
  $stamp = Get-Date -Format 'yyyyMMddHHmmss'
  Move-Item -LiteralPath $InstallDir -Destination ($InstallDir+'.cb199-before-rollback-'+$stamp)
  Copy-Item -LiteralPath (Join-Path $BackupDir 'installation') -Destination $InstallDir -Recurse -Force
  if ($RestoreProfile) {
    Move-Item -LiteralPath $ProfileDir -Destination ($ProfileDir+'.cb199-before-rollback-'+$stamp)
    Copy-Item -LiteralPath (Join-Path $BackupDir 'profile') -Destination $ProfileDir -Recurse -Force
  }
}
Write-Output 'Files prepared. Nothing was launched; OBS was not contacted. Verify locally before opening StreamDashboard.'
