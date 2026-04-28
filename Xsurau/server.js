const express = require('express');
const cors = require('cors');
const path = require('path');
const ProfileManager = require('./manager');

const app = express();
const manager = new ProfileManager();
const PORT = 1337;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'ui')));

// ============================================================================
// REST API — Dùng cho cả Electron UI lẫn Surau Automation gọi vào
// ============================================================================

// Liệt kê tất cả profile
app.get('/api/profiles', (req, res) => {
    res.json(manager.listProfiles());
});

// Lấy thông tin 1 profile
app.get('/api/profiles/:id', (req, res) => {
    const profile = manager.getProfile(req.params.id);
    if (!profile) return res.status(404).json({ error: 'Profile not found' });
    res.json(profile);
});

// Tạo profile mới
app.post('/api/profiles', (req, res) => {
    const { name, proxy, extensions } = req.body;
    const profile = manager.createProfile(name, proxy, extensions);
    res.json(profile);
});

// Cập nhật profile
app.put('/api/profiles/:id', (req, res) => {
    try {
        const updated = manager.updateProfile(req.params.id, req.body);
        res.json(updated);
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// Xóa profile
app.delete('/api/profiles/:id', (req, res) => {
    try {
        manager.deleteProfile(req.params.id);
        res.json({ success: true });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// Mở trình duyệt profile
app.post('/api/profiles/:id/launch', async (req, res) => {
    try {
        const { blockImages, startUrl } = req.body || {};
        await manager.launchProfile(req.params.id, { blockImages, startUrl });
        res.json({ success: true, status: 'running' });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// Đóng trình duyệt profile
app.post('/api/profiles/:id/close', async (req, res) => {
    try {
        await manager.closeProfile(req.params.id);
        res.json({ success: true, status: 'stopped' });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// Đóng tất cả
app.post('/api/close-all', async (req, res) => {
    await manager.closeAll();
    res.json({ success: true });
});

// Mở UI mặc định
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'ui', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`\n╔══════════════════════════════════════════════════╗`);
    console.log(`║   🔥 XSURAU ANTIDETECT MANAGER v2.0             ║`);
    console.log(`║   Server đang chạy tại: http://localhost:${PORT}   ║`);
    console.log(`║   Mở trình duyệt để quản lý profile!            ║`);
    console.log(`╚══════════════════════════════════════════════════╝\n`);
});
