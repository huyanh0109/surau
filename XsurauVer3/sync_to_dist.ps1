$src = "K:\Surau\Loopy"
$dst = "K:\Surau\Loopy\dist_LOOPY_V3\Loopy Manager-win32-x64\resources\app"

if (-not (Test-Path $dst)) {
    Write-Error "Destination directory not found: $dst"
    exit 1
}

$items = @("manager.js", "server.js", "electron-main.js", "package.json", "ui", "feed-edge", "automations")

foreach ($item in $items) {
    $s = Join-Path $src $item
    if (Test-Path $s) {
        Copy-Item -Path $s -Destination $dst -Recurse -Force
        Write-Host "Synced: $item" -ForegroundColor Green
    }
}

Write-Host "Sync completed successfully!" -ForegroundColor Cyan
