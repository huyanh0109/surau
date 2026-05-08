const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// ============================================================
// ENV LOADING — Tìm tệp .env ở nhiều nơi
// ============================================================
const envPaths = [
    path.join(process.cwd(), '.env'),             // Bên cạnh file .exe
    path.join(__dirname, '.env'),                // Trong thư mục app
    path.join(__dirname, '..', '.env'),          // Thư mục cha (Dev mode)
    'k:\\Surau\\.env'                            // Đường dẫn tuyệt đối cố định
];

let envFound = false;
for (const p of envPaths) {
    if (fs.existsSync(p)) {
        require('dotenv').config({ path: p });
        console.log(`[ENV] Loaded from: ${p}`);
        envFound = true;
        break;
    }
}
if (!envFound) console.warn('[ENV] No .env file found in any expected location.');

const ProfileManager = require('./manager');
const AutomationEngine = require('./automation-engine');
const proxyService = require('./proxy-service');
const { registerSheetRoutes } = require('./google-sheet');
const { registerPhoneRoutes } = require('./phone');

const app = express();
const manager = new ProfileManager();
const automationEngine = new AutomationEngine(manager);
const PORT = 3333;

app.use(cors());
app.use(express.json());

// Serve Static UI
app.use(express.static(path.join(__dirname, 'ui')));

// ============================================================
// API ROUTES
// ============================================================

// PROFILES
app.get('/api/profiles', async (req, res) => {
    const profiles = await manager.listProfiles();
    res.json(profiles);
});

app.post('/api/profiles', async (req, res) => {
    const { name, proxy, extensions } = req.body;
    const profile = await manager.createProfile(name, { proxy, extensions });
    res.json(profile);
});

app.post('/api/profiles/bulk', async (req, res) => {
    const { count, prefix, proxies } = req.body;
    const results = [];
    for (let i = 1; i <= count; i++) {
        const name = `${prefix || 'Profile'} ${String(i).padStart(3, '0')}`;
        const proxy = proxies && proxies[i-1] ? proxies[i-1] : null;
        results.push(await manager.createProfile(name, { proxy }));
    }
    res.json({ success: true, count: results.length });
});

app.get('/api/profiles/:id', async (req, res) => {
    const p = await manager.getProfile(req.params.id);
    if (!p) return res.status(404).json({ error: 'Not found' });
    res.json(p);
});

app.put('/api/profiles/:id', async (req, res) => {
    const ok = await manager.updateProfile(req.params.id, req.body);
    res.json({ success: ok });
});

app.delete('/api/profiles/:id', async (req, res) => {
    const ok = await manager.deleteProfile(req.params.id);
    res.json({ success: ok });
});

app.delete('/api/profiles/all', async (req, res) => {
    const profiles = await manager.listProfiles();
    for (const p of profiles) {
        await manager.deleteProfile(p.id);
    }
    res.json({ success: true });
});

// ACTIONS
app.post('/api/profiles/:id/launch', async (req, res) => {
    try {
        const { windowSize, windowPosition, scaleFactor, proxyMode } = req.body;
        
        let launchOptions = {
            windowSize,
            windowPosition,
            scaleFactor
        };

        // Nếu dùng chế độ Global, ép proxy về 127.0.0.1:8888
        if (proxyMode === 'global') {
            launchOptions.proxy = '127.0.0.1:8888';
        }

        const browser = await manager.launchProfile(req.params.id, launchOptions);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/profiles/:id/close', async (req, res) => {
    const ok = await manager.closeProfile(req.params.id);
    res.json({ success: ok });
});

app.post('/api/close-all', async (req, res) => {
    await manager.closeAll();
    res.json({ success: true });
});

// PROXY
app.post('/api/proxy/switch', async (req, res) => {
    const { proxyUrl } = req.body;
    if (!proxyUrl) return res.status(400).json({ error: 'Missing proxyUrl' });
    
    proxyService.setTargetProxy(proxyUrl);
    res.json({ success: true, proxy: proxyUrl });
});

app.post('/api/proxy/rotate', async (req, res) => {
    const { rotateUrl } = req.body;
    if (!rotateUrl) return res.status(400).json({ error: 'Missing rotateUrl' });
    
    try {
        const result = await proxyService.rotateProxy(rotateUrl);
        res.json({ success: true, ...result });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// AUTOMATION
app.get('/api/automation', (req, res) => {
    res.json({ automations: automationEngine.getAvailableAutomations() });
});

app.post('/api/automation/run', async (req, res) => {
    const { automation, profileIds, concurrency, sheetData } = req.body;
    if (!automation || !profileIds) return res.status(400).json({ error: 'Missing params' });
    
    automationEngine.runBatch(automation, profileIds, { 
        concurrency: concurrency || 5,
        sheetData: sheetData || []
    });
    res.json({ success: true });
});

app.get('/api/automation/all/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const onLog = (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    automationEngine.on('log', onLog);
    req.on('close', () => {
        automationEngine.off('log', onLog);
    });
});

// EXTENSIONS
app.get('/api/extensions', (req, res) => {
    res.json(manager.getGlobalExtensions());
});

app.post('/api/extensions', (req, res) => {
    manager.addGlobalExtension(req.body.path);
    res.json({ success: true });
});

app.delete('/api/extensions', (req, res) => {
    manager.removeGlobalExtension(req.body.path);
    res.json({ success: true });
});

// REGISTER SUB-ROUTES
registerSheetRoutes(app);
registerPhoneRoutes(app);

// START
app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════╗
║   🔥 XSURAU ANTIDETECT MANAGER v2.0             ║
║   Server đang chạy tại: http://localhost:${PORT}   ║
║   Mở trình duyệt để quản lý profile!            ║
╚══════════════════════════════════════════════════╝
    `);
    
    // Start Proxy Service mặc định
    proxyService.startGateway(8888);
});
