@echo off
setlocal
cd /d "%~dp0"
if not exist "%~dp0StreamDashboard.exe" (
  echo StreamDashboard.exe est absent. Extrayez tout le ZIP dans ce dossier.
  pause
  exit /b 1
)
if not exist "%~dp0resources\app.asar" (
  echo resources\app.asar est absent. Extrayez tout le ZIP dans ce dossier.
  pause
  exit /b 1
)
start "" "%~dp0StreamDashboard.exe" --role=host
