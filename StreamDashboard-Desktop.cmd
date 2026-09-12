@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
if exist .env for /f "usebackq tokens=1,* delims==" %%A in (`findstr /v /b "#" .env`) do if not "%%A"=="" set "%%A=%%B"
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /r /c:":47832 .*LISTENING"') do (
  for /f "tokens=1" %%N in ('tasklist /fi "PID eq %%P" /fo csv /nh') do set "PORT_PROCESS=%%~N"
  if /i not "!PORT_PROCESS!"=="node.exe" if /i not "!PORT_PROCESS!"=="electron.exe" (
    echo Le port 47832 est utilise par !PORT_PROCESS! ^(PID %%P^). Arret refuse.
    exit /b 1
  )
  taskkill /pid %%P /t /f >nul
)
call npm run desktop:dev
