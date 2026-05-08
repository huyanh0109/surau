const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

// Vô hiệu hóa Proxy hoàn toàn cho ứng dụng này để tránh lỗi 426
app.commandLine.appendSwitch('no-proxy-server');
app.commandLine.appendSwitch('disable-http-cache');

let mainWindow;
let serverProcess;

const logPath = 'G:\\XsurauData\\server_log.txt';
function logToFile(data) {
  fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${data}\n`);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 950,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    title: "Xsurau Antidetect Manager",
    backgroundColor: '#050505',
  });

  const loadApp = () => {
    // Chuyển sang Port 3333 để tránh bị chặn
    mainWindow.loadURL('http://127.0.0.1:3333').catch(() => {
      logToFile('Dashboard load failed, retrying...');
      setTimeout(loadApp, 2000);
    });
  };

  loadApp();
  
  Menu.setApplicationMenu(null);

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

function startServer() {
  logToFile('Starting server on port 3333...');
  
  serverProcess = spawn('node', ['server.js'], {
    cwd: __dirname,
    env: { ...process.env, NODE_ENV: 'production' }
  });

  serverProcess.stdout.on('data', (data) => {
    logToFile(`STDOUT: ${data}`);
  });

  serverProcess.stderr.on('data', (data) => {
    logToFile(`STDERR: ${data}`);
  });

  serverProcess.on('error', (err) => {
    logToFile(`ERROR: ${err.message}`);
  });

  serverProcess.on('exit', (code) => {
    logToFile(`Server exited with code ${code}`);
  });
}

app.on('ready', () => {
  if (!fs.existsSync('G:\\XsurauData')) fs.mkdirSync('G:\\XsurauData', { recursive: true });
  fs.writeFileSync(logPath, '--- App Started (Port 3333) ---\n');
  
  startServer();
  createWindow();
});

app.on('window-all-closed', function () {
  if (serverProcess) serverProcess.kill();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', function () {
  if (mainWindow === null) createWindow();
});
