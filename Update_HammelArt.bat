@echo off
setlocal
cd /d "%~dp0"
echo.
echo  HammelArt Atelier - Update
echo  ==========================
if not exist "%~dp0.git" (
  echo [INFO] This folder was downloaded as a ZIP rather than cloned via Git.
  echo To update cleanly without losing settings:
  echo   1. Download/extract the newest release over this folder.
  echo   2. Your "userdata" folder ^(settings, roots, cache^) stays untouched.
  pause
  exit /b 0
)

where git >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
  echo [ERROR] Git is not installed or not in PATH.
  pause
  exit /b 1
)

echo Pulling latest updates ^(preserving your userdata/ folder^)...
git pull --ff-only
if %ERRORLEVEL% NEQ 0 (
  echo.
  echo [ERROR] git pull could not fast-forward. Check local changes with "git status".
  pause
  exit /b 1
)

call "%~dp0Setup_HammelArt.bat" --check
if %ERRORLEVEL% NEQ 0 (
  echo [ERROR] Dependency refresh failed.
  pause
  exit /b 1
)

echo.
echo Update complete! All settings and library roots in userdata/ remain intact.
pause
