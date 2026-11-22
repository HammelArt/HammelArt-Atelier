@echo off
setlocal
set "APP_DIR=%~dp0"
if "%APP_DIR:~-1%"=="\" set "APP_DIR=%APP_DIR:~0,-1%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $lnk = $ws.CreateShortcut([Environment]::GetFolderPath('Desktop') + '\HammelArt Atelier.lnk'); $lnk.TargetPath = 'wscript.exe'; $lnk.Arguments = '\"' + $env:APP_DIR + '\Launch_HammelArt_Desktop.vbs\"'; $lnk.WorkingDirectory = $env:APP_DIR; $lnk.IconLocation = $env:APP_DIR + '\assets\hammelart_gallery.ico,0'; $lnk.Description = 'HammelArt Atelier Desktop'; $lnk.Save(); Write-Host 'Created Desktop Shortcut cleanly!'"
pause
