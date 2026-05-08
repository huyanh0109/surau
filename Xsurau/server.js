const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const ProfileManager = require('./manager');
const AutomationEngine = require('./automation-engine');
const proxyService = require('./proxy-service');
const { registerSheetRoutes } = require('./google-sheet');
const { registerPhoneRoutes } = require('./phone');

const { authenticator } = require('otplib');

const app = express();
const manager = new ProfileManager();
const automationEngine = new AutomationEngine(manager);
const PORT = 3333;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'ui')));

// Khởi động proxy gateway global
proxyService.startServer().catch(console.error);

// SSE clients cho log streaming real-time
const sseClients = new Map(); // key: automationName | 'all'
automationEngine.on('log', ({ automationName, time, msg, level }) => {
    const clients = sseClients.get(automationName) || [];
    const data = JSON.stringify({ time, msg, level });
    clients.forEach(res => { try { res.write(`data: ${data}\n\n`); } catch { } });

    const allClients = sseClients.get('all') || [];
    const broadcastData = JSON.stringify({ automationName, time, msg, level });
    allClients.forEach(res => { try { res.write(`data: ${broadcastData}\n\n`); } catch { } });
});

// ============================================================================
// PROFILE API
// ============================================================================

app.get('/api/profiles', (req, res) => res.json(manager.listProfiles()));

app.get('/api/profiles/:id', (req, res) => {
    const profile = manager.getProfile(req.params.id);
    if (!profile) return res.status(404).json({ error: 'Profile not found' });
    res.json(profile);
});

app.post('/api/profiles', (req, res) => {
    const { name, proxy, extensions } = req.body;
    res.json(manager.createProfile(name, proxy, extensions));
});

app.put('/api/profiles/:id', (req, res) => {
    try { res.json(manager.updateProfile(req.params.id, req.body)); }
    catch (e) { res.status(400).json({ error: e.message }); }
});

app.delete('/api/profiles/all', async (req, res) => {
    try { 
        const count = await manager.deleteAllProfiles();
        res.json({ success: true, count }); 
    }
    catch (e) { res.status(400).json({ error: e.message }); }
});

// Sinh mã 2FA thời gian thực
app.post('/api/2fa/generate', (req, res) => {
    const { secrets } = req.body;
    if (!secrets || !Array.isArray(secrets)) return res.status(400).json({ error: 'Secrets must be an array' });
    
    const codes = secrets.map(s => {
        if (!s) return '—';
        try {
            return authenticator.generate(s.replace(/\s+/g, ''));
        } catch (e) { return 'INVALID'; }
    });
    res.json({ codes });
});

app.delete('/api/profiles/:id', (req, res) => {
    try { manager.deleteProfile(req.params.id); res.json({ success: true }); }
    catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/profiles/bulk', (req, res) => {
    const { count, namePrefix, proxies } = req.body;
    if (!count || count < 1 || count > 500) return res.status(400).json({ error: 'Số lượng từ 1-500' });
    const profiles = manager.bulkCreateProfiles(count, namePrefix || 'Profile', proxies || []);
    res.json({ success: true, count: profiles.length, profiles });
});

app.post('/api/profiles/:id/launch', async (req, res) => {
    try {
        const { blockImages, startUrl, windowSize, windowPosition, scaleFactor, proxyMode } = req.body || {};
        const result = await manager.launchProfile(req.params.id, { blockImages, startUrl, windowSize, windowPosition, scaleFactor, proxyMode });
        // Lưu layout nếu có windowSize (mở theo grid)
        if (windowSize || windowPosition) {
            manager.saveLayout([{ profileId: req.params.id, windowSize, windowPosition, scaleFactor }]);
        }
        res.json({
            success: true, status: 'running',
            profileId: req.params.id, profileName: result.profileData.name,
            wsEndpoint: result.wsEndpoint, debugPort: result.debugPort,
            remoteDebugAddress: result.debugPort ? `127.0.0.1:${result.debugPort}` : null,
        });
    } catch (e) { res.status(400).json({ error: e.message }); }
});

// Lưu layout grid (batch: [{profileId, windowSize, windowPosition}])
app.post('/api/layout/save', (req, res) => {
    const { entries } = req.body || {};
    if (Array.isArray(entries)) manager.saveLayout(entries);
    res.json({ success: true });
});

app.post('/api/profiles/:id/close', async (req, res) => {
    try { await manager.closeProfile(req.params.id); res.json({ success: true }); }
    catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/close-all', (req, res) => {
    console.error('[DEBUG] /api/close-all được gọi! Caller:', new Error().stack.split('\n').slice(1, 3).join(' | '));
    manager.closeAll(); // Không await để trả về ngay lập tức
    res.json({ success: true });
});

// ============================================================================
// EXTENSION API
// ============================================================================

app.get('/api/extensions', (req, res) => res.json(manager.getGlobalExtensions()));
app.put('/api/extensions', (req, res) => res.json(manager.setGlobalExtensions(req.body.extensions || [])));
app.post('/api/extensions', (req, res) => {
    const { path: extPath } = req.body;
    if (!extPath) return res.status(400).json({ error: 'Thiếu đường dẫn extension' });
    res.json(manager.addGlobalExtension(extPath));
});
app.delete('/api/extensions', (req, res) => {
    const { path: extPath } = req.body;
    if (!extPath) return res.status(400).json({ error: 'Thiếu đường dẫn extension' });
    res.json(manager.removeGlobalExtension(extPath));
});

// ============================================================================
// PROXY GATEWAY API
// ============================================================================

app.post('/api/proxy/switch', async (req, res) => {
    const { proxyUrl } = req.body;
    try {
        await proxyService.switchProxy(proxyUrl, manager);
        res.json({ success: true, message: `Switched upstream to ${proxyUrl}` });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/proxy/rotate', async (req, res) => {
    const { rotateUrl } = req.body;
    try {
        const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
        const rotateRes = await fetch(rotateUrl);
        const text = await rotateRes.text();
        
        // Cần reload mạng để Chrome nhận proxy IP mới qua gateway
        await proxyService.switchProxy(proxyService.activeUpstream, manager);
        
        let responseData;
        try {
            responseData = JSON.parse(text);
        } catch (e) {
            responseData = { status: 0, message: text };
        }

        const isSuccess = responseData.status === 100;
        const displayIp = isSuccess ? responseData.ip : null;
        const displayMsg = responseData.message || text;

        console.log(`[Proxy] Status: ${responseData.status}, IP: ${displayIp}, Msg: ${displayMsg}`);
        
        res.json({ 
            success: isSuccess, 
            message: displayMsg, 
            ip: displayIp,
            raw: responseData 
        });
    } catch (e) {
        console.error(`[Proxy] Rotation error: ${e.message}`);
        res.status(500).json({ error: e.message });
    }
});

// ============================================================================
// AUTOMATION API (In-Process, Zero Latency)
// ============================================================================

app.get('/api/automation', (req, res) => {
    res.json({ automations: automationEngine.getAvailableAutomations(), status: automationEngine.getStatus() });
});

app.get('/api/automation/status', (req, res) => res.json(automationEngine.getStatus()));

app.get('/api/automation/:name/logs', (req, res) => {
    res.json(automationEngine.getLogs(req.params.name, parseInt(req.query.limit) || 200));
});

// SSE: Stream log real-time
app.get('/api/automation/:name/stream', (req, res) => {
    const { name } = req.params;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    if (!sseClients.has(name)) sseClients.set(name, []);
    sseClients.get(name).push(res);

    // Gửi log cũ ngay khi kết nối
    automationEngine.getLogs(name).forEach(entry => {
        res.write(`data: ${JSON.stringify(entry)}\n\n`);
    });

    req.on('close', () => {
        const clients = sseClients.get(name) || [];
        sseClients.set(name, clients.filter(c => c !== res));
    });
});

/**
 * Chạy automation
 * POST /api/automation/run
 * { automation, profileIds, sheetData, concurrency, blockImages, startUrl }
 */
app.post('/api/automation/run', async (req, res) => {
    const { automation, profileIds, sheetData = [], concurrency = 5, blockImages = false, startUrl } = req.body;
    if (!automation) return res.status(400).json({ error: 'Thiếu tên automation' });
    if (!profileIds?.length) return res.status(400).json({ error: 'Thiếu profileIds' });

    // Trả về ngay để UI không bị block, chạy ngầm
    res.json({ success: true, message: `Đã bắt đầu [${automation}] trên ${profileIds.length} profile` });

    automationEngine.run(automation, profileIds, sheetData, { concurrency, blockImages, startUrl })
        .then(result => {
            const ok = result.results.filter(r => r.success).length;
            automationEngine.emit('log', {
                automationName: automation, time: new Date().toISOString(),
                msg: `🏁 Kết quả cuối: ${ok}/${result.results.length} thành công`, level: 'success',
            });
        })
        .catch(err => {
            automationEngine.emit('log', {
                automationName: automation, time: new Date().toISOString(),
                msg: `💥 Lỗi nghiêm trọng: ${err.message}`, level: 'error',
            });
        });
});

app.post('/api/automation/stop', (req, res) => {
    res.json(automationEngine.stop(req.body?.automation || null));
});

// Google Sheet Routes (đọc/ghi trực tiếp Google Sheets API)
registerSheetRoutes(app);

// Phone Routes (RentPhone sheet + in-memory queue)
registerPhoneRoutes(app);

// ============================================================================
// UI
// ============================================================================

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'ui', 'index.html')));

app.listen(PORT, () => {
    console.log(`\n╔══════════════════════════════════════════════════╗`);
    console.log(`║   🔥 XSURAU ANTIDETECT MANAGER v2.0             ║`);
    console.log(`║   Server đang chạy tại: http://localhost:${PORT}   ║`);
    console.log(`║   Mở trình duyệt để quản lý profile!            ║`);
    console.log(`╚══════════════════════════════════════════════════╝\n`);
});
