$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot\..
if (!(Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 20+ est requis.' }
if (!(Test-Path node_modules)) { npm install }
npm run bootstrap -- --start
Start-Process powershell -ArgumentList '-NoExit','-Command',"Set-Location '$PWD'; npm start"
Start-Sleep -Seconds 3
Start-Process 'http://127.0.0.1:47832'
