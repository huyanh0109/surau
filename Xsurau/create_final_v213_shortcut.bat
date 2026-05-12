set SCRIPT="%TEMP%\%RANDOM%-%RANDOM%.vbs"
echo Set oWS = WScript.CreateObject("WScript.Shell") >> %SCRIPT%
echo sLinkFile = "%USERPROFILE%\Desktop\Xsurau Manager.lnk" >> %SCRIPT%
echo Set oLink = oWS.CreateShortcut(sLinkFile) >> %SCRIPT%
echo oLink.TargetPath = "K:\Surau\Xsurau\dist_FINAL\Xsurau Manager-win32-x64\Xsurau Manager.exe" >> %SCRIPT%
echo oLink.WorkingDirectory = "K:\Surau\Xsurau\dist_FINAL\Xsurau Manager-win32-x64" >> %SCRIPT%
echo oLink.Save >> %SCRIPT%
cscript /nologo %SCRIPT%
del %SCRIPT%
