@echo off
setlocal
cd /d "%~dp0"
if /I "%~1"=="--check" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\bootstrap_runtime.ps1" -CheckOnly
  if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Setup could not finish. Please check your internet connection and retry.
    exit /b 1
  )
  exit /b 0
)
echo.
echo  HammelArt Atelier - Portable Runtime Setup
echo  ==========================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\bootstrap_runtime.ps1"
if %ERRORLEVEL% NEQ 0 (
  echo.
  echo [ERROR] Setup could not finish. Please check your internet connection and retry.
  pause
  exit /b 1
)
if /I "%~1"=="--no-pause" exit /b 0
echo.
echo Setup complete! Use Launch_HammelArt_Desktop.bat or Launch_HammelArt_Browser.bat to start.
pause
