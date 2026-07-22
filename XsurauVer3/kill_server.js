const { exec } = require('child_process');

exec('powershell -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match \'server\\.js\' -and $_.CommandLine -notmatch \'kill_server\' } | Select-Object ProcessId"', (err, stdout) => {
    if (err) {
        console.error('Error running powershell:', err);
        return;
    }
    console.log('Powershell output:\n', stdout);
    const lines = stdout.split('\n');
    let killedAny = false;
    for (const line of lines) {
        const cleaned = line.trim();
        if (/^\d+$/.test(cleaned)) {
            const pid = parseInt(cleaned);
            console.log(`Killing node process PID=${pid}`);
            try {
                process.kill(pid, 'SIGKILL');
                console.log(`Killed PID=${pid} successfully.`);
                killedAny = true;
            } catch (e) {
                console.error(`Failed to kill PID=${pid}:`, e.message);
            }
        }
    }
    if (!killedAny) {
        console.log('No server.js processes found.');
    }
});
