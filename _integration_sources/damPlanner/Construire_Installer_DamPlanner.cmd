@echo off
setlocal
cd /d "%~dp0"

where pnpm >nul 2>&1
if errorlevel 1 (
  echo [ERREUR] pnpm est introuvable.
  echo Installe/active pnpm puis relance ce fichier.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [DamPlanner] Installation des dependances...
  call pnpm install
  if errorlevel 1 (
    echo [ERREUR] pnpm install a echoue.
    pause
    exit /b 1
  )
)

echo [DamPlanner] Creation de l'installeur Windows...
call pnpm package:win
if errorlevel 1 (
  echo [ERREUR] La creation de l'installeur a echoue.
  pause
  exit /b 1
)

echo.
echo Terminé.
echo Cherche "DamPlanner Setup.exe" dans le dossier de sortie genere par electron-builder,
echo puis lance l'installeur. L'application pourra ensuite etre ouverte comme un logiciel Windows normal.
pause
