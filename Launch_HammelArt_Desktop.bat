@echo off
setlocal
cd /d "%~dp0"
call "%~dp0Setup_HammelArt.bat" --check
if %ERRORLEVEL% NEQ 0 (
  pause
  exit /b 1
)
start "" "%~dp0python_runtime\pythonw.exe" "%~dp0app_desktop.py"
