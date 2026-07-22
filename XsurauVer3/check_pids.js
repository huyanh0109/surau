const { exec } = require('child_process');

exec('powershell -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match \'server\\\\.js\' -and $_.CommandLine -notmatch \'kill_server\' } | ForEach-Object { $_.ProcessId.ToString() + \': \' + $_.CommandLine }"', (err, stdout) => {
    if (err) console.error(err);
    console.log('Active matching processes:\n', stdout);
});
