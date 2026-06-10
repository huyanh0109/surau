@echo off
title Bo khoi dong Camera dien thoai qua ADB - Xsurau
echo =======================================================
echo     BO KHOI DONG CAMERA DIEN THOAI QUA ADB - XSURAU
echo =======================================================
echo.

echo [*] Dang kiem tra ket noi thiet bi qua ADB...
adb devices > temp_devices.txt
findstr /R /C:"[a-zA-Z0-9]" temp_devices.txt > nul
if errorlevel 1 goto no_adb
del temp_devices.txt

echo [*] Thiet bi dang ket noi:
adb devices
echo.

echo [*] Dang kiem tra ung dung DroidCam tren dien thoai...
adb shell pm list packages | findstr "com.dev47apps.droidcam" > nul
if errorlevel 1 goto phone_install_needed
goto phone_has_droidcam

:phone_install_needed
echo [!] Canh bao: Dien thoai chua duoc cai dat DroidCam!
echo [*] Dang mo Google Play Store tren dien thoai de ban cai dat...
adb shell am start -a android.intent.action.VIEW -d "market://details?id=com.dev47apps.droidcam" > nul
echo.
echo [LUU Y] Vui long nhan Nut CAI DAT (Install) DroidCam tren dien thoai.
echo Sau khi cai dat xong, hay mo DroidCam tren dien thoai len,
echo roi bam mot phim bat ky tai day de tiep tuc ket noi...
pause
goto phone_has_droidcam

:phone_has_droidcam
echo [*] Dang mo ung dung DroidCam tren dien thoai...
adb shell monkey -p com.dev47apps.droidcam -c android.intent.category.LAUNCHER 1 > nul 2>&1
ping -n 3 127.0.0.1 > nul

echo [*] Dang kiem tra DroidCam Client tren may tinh...
if not exist "C:\Program Files (x86)\DroidCam\DroidCamApp.exe" goto pc_install_needed
goto pc_has_droidcam

:pc_install_needed
echo [!] Loi: Khong tim thay DroidCam Client tren PC!
echo [*] Dang tien hanh cai dat DroidCam cho PC...
winget install dev47apps.DroidCam --accept-package-agreements --accept-source-agreements --silent
goto pc_has_droidcam

:pc_has_droidcam
echo [*] Dang khoi chay DroidCam Client va ket noi thiet bi qua USB...
start "" "C:\Program Files (x86)\DroidCam\DroidCamApp.exe" -adb

echo.
echo =======================================================
echo [OK] DA THIET LAP THANH CONG!
echo - Camera dien thoai dang duoc truyen tai sang PC.
echo - Ban co the su dung Camera nay trong Chrome hoac Xsurau.
echo =======================================================
echo.
pause
exit /b

:no_adb
echo [X] Loi: Khong tim thay thiet bi Android nao ket noi qua ADB!
echo Vui long cam cap USB va bat Go loi USB tren dien thoai.
if exist temp_devices.txt del temp_devices.txt
pause
exit /b
