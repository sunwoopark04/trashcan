@echo off
cd /d "%~dp0"
start "ParkTrash Server" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1"
timeout /t 2 >nul
start "" http://localhost:8000/
