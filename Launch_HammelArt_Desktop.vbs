Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
appDir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = appDir
pyw = fso.BuildPath(appDir, "python_runtime\pythonw.exe")
hashFile = fso.BuildPath(appDir, "python_runtime\.reqs_hash")
appPy = fso.BuildPath(appDir, "app_desktop.py")
setupBat = fso.BuildPath(appDir, "Setup_HammelArt.bat")
If Not fso.FileExists(pyw) Or Not fso.FileExists(hashFile) Then
    rc = sh.Run("""" & setupBat & """ --no-pause", 1, True)
    If rc = 0 Then
        sh.Run """" & pyw & """ """ & appPy & """", 1, False
    End If
Else
    sh.Run """" & pyw & """ """ & appPy & """", 1, False
End If
