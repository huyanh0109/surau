const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

// Vô hiệu hóa Proxy hoàn toàn cho ứng dụng này để tránh lỗi 426
app.commandLine.appendSwitch('no-proxy-server');
app.commandLine.appendSwitch('disable-http-cache');

let logPath = path.join(__dirname, 'debug_log.txt');
function logToFile(data) {
  try { fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${data}\n`); } catch(e) {}
}

// Bắt và xử lý ngoại lệ ngầm từ Patchright/Playwright (tránh làm hiện bảng thông báo lỗi)
process.on('uncaughtException', (err) => {
    const msg = err?.stack || err?.message || String(err);
    logToFile(`[UncaughtException] ${msg}`);
    console.warn('[Main Process Handled Error]:', err?.message || String(err));
});

process.on('unhandledRejection', (reason) => {
    const msg = reason?.stack || reason?.message || String(reason);
    logToFile(`[UnhandledRejection] ${msg}`);
    console.warn('[Main Process Handled Rejection]:', reason?.message || String(reason));
});

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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 950,
    icon: path.join(__dirname, 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#090909',
      symbolColor: '#f5b000',
      height: 34
    },
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    title: "Loopy Manager",
    backgroundColor: '#050505',
  });

  const loadApp = () => {
    mainWindow.loadFile(path.join(__dirname, 'ui', 'index.html')).catch((err) => {
      logToFile(`Dashboard load failed: ${err.message}, retrying...`);
      mainWindow.loadURL('http://127.0.0.1:3334').catch(() => setTimeout(loadApp, 500));
    });
  };

  loadApp();
  
  Menu.setApplicationMenu(null);

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

function startServer() {
  logToFile('Starting embedded server.js...');
  try {
    require('./server.js');
    logToFile('Embedded server.js started successfully');
  } catch (e) {
    logToFile(`Server error: ${e.stack || e.message}`);
  }
}

app.on('ready', () => {
  logToFile('--- App Started (Port 3334) ---');
  startServer();
  createWindow();
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', function () {
  if (mainWindow === null) createWindow();
});
