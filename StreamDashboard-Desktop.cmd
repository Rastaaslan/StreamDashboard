@echo off
setlocal
title StreamDashboard Desktop
cd /d "%~dp0"

if not exist package.json (
  echo [ERREUR] package.json introuvable dans %CD%
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $root=(Get-Location).Path; $envFile=Join-Path $root '.env'; if(Test-Path $envFile){ Get-Content $envFile | ForEach-Object { $line=$_.Trim(); if(!$line -or $line.StartsWith('#')){ return }; $parts=$line.Split('=',2); if($parts.Count -ne 2){ return }; $key=$parts[0].Trim(); $value=$parts[1].Trim(); if(($value.StartsWith('''') -and $value.EndsWith('''')) -or ($value.StartsWith('"') -and $value.EndsWith('"'))){ $value=$value.Substring(1,$value.Length-2) }; if($key){ [Environment]::SetEnvironmentVariable($key,$value,'Process') } } }; $listeners=@(Get-NetTCPConnection -LocalPort 47832 -State Listen -ErrorAction SilentlyContinue); foreach($listener in $listeners){ $p=Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue; if($p -and @('node','electron').Contains($p.ProcessName.ToLowerInvariant())){ Write-Host ('[INFO] Arret de l''ancien runtime StreamDashboard PID '+$p.Id); Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } elseif($p){ throw ('Le port 47832 est deja utilise par '+$p.ProcessName+' (PID '+$p.Id+').') } }; & npm.cmd run desktop:dev; exit $LASTEXITCODE"

if errorlevel 1 (
  echo.
  echo [ERREUR] StreamDashboard Desktop s'est arrete avec une erreur.
  pause
)

endlocal
