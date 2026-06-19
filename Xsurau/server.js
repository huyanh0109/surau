require('dotenv').config({ path: 'K:/Surau/.env' });
const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const ProfileManager = require('./manager');
const AutomationEngine = require('./automation-engine');
const proxyService = require('./proxy-service');
const { registerSheetRoutes } = require('./google-sheet');
const { registerPhoneRoutes, phoneQueue } = require('./phone');
const { attachGestureWatcher, stopGestureWatcher, getActiveWatchers } = require('./gesture-watcher');

// ============================================================
// VIDEO SERVER — serve gesture captcha videos (port 17771)
// ============================================================
const VIDEO_PORT = 17771;
const RECORDINGS_DIR = path.join(__dirname, 'recordings');

function startVideoServer() {
    const srv = http.createServer((req, res) => {
        const fileName = path.basename(req.url);
        const filePath = path.join(RECORDINGS_DIR, fileName);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length');
        if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
        if (!fs.existsSync(filePath)) { res.writeHead(404); res.end('Not Found'); return; }
        const stat = fs.statSync(filePath);
        const fileSize = stat.size;
        const range = req.headers.range;
        if (range) {
            const [s, e] = range.replace(/bytes=/, '').split('-');
            const start = parseInt(s, 10);
            const end = e ? parseInt(e, 10) : fileSize - 1;
            res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${fileSize}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Content-Type': 'video/mp4' });
            fs.createReadStream(filePath, { start, end }).pipe(res);
        } else {
            res.writeHead(200, { 'Content-Length': fileSize, 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes' });
            fs.createReadStream(filePath).pipe(res);
        }
    });
    srv.on('error', e => { if (e.code !== 'EADDRINUSE') console.error('[VideoServer] Lỗi:', e.message); });
    srv.listen(VIDEO_PORT, '127.0.0.1', () => console.log(`[VideoServer] ✅ Đang serve video tại http://127.0.0.1:${VIDEO_PORT}/`));
    return srv;
}
startVideoServer();



const app = express();
const manager = new ProfileManager();
const automationEngine = new AutomationEngine(manager);
const PORT = process.env.API_PORT || 3333;

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

// Tự code logic 2FA (TOTP) không dùng thư viện ngoài để tránh lỗi đóng gói
function generateTOTP(secret) {
    try {
        const cleanedSecret = secret.replace(/\s+/g, '').toUpperCase();
        
        // Base32 Decode
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
        let bits = '';
        for (let i = 0; i < cleanedSecret.length; i++) {
            const val = alphabet.indexOf(cleanedSecret.charAt(i));
            if (val === -1) continue;
            bits += val.toString(2).padStart(5, '0');
        }
        
        const bytes = [];
        for (let i = 0; i + 8 <= bits.length; i += 8) {
            bytes.push(parseInt(bits.substr(i, 8), 2));
        }
        const key = Buffer.from(bytes);
        
        // Tính Counter (số lần 30s kể từ Epoch)
        const epoch = Math.round(Date.now() / 1000);
        const counter = Math.floor(epoch / 30);
        
        // Chuẩn bị buffer counter 8-byte (big-endian)
        const buf = Buffer.alloc(8);
        for (let i = 7; i >= 0; i--) {
            buf[i] = counter & 0xff;
            counter === 0 ? 0 : (function() {
                // Bitwise operations on large numbers need careful handling in JS, 
                // but for timestamp counter, simple shift is okay for next ~200 years.
            })();
            // For safety with large numbers, handle counter as BigInt or manually:
        }
        // Manual 8-byte big-endian counter
        let tempCounter = counter;
        const msg = Buffer.alloc(8);
        for (let i = 7; i >= 0; i--) {
            msg[i] = tempCounter & 0xff;
            tempCounter = Math.floor(tempCounter / 256);
        }

        // HMAC-SHA1
        const hmac = crypto.createHmac('sha1', key);
        const hash = hmac.update(msg).digest();
        
        // Dynamic Truncation
        const offset = hash[hash.length - 1] & 0xf;
        const binary = ((hash[offset] & 0x7f) << 24) |
                       ((hash[offset + 1] & 0xff) << 16) |
                       ((hash[offset + 2] & 0xff) << 8) |
                       (hash[offset + 3] & 0xff);
        
        const otp = binary % 1000000;
        return otp.toString().padStart(6, '0');
    } catch (e) {
        return null;
    }
}

app.post('/api/2fa/generate', (req, res) => {
    const { secrets } = req.body;
    if (!secrets || !Array.isArray(secrets)) return res.status(400).json({ error: 'Secrets must be an array' });
    
    const codes = secrets.map(s => {
        if (!s) return '—';
        const code = generateTOTP(s);
        if (code) return code;
        
        console.error(`[2FA ERROR] Secret: "${s}" failed native generation`);
        if (typeof logToFile === 'function') logToFile(`2FA ERROR: Native generation failed for secret ${s}`);
        return 'INVALID';
    });
    res.json({ codes });
});

app.delete('/api/profiles/:id', (req, res) => {
    try { manager.deleteProfile(req.params.id); res.json({ success: true }); }
    catch (e) { res.status(400).json({ error: e.message }); }
});

// ============================================================================
// ARCHIVE API
// ============================================================================

app.get('/api/archives', (req, res) => {
    res.json(manager.getArchiveGroups());
});

app.post('/api/archives', (req, res) => {
    const { profileIds, groupName } = req.body;
    try {
        const count = manager.archiveProfiles(profileIds, groupName);
        res.json({ success: true, count });
    } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/archives/restore', (req, res) => {
    const { profileIds, groupName } = req.body;
    try {
        const count = manager.restoreProfiles(profileIds, groupName);
        res.json({ success: true, count });
    } catch (e) { res.status(400).json({ error: e.message }); }
});

app.delete('/api/archives/:groupName', (req, res) => {
    try {
        const success = manager.deleteArchiveGroup(req.params.groupName);
        res.json({ success });
    } catch (e) { res.status(400).json({ error: e.message }); }
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
    if (!rotateUrl) return res.status(400).json({ error: 'Missing rotateUrl' });
    try {
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

    // Reset phone queue BEFORE running check-phone-verify so that it starts fresh
    if (automation === 'check-phone-verify') {
        try {
            phoneQueue.reset();
            console.log('[Queue] Reset phone queue before check-phone-verify run');
        } catch (e) {
            console.error('[Queue] Failed to reset queue:', e.message);
        }
    }

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

// ============================================================================
// GESTURE CAPTCHA AUTO-WATCH API
// ============================================================================

/**
 * Gắn watcher tự động Gesture Captcha cho một profile.
 * KHÔNG relaunch browser — fake camera đã có sẵn từ lúc launch.
 * POST /api/gesture-watch/start
 * { profileId }
 */
app.post('/api/gesture-watch/start', async (req, res) => {
    const { profileId } = req.body;
    if (!profileId) return res.status(400).json({ error: 'Thiếu profileId' });

    try {
        // Dừng watcher cũ nếu đang chạy
        stopGestureWatcher(profileId);

        // Lấy page từ profile đang chạy
        const running = manager.runningProfiles.get(profileId);
        if (!running) {
            // Profile chưa mở → launch bình thường (fake cam được thêm tự động bởi manager)
            console.log(`[Server] 🚀 Profile [${profileId}] chưa mở → Launch với fake camera mặc định...`);
            const savedLayout = manager.getLayoutFor?.(profileId) || null;
            const result = await manager.launchProfile(profileId, {
                windowSize: savedLayout?.windowSize || null,
                windowPosition: savedLayout?.windowPosition || null,
                scaleFactor: savedLayout?.scaleFactor || null,
            });
            // Watcher đã được tự động gắn bởi manager.launchProfile (vì có fake cam mặc định)
            res.json({ success: true, message: `Profile [${profileId}] đã được launch với fake camera & watcher tự động.` });
        } else {
            // Profile đang chạy → gắn watcher ngay vào page hiện tại (không relaunch!)
            const pages = running.context.pages();
            const page = pages[pages.length - 1];
            if (!page || page.isClosed()) {
                return res.status(400).json({ error: 'Profile đang chạy nhưng không có tab nào mở.' });
            }
            console.log(`[Server] 🤖 Gắn watcher vào profile đang chạy [${profileId}] (không relaunch)...`);
            attachGestureWatcher(page, profileId, { manager });
            res.json({ success: true, message: `Watcher đã được gắn vào profile [${profileId}] đang chạy. Sẽ tự giải captcha khi phát hiện.` });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});


/**
 * Dừng giám sát tự động Gesture Captcha.
 * POST /api/gesture-watch/stop
 * { profileId }
 */
app.post('/api/gesture-watch/stop', (req, res) => {
    const { profileId } = req.body;
    if (profileId) {
        stopGestureWatcher(profileId);
        res.json({ success: true, message: `Đã dừng auto-watch cho profile [${profileId}]` });
    } else {
        // Dừng tất cả
        const active = getActiveWatchers();
        active.forEach(id => stopGestureWatcher(id));
        res.json({ success: true, message: `Đã dừng tất cả ${active.length} watcher`, stopped: active });
    }
});

/**
 * Xem danh sách các profile đang được giám sát.
 * GET /api/gesture-watch/status
 */
app.get('/api/gesture-watch/status', (req, res) => {
    res.json({ activeWatchers: getActiveWatchers() });
});

/**
 * Doi camera gia lap sang gesture cu the NGAY LAP TUC (khong restart browser).
 * POST /api/gesture-watch/switch-cam
 * Body: { gesture: "fist" | "thumbs_up" | "finger_1" | "finger_2" | "thumbs_down" | "hand_open" }
 */
app.post('/api/gesture-watch/switch-cam', (req, res) => {
    const { gesture, profileId } = req.body || {};
    const fs = require('fs');
    const path = require('path');
    const RECORDINGS_DIR = path.join(__dirname, 'recordings');

    const VALID = ['hand_open', 'fist', 'thumbs_up', 'thumbs_down', 'finger_1', 'finger_2'];
    if (!gesture || !VALID.includes(gesture)) {
        return res.status(400).json({ success: false, error: `gesture phai la: ${VALID.join(', ')}` });
    }

    const targetPath = path.join(RECORDINGS_DIR, `${gesture}.y4m`);
    if (!fs.existsSync(targetPath)) {
        return res.status(404).json({ success: false, error: `Khong tim thay ${gesture}.y4m` });
    }

    let switchFile;
    if (profileId) {
        const profileDir = path.join(manager.profilesDataPath, profileId);
        const profileHandOpen = path.join(profileDir, 'fake_camera', 'hand_open.y4m');
        if (fs.existsSync(profileHandOpen)) {
            switchFile = profileHandOpen + '.switch';
        } else {
            const handOpenPath = path.join(RECORDINGS_DIR, 'hand_open.y4m');
            switchFile = handOpenPath + '.switch';
        }
    } else {
        const handOpenPath = path.join(RECORDINGS_DIR, 'hand_open.y4m');
        switchFile = handOpenPath + '.switch';
    }

    try {
        fs.writeFileSync(switchFile, targetPath, 'utf8');
        console.log(`[Server] Camera switched -> ${gesture} (profile: ${profileId || 'global'})`);
        // Xoa switch file sau 3s (Chrome da doc roi)
        setTimeout(() => { try { fs.unlinkSync(switchFile); } catch (e) {} }, 3000);
        res.json({ success: true, gesture, path: targetPath });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

registerSheetRoutes(app);

// Phone Routes (RentPhone sheet + in-memory queue)
registerPhoneRoutes(app);

// ============================================================================
// UI
// ============================================================================

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'ui', 'index.html')));

app.listen(PORT, () => {
    console.log(`╔══════════════════════════════════════════════════╗`);
    console.log(`║   🔥 XSURAU ANTIDETECT MANAGER v2.1.3           ║`);
    console.log(`║   Server đang chạy tại: http://localhost:3333   ║`);
    console.log(`║   Mở trình duyệt để quản lý profile!            ║`);
    console.log(`╚══════════════════════════════════════════════════╝\n`);
});
