param(
  [string]$Source = (Join-Path $env:APPDATA 'StreamDashboard'),
  [string]$Destination = (Join-Path $env:APPDATA 'StreamDashboard-Next')
)
$ErrorActionPreference = 'Stop'
$sourceRoot = [IO.Path]::GetFullPath($Source).TrimEnd('\')
$destinationRoot = [IO.Path]::GetFullPath($Destination).TrimEnd('\')
if ($sourceRoot -eq $destinationRoot -or $destinationRoot.StartsWith($sourceRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'La copie doit être séparée de l’installation actuelle.' }
if (Test-Path $destinationRoot) { throw 'Le dossier candidat existe déjà. Conservez-le et choisissez une nouvelle destination vide.' }
$sourceConfig = Join-Path $sourceRoot 'config\dashboard.json'
if (!(Test-Path $sourceConfig)) { throw "Configuration introuvable : $sourceConfig" }
$beforeHash = (Get-FileHash $sourceConfig -Algorithm SHA256).Hash
$configuration = Get-Content -Raw -LiteralPath $sourceConfig | ConvertFrom-Json
if (!$configuration.settings -or !$configuration.schemaVersion) { throw 'Configuration source non reconnue. Aucune modification effectuée.' }
# Read-only source; copy ciphertext stays on this Windows account and machine.
New-Item -ItemType Directory -Path $destinationRoot | Out-Null
foreach ($folder in @('config','secure','soundboard')) {
  $from = Join-Path $sourceRoot $folder
  if (Test-Path $from) { Copy-Item -LiteralPath $from -Destination (Join-Path $destinationRoot $folder) -Recurse }
}
if ((Get-FileHash $sourceConfig -Algorithm SHA256).Hash -ne $beforeHash) { throw 'La source a changé pendant la copie. Ne lancez pas cette copie ; recommencez applications fermées.' }
$configuration.remoteDevices = @()
if ($configuration.PSObject.Properties['remotePairings']) { $configuration.remotePairings = @() }
$configuration.settings.remoteEnabled = $true
foreach ($sound in $configuration.sounds) {
  if ($sound.source -and $sound.source.StartsWith($sourceRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
    $sound.source = $destinationRoot + $sound.source.Substring($sourceRoot.Length)
  }
}
$destinationConfig = Join-Path $destinationRoot 'config\dashboard.json'
[IO.File]::WriteAllText($destinationConfig, ($configuration | ConvertTo-Json -Depth 100), (New-Object Text.UTF8Encoding $false))
@{ source = $sourceRoot; sourceSha256 = $beforeHash; createdAt = (Get-Date).ToUniversalTime().ToString('o'); copiedEvents = @($configuration.planning).Count; copiedSounds = @($configuration.sounds).Count; originalPreserved = $true } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $destinationRoot 'migration-receipt.json') -Encoding UTF8
Write-Host "Copie préparée : $destinationRoot"
Write-Host 'L’ancienne version et ses données sont conservées. Fermez l’ancienne régie avant de démarrer la candidate.'
Write-Host 'Les appareils doivent être associés de nouveau. Les sources minuteur OBS restent à vérifier avant tout live.'
