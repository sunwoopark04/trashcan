@echo off
cd /d "%~dp0"
start "ParkTrash Server" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ready=$false; for($i=0;$i -lt 30;$i++){ try { $r=Invoke-WebRequest -UseBasicParsing http://localhost:8000/ -TimeoutSec 2; if($r.StatusCode -eq 200){ $ready=$true; break } } catch { Start-Sleep -Seconds 1 } }; if($ready){ Start-Process 'http://localhost:8000/' } else { Write-Host 'localhost:8000 is not responding yet.'; Read-Host 'Press Enter to close' }"
