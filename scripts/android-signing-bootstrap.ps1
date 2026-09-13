param(
  [string]$KeystorePath = "$HOME/.streamdashboard/streamdashboard-remote.jks",
  [string]$Repository = "Rastaaslan/StreamDashboard",
  [switch]$ConfigureGitHub
)

$ErrorActionPreference = 'Stop'

function New-Secret([int]$Bytes = 32) {
  $buffer = New-Object byte[] $Bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($buffer)
  return [Convert]::ToBase64String($buffer).TrimEnd('=').Replace('+','A').Replace('/','B')
}

$keytool = Get-Command keytool -ErrorAction SilentlyContinue
if (-not $keytool) {
  throw 'keytool introuvable. Installe Java/JDK 17+ ou ajoute son dossier bin au PATH.'
}

$folder = Split-Path -Parent $KeystorePath
New-Item -ItemType Directory -Force -Path $folder | Out-Null
if (Test-Path $KeystorePath) {
  throw "Le keystore existe déjà : $KeystorePath. Ne le remplace pas : perdre cette clé casse les mises à jour Android."
}

$storePassword = New-Secret 30
$keyPassword = New-Secret 30
$alias = 'streamdashboard-remote'

& $keytool.Source -genkeypair `
  -keystore $KeystorePath `
  -storepass $storePassword `
  -keypass $keyPassword `
  -alias $alias `
  -keyalg RSA `
  -keysize 3072 `
  -validity 10000 `
  -dname 'CN=StreamDashboard Remote, OU=Android, O=Rastaaslan, C=FR'

if ($LASTEXITCODE -ne 0 -or -not (Test-Path $KeystorePath)) {
  throw 'La génération du keystore Android a échoué.'
}

$keystoreBase64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($KeystorePath))

Write-Host ''
Write-Host 'Keystore Android permanent créé.' -ForegroundColor Green
Write-Host "Emplacement : $KeystorePath"
Write-Host 'GARDE CE FICHIER ET SES MOTS DE PASSE EN SAUVEGARDE PRIVÉE.' -ForegroundColor Yellow

if ($ConfigureGitHub) {
  $gh = Get-Command gh -ErrorAction SilentlyContinue
  if (-not $gh) { throw 'GitHub CLI (gh) est requis avec -ConfigureGitHub.' }
  & $gh.Source auth status | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'GitHub CLI n’est pas connecté. Lance gh auth login puis réessaie.' }

  $keystoreBase64 | & $gh.Source secret set ANDROID_KEYSTORE_BASE64 --repo $Repository
  $storePassword | & $gh.Source secret set ANDROID_KEYSTORE_PASSWORD --repo $Repository
  $alias | & $gh.Source secret set ANDROID_KEY_ALIAS --repo $Repository
  $keyPassword | & $gh.Source secret set ANDROID_KEY_PASSWORD --repo $Repository
  if ($LASTEXITCODE -ne 0) { throw 'Configuration des secrets GitHub incomplète.' }

  Write-Host 'Les 4 secrets GitHub de signature Android sont configurés.' -ForegroundColor Green
} else {
  Write-Host ''
  Write-Host 'Secrets GitHub à créer :'
  Write-Host '  ANDROID_KEYSTORE_BASE64'
  Write-Host '  ANDROID_KEYSTORE_PASSWORD'
  Write-Host '  ANDROID_KEY_ALIAS'
  Write-Host '  ANDROID_KEY_PASSWORD'
  Write-Host ''
  Write-Host 'Relance avec -ConfigureGitHub pour les configurer automatiquement via GitHub CLI.'
}

$backupPath = Join-Path $folder 'SIGNING-BACKUP.txt'
@"
StreamDashboard Android signing backup
Repository: $Repository
Keystore: $KeystorePath
Alias: $alias
Store password: $storePassword
Key password: $keyPassword

IMPORTANT: conserver ce fichier avec le keystore dans un stockage privé et sauvegardé.
Ne jamais les committer dans Git.
"@ | Set-Content -Encoding UTF8 $backupPath
Write-Host "Sauvegarde locale des identifiants : $backupPath" -ForegroundColor Yellow
