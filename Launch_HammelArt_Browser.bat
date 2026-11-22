@echo off
setlocal
cd /d "%~dp0"
title HammelArt Atelier (Browser Server)
call "%~dp0Setup_HammelArt.bat" --check
if %ERRORLEVEL% NEQ 0 (
  pause
  exit /b 1
)
"%~dp0python_runtime\python.exe" "%~dp0fx_server.py" --open
if %ERRORLEVEL% NEQ 0 (
  echo.
  echo [ERROR] Server stopped unexpectedly.
  pause
)
