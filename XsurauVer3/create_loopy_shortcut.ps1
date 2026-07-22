$desktop = [System.IO.Path]::Combine($env:USERPROFILE, "Desktop")

# Remove old shortcuts
Get-ChildItem -Path $desktop -Filter "*Xsurau*" -ErrorAction SilentlyContinue | Remove-Item -Force
Get-ChildItem -Path $desktop -Filter "*Loopy*" -ErrorAction SilentlyContinue | Remove-Item -Force

# Create new Loopy Manager shortcut
$ws = New-Object -ComObject WScript.Shell
$shortcutPath = Join-Path $desktop "Loopy Manager.lnk"
$shortcut = $ws.CreateShortcut($shortcutPath)

$exePath = "K:\Surau\Loopy\dist_LOOPY_V3\Loopy Manager-win32-x64\Loopy Manager.exe"
if (Test-Path $exePath) {
    $shortcut.TargetPath = $exePath
    $shortcut.WorkingDirectory = "K:\Surau\Loopy\dist_LOOPY_V3\Loopy Manager-win32-x64"
    $shortcut.IconLocation = "K:\Surau\Loopy\icon.ico, 0"
} else {
    $shortcut.TargetPath = "powershell.exe"
    $shortcut.Arguments = "-NoExit -Command `"cd K:\Surau\Loopy; npm start`""
    $shortcut.WorkingDirectory = "K:\Surau\Loopy"
    $shortcut.IconLocation = "K:\Surau\Loopy\icon.ico, 0"
}

$shortcut.Description = "Loopy Antidetect Manager v3.0.0"
$shortcut.Save()

Write-Output "Loopy Manager Desktop Shortcut created successfully at: $shortcutPath"
