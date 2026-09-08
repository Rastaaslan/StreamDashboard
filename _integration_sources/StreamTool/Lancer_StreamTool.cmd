@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo [ERREUR] Node.js 20+ est introuvable.
  echo Installe Node.js puis relance ce fichier.
  pause
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo [ERREUR] npm est introuvable.
  pause
  exit /b 1
)

REM Installation initiale uniquement si necessaire.
if not exist "node_modules" (
  echo [StreamTool] Installation des dependances...
  call npm install
  if errorlevel 1 (
    echo [ERREUR] npm install a echoue.
    pause
    exit /b 1
  )
)

REM Build de production uniquement s'il manque.
if not exist "dist\index.js" (
  echo [StreamTool] Build initial...
  call npm run build
  if errorlevel 1 (
    echo [ERREUR] Le build a echoue.
    pause
    exit /b 1
  )
)

REM Ne lance pas une deuxieme instance si le port 8787 repond deja.
powershell -NoProfile -Command "$c=New-Object Net.Sockets.TcpClient; try{$c.Connect('127.0.0.1',8787);$c.Close();exit 0}catch{exit 1}" >nul 2>&1
if not errorlevel 1 goto OPEN_CONTROL

echo [StreamTool] Demarrage...
start "StreamTool" /min cmd.exe /c ""cd /d "%~dp0" && call npm start""

REM Laisse quelques secondes au serveur pour demarrer.
timeout /t 3 /nobreak >nul

:OPEN_CONTROL
start "" "http://127.0.0.1:8787/control/"
exit /b 0
