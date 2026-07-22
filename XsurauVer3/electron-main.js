const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

// Vô hiệu hóa Proxy hoàn toàn cho ứng dụng này để tránh lỗi 426
app.commandLine.appendSwitch('no-proxy-server');
app.commandLine.appendSwitch('disable-http-cache');

let logPath = path.join(__dirname, 'debug_log.txt');
function logToFile(data) {
  try { fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${data}\n`); } catch(e) {}
}

logToFile('Script loaded at top level');

// KHÓA DUY NHẤT 1 BẢN CHẠY
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  logToFile('Lock not obtained, quitting');
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    logToFile('Second instance attempted');
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

let mainWindow;
let serverProcess;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 950,
    // icon: path.join(__dirname, 'icon.png'), // Removed missing icon
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
  logToFile('--- App Started (Port 3333) ---');
  
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
