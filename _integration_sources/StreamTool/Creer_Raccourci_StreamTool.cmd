@echo off
setlocal
cd /d "%~dp0"

set "TARGET=%~dp0Lancer_StreamTool.cmd"
set "WORKDIR=%~dp0"

if not exist "%TARGET%" (
  echo [ERREUR] Lancer_StreamTool.cmd doit etre dans le meme dossier.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
"$desktop=[Environment]::GetFolderPath('Desktop');" ^
"$shell=New-Object -ComObject WScript.Shell;" ^
"$shortcut=$shell.CreateShortcut((Join-Path $desktop 'StreamTool.lnk'));" ^
"$shortcut.TargetPath=$env:TARGET;" ^
"$shortcut.WorkingDirectory=$env:WORKDIR;" ^
"$shortcut.WindowStyle=7;" ^
"$shortcut.Description='Lancer StreamTool';" ^
"$shortcut.Save()"

if errorlevel 1 (
  echo [ERREUR] Impossible de creer le raccourci.
  pause
  exit /b 1
)

echo Raccourci StreamTool cree sur le Bureau.
pause
