const { chromium } = require('patchright');
const { FingerprintGenerator } = require('fingerprint-generator');
const { injectFingerprint } = require('./fingerprint-injector');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ============================================================================
// CƠ SỞ DỮ LIỆU GPU ĐỂ RANDOMIZE WEBGL CHO MỖI PROFILE
// (Các card đồ họa phổ biến nhất trên thị trường)
// ============================================================================
const GPU_DATABASE = [
    { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) HD Graphics 520 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) HD Graphics 530 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) Iris Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 770 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 6GB Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon RX 580 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon RX 5600 XT Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon Vega 8 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)' },
];

// Database resolution phổ biến
const SCREEN_DATABASE = [
    { width: 1920, height: 1080 }, { width: 1366, height: 768 },
    { width: 1536, height: 864  }, { width: 1440, height: 900 },
    { width: 1920, height: 1200 }, { width: 2560, height: 1440 },
    { width: 1680, height: 1050 }, { width: 1600, height: 900 },
];
const HARDWARE_CONCURRENCY = [2, 4, 6, 8, 12, 16];
const DEVICE_MEMORY = [2, 4, 8];
const TIMEZONES = [
    'Asia/Ho_Chi_Minh', 'America/New_York', 'America/Chicago',
    'America/Los_Angeles', 'Europe/London', 'Europe/Berlin',
    'Asia/Tokyo', 'Asia/Singapore', 'Asia/Bangkok',
];
const LOCALES = ['vi-VN', 'en-US', 'en-GB', 'en-AU', 'ja-JP', 'de-DE'];

class ProfileManager {
    constructor(options = {}) {
        // Thay đổi thư mục lưu trữ Data sang ổ G: theo yêu cầu
        const baseDir = options.baseDir || 'G:\\XsurauData';
        this.profilesDataPath = path.join(baseDir, 'profiles_data');  // Lưu cookie, cache trình duyệt
        this.profilesMetaPath = path.join(baseDir, 'profiles_meta');  // Lưu cấu hình profile (JSON)
        this.extensionsPath = path.join(baseDir, 'extensions');       // Kho extension dùng chung
        this.settingsFile = path.join(baseDir, 'settings.json');      // Cấu hình toàn cục
        this.customChromePath = options.chromePath || 'K:\\chromium_src\\src\\out\\Xsurau\\chrome.exe';

        // Theo dõi profile đang chạy (RAM only — không cần lưu file)
        this.runningProfiles = new Map(); // profileId -> { context, pages[], pid }
        // Khóa tránh mở 2 lần cùng lúc (race condition giữa thời gian launch và runningProfiles.set)
        this.launchingProfiles = new Set(); // profileId đang trong quá trình khởi động
        // Lưu vị trí grid layout cuối cùng (dùng lại khi automation mở profile)
        this.savedLayout = {}; // profileId -> { windowSize, windowPosition }

        // Bộ sinh vân tay
        this.fingerprintGenerator = new FingerprintGenerator({
            browsers: ['chrome'],
            operatingSystems: ['windows', 'macos'],
        });

        this._initDirectories();
        this._initSettings();
    }

    _initDirectories() {
        [this.profilesDataPath, this.profilesMetaPath, this.extensionsPath].forEach(dir => {
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        });
    }

    _initSettings() {
        if (!fs.existsSync(this.settingsFile)) {
            fs.writeFileSync(this.settingsFile, JSON.stringify({
                globalExtensions: []  // Đường dẫn extension mặc định cho mọi profile
            }, null, 2));
        }
    }

    // ========================================================================
    // LAYOUT (Lưu vị trí grid để tái sử dụng khi automation mở lại)
    // ========================================================================

    /** Lưu layout grid: [{ profileId, windowSize, windowPosition, scaleFactor }] */
    saveLayout(entries) {
        for (const { profileId, windowSize, windowPosition, scaleFactor } of entries) {
            this.savedLayout[profileId] = { windowSize, windowPosition, scaleFactor };
        }
    }

    /** Lấy layout đã lưu cho 1 profile */
    getLayoutFor(profileId) {
        return this.savedLayout[profileId] || null;
    }

    // ========================================================================
    // EXTENSION TOÀN CỤC (Cài 1 lần, mọi profile tự có)
    // ========================================================================

    /** Lấy danh sách extension toàn cục */
    getGlobalExtensions() {
        const settings = JSON.parse(fs.readFileSync(this.settingsFile, 'utf8'));
        return settings.globalExtensions || [];
    }

    /** Cập nhật danh sách extension toàn cục */
    setGlobalExtensions(extensionPaths) {
        const settings = JSON.parse(fs.readFileSync(this.settingsFile, 'utf8'));
        settings.globalExtensions = extensionPaths;
        fs.writeFileSync(this.settingsFile, JSON.stringify(settings, null, 2));
        return settings.globalExtensions;
    }

    /** Thêm 1 extension vào danh sách toàn cục */
    addGlobalExtension(extPath) {
        const exts = this.getGlobalExtensions();
        if (!exts.includes(extPath)) {
            exts.push(extPath);
            this.setGlobalExtensions(exts);
        }
        return exts;
    }

    /** Xóa 1 extension khỏi danh sách toàn cục */
    removeGlobalExtension(extPath) {
        const exts = this.getGlobalExtensions().filter(e => e !== extPath);
        this.setGlobalExtensions(exts);
        return exts;
    }

    // ========================================================================
    // QUẢN LÝ PROFILE (CRUD)
    // ========================================================================

    /** Tạo profile mới */
    createProfile(name, proxy = null, extensions = []) {
        const id = 'profile_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
        const noiseSeed = crypto.randomBytes(16).toString('hex');
        const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

        // Sinh vân tay mới để lấy User-Agent ngẫu nhiên (Windows hoặc Mac)
        const fp = this.fingerprintGenerator.getFingerprint();
        let userAgent = fp.fingerprint.navigator.userAgent;
        let screen = pick(SCREEN_DATABASE);
        let hardwareConcurrency = pick(HARDWARE_CONCURRENCY);
        let deviceMemory = pick(DEVICE_MEMORY);

        const profileData = {
            id,
            name: name || id,
            createdAt: new Date().toISOString(),
            proxy,
            extensions,
            noiseSeed,
            userAgent,
            gpu: pick(GPU_DATABASE),
            screen,
            hardwareConcurrency,
            deviceMemory,
            timezone: pick(TIMEZONES),
            locale: pick(LOCALES),
            notes: ''
        };

        const metaFile = path.join(this.profilesMetaPath, `${id}.json`);
        fs.writeFileSync(metaFile, JSON.stringify(profileData, null, 2));
        console.log(`[Manager] ✅ Profile: ${profileData.name} | GPU: ${profileData.gpu.renderer.substring(0, 40)}... | Screen: ${profileData.screen.width}x${profileData.screen.height} | Cores: ${profileData.hardwareConcurrency}`);
        return profileData;
    }

    /** Tạo hàng loạt profile */
    bulkCreateProfiles(count, namePrefix = 'Profile', proxies = []) {
        const created = [];
        for (let i = 0; i < count; i++) {
            const num = String(i + 1).padStart(3, '0');
            const proxy = proxies[i] || null;
            const profile = this.createProfile(`${namePrefix} ${num}`, proxy, []);
            created.push(profile);
        }
        console.log(`[Manager] ✅ Đã tạo ${count} profile hàng loạt!`);
        return created;
    }

    /** Lấy thông tin 1 profile */
    getProfile(profileId) {
        const metaFile = path.join(this.profilesMetaPath, `${profileId}.json`);
        if (!fs.existsSync(metaFile)) return null;
        const data = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
        data.status = this.runningProfiles.has(profileId) ? 'running' : 'stopped';
        return data;
    }

    /** Liệt kê tất cả profile */
    listProfiles() {
        const files = fs.readdirSync(this.profilesMetaPath).filter(f => f.endsWith('.json'));
        return files.map(f => {
            const data = JSON.parse(fs.readFileSync(path.join(this.profilesMetaPath, f), 'utf8'));
            data.status = this.runningProfiles.has(data.id) ? 'running' : 'stopped';
            return data;
        });
    }

    /** Cập nhật profile (proxy, extensions, name, notes) */
    updateProfile(profileId, updates) {
        const metaFile = path.join(this.profilesMetaPath, `${profileId}.json`);
        if (!fs.existsSync(metaFile)) throw new Error(`Profile ${profileId} không tồn tại`);
        const data = JSON.parse(fs.readFileSync(metaFile, 'utf8'));

        if (updates.name !== undefined) data.name = updates.name;
        if (updates.proxy !== undefined) data.proxy = updates.proxy;
        if (updates.extensions !== undefined) data.extensions = updates.extensions;
        if (updates.notes !== undefined) data.notes = updates.notes;

        fs.writeFileSync(metaFile, JSON.stringify(data, null, 2));
        return data;
    }

    /** Xóa profile (xóa cả data trình duyệt) */
    deleteProfile(profileId) {
        if (this.runningProfiles.has(profileId)) {
            throw new Error('Không thể xóa profile đang chạy! Hãy đóng trước.');
        }
        const metaFile = path.join(this.profilesMetaPath, `${profileId}.json`);
        const dataDir = path.join(this.profilesDataPath, profileId);
        if (fs.existsSync(metaFile)) fs.unlinkSync(metaFile);
        if (fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
        console.log(`[Manager] 🗑️ Đã xóa profile: ${profileId}`);
    }

    /** Xóa tất cả profile (Xóa cực mạnh - WIPE ALL) */
    async deleteAllProfiles() {
        // 1. Đóng tất cả và diệt TẤT CẢ process chrome liên quan đến data folder
        await this.closeAll();
        
        // 2. Chờ một chút để giải phóng lock
        await new Promise(r => setTimeout(r, 1000));

        let count = 0;
        try {
            // Xóa sạch folder meta
            if (fs.existsSync(this.profilesMetaPath)) {
                const files = fs.readdirSync(this.profilesMetaPath);
                count = files.filter(f => f.endsWith('.json')).length;
                fs.rmSync(this.profilesMetaPath, { recursive: true, force: true });
                fs.mkdirSync(this.profilesMetaPath, { recursive: true });
            }
            // Xóa sạch folder data
            if (fs.existsSync(this.profilesDataPath)) {
                fs.rmSync(this.profilesDataPath, { recursive: true, force: true });
                fs.mkdirSync(this.profilesDataPath, { recursive: true });
            }
            console.log(`[Manager] 🔥 ĐÃ XÓA CỰC MẠNH: ${count} profile và toàn bộ dữ liệu trình duyệt.`);
        } catch (err) {
            console.error(`[Manager] ❌ Lỗi khi xóa cực mạnh: ${err.message}`);
        }
        return count;
    }

    // ========================================================================
    // KHỞI CHẠY / ĐÓNG TRÌNH DUYỆT
    // ========================================================================

    /** Mở trình duyệt với profile đã chọn */
    async launchProfile(profileId, options = {}) {
        const { blockImages = false, headless = false, startUrl = 'about:blank' } = options;

        // Nếu profile đang chạy sẵn, trả về context hiện tại — không mở lại
        if (this.runningProfiles.has(profileId)) {
            const existing = this.runningProfiles.get(profileId);
            const pages = existing.context.pages();
            const page = pages[pages.length - 1] || await existing.context.newPage();
            console.log(`[Manager] ♻️  Profile [${profileId}] đang chạy sẵn — tái sử dụng.`);
            return { context: existing.context, page, profileData: this.getProfile(profileId), wsEndpoint: null, debugPort: null };
        }

        // Nếu profile đang trong quá trình khởi động (chưa vào runningProfiles nhưng đã bắt đầu)
        // Chờ đến khi nó khởi động xong rồi tái sử dụng, không mở lại
        if (this.launchingProfiles.has(profileId)) {
            console.log(`[Manager] ⏳ Profile [${profileId}] đang khởi động... chờ.`);
            await new Promise(resolve => {
                const check = setInterval(() => {
                    if (!this.launchingProfiles.has(profileId)) {
                        clearInterval(check);
                        resolve();
                    }
                }, 200);
                setTimeout(() => { clearInterval(check); resolve(); }, 30000);
            });
            // Sau khi chờ xong, tái sử dụng context đã sẵn
            if (this.runningProfiles.has(profileId)) {
                const existing = this.runningProfiles.get(profileId);
                const pages = existing.context.pages();
                const page = pages[pages.length - 1] || await existing.context.newPage();
                return { context: existing.context, page, profileData: this.getProfile(profileId), wsEndpoint: null, debugPort: null };
            }
        }

        // Đặt khóa TRƯỚC KHI bắt đầu launch (block mọi request mở trùng profile này)
        this.launchingProfiles.add(profileId);
        try {

        const profileData = this.getProfile(profileId);
        if (!profileData) throw new Error(`Profile ${profileId} không tồn tại!`);
        
        let proxyStr = profileData.proxy;
        if (options.proxyMode === 'global') {
            proxyStr = 'http://127.0.0.1:8888';
        }
        
        const profileDir = path.join(this.profilesDataPath, profileId);
        
        // Kiểm tra xem profile đã có dữ liệu chưa (để biết là mở lần đầu hay mở lại)
        const isNewProfile = !fs.existsSync(path.join(profileDir, 'Default', 'Preferences'));

        // Đảm bảo profile cũ có đủ fingerprint data (backward compat)
        const screen = profileData.screen || { width: 1920, height: 1080 };
        const hwConcurrency = profileData.hardwareConcurrency || 8;
        const devMemory = profileData.deviceMemory || 8;
        const timezone = profileData.timezone || 'Asia/Ho_Chi_Minh';
        const locale = profileData.locale || 'vi-VN';

        // Generate a fake local IP from noiseSeed for WebRTC spoofing
        const seedInt = profileData.noiseSeed || 12345;
        const ip3 = (seedInt % 254) + 1;
        const ip4 = ((seedInt >> 8) % 254) + 1;
        const fakeLocalIp = `192.168.${ip3}.${ip4}`;

        // Resolve proxy OUTGOING IP for WebRTC spoofing
        // (DNS chỉ cho IP server, cần HTTP request qua proxy để lấy IP outgoing thực tế)
        let webrtcIp = fakeLocalIp; // fallback khi không có proxy
        if (profileData.proxy) {
            try {
                const http = require('http');
                const https = require('https');
                const { URL } = require('url');
                const proxyUrl = new URL(profileData.proxy.startsWith('http') ? profileData.proxy : `http://${profileData.proxy}`);

                // Dùng fetch qua proxy để lấy IP outgoing thực tế
                const outgoingIp = await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => reject(new Error('Timeout')), 5000);
                    const options = {
                        hostname: proxyUrl.hostname,
                        port: proxyUrl.port,
                        path: 'http://api.ipify.org',
                        method: 'GET',
                        headers: { 'Host': 'api.ipify.org' },
                    };
                    if (proxyUrl.username) {
                        options.headers['Proxy-Authorization'] = 'Basic ' + Buffer.from(`${decodeURIComponent(proxyUrl.username)}:${decodeURIComponent(proxyUrl.password || '')}`).toString('base64');
                    }
                    const req = http.request(options, (res) => {
                        let data = '';
                        res.on('data', chunk => data += chunk);
                        res.on('end', () => {
                            clearTimeout(timeout);
                            const ip = data.trim();
                            if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) {
                                resolve(ip);
                            } else {
                                reject(new Error(`Invalid IP: ${ip}`));
                            }
                        });
                    });
                    req.on('error', (e) => { clearTimeout(timeout); reject(e); });
                    req.end();
                });

                webrtcIp = outgoingIp;
                console.log(`[Manager] 🌐 WebRTC IP = ${webrtcIp} (detected via proxy)`);
            } catch (e) {
                console.log(`[Manager] ⚠️ Không detect được proxy outgoing IP: ${e.message}, dùng fake: ${fakeLocalIp}`);
            }
        }

        // ---- SỬA LỖI BONG BÓNG RESTORE PAGES KHI BỊ FORCE KILL ----
        try {
            const prefPath = path.join(profileDir, 'Default', 'Preferences');
            if (fs.existsSync(prefPath)) {
                let prefs = JSON.parse(fs.readFileSync(prefPath, 'utf8'));
                if (prefs.profile) {
                    prefs.profile.exit_type = 'Normal';
                    prefs.profile.exited_cleanly = true;
                }
                fs.writeFileSync(prefPath, JSON.stringify(prefs));
            }
        } catch (e) { /* ignore */ }

        // ---- CHROME FLAGS ----
        const args = [
            '--test-type',
            '--restore-last-session',
            '--disable-blink-features=AutomationControlled',
            '--disable-dev-shm-usage',
            '--renderer-process-limit=4',
            '--no-default-browser-check',
            '--no-first-run',
            '--password-store=basic',
            '--use-mock-keychain',
            '--remote-debugging-port=0',

            // --- C++ FINGERPRINT FLAGS ---
            `--canvas-noise-seed=${profileData.noiseSeed}`,
            `--webgl-noise-seed=${profileData.noiseSeed}`,
            `--audio-noise-seed=${profileData.noiseSeed}`,
            `--clientrects-noise-seed=${profileData.noiseSeed}`,
            `--webgl-vendor=${profileData.gpu.vendor.replace(/ /g, '\x1F')}`,
            `--webgl-renderer=${profileData.gpu.renderer.replace(/ /g, '\x1F')}`,

            // --- NATIVE C++ SPOOFING ---
            `--spoof-timezone=${timezone}`,
            `--spoof-locale=${locale}`,
            `--spoof-webrtc-ip=${webrtcIp}`,
            `--spoof-cpu-cores=${hwConcurrency}`,
            `--spoof-device-memory=${devMemory}`,
        ];

        if (profileData.userAgent) {
            args.push(`--user-agent=${profileData.userAgent}`);
        }

        if (options.windowSize) {
            args.push(`--window-size=${options.windowSize.width},${options.windowSize.height}`);
        }
        if (options.windowPosition) {
            args.push(`--window-position=${options.windowPosition.x},${options.windowPosition.y}`);
        }
        if (!options.windowSize && !options.windowPosition) {
            // Nếu mở đơn lẻ, thử maximized
            args.push('--start-maximized');
        }

        // Gộp Extensions
        const globalExts = this.getGlobalExtensions();
        const profileExts = profileData.extensions || [];
        const allExtensions = [...new Set([...globalExts, ...profileExts])]
            .filter(e => {
                if (!fs.existsSync(e)) return false;
                if (e.toLowerCase().endsWith('.zip') || e.toLowerCase().endsWith('.crx')) return false;
                return true;
            });
        if (allExtensions.length > 0) {
            const extPaths = allExtensions.join(',');
            args.push(`--disable-extensions-except=${extPaths}`);
            args.push(`--load-extension=${extPaths}`);
        }

        const launchConfig = {
            headless,
            executablePath: this.customChromePath,
            args,
            ignoreDefaultArgs: ['--enable-automation'],
            viewport: null,
            // timezoneId/locale gây fail Turnstile (Cloudflare detect CDP override)
        };

        if (profileData.proxy) {
            launchConfig.proxy = { server: profileData.proxy };
        }

        console.log(`[Manager] 🚀 Đang mở profile [${profileData.name}]...`);

        // Xử lý Zoom (chỉ zoom nội dung web, giữ nguyên kích thước UI trình duyệt)
        if (options.scaleFactor && options.scaleFactor !== 1) {
            try {
                const defaultDir = path.join(profileDir, 'Default');
                if (!fs.existsSync(defaultDir)) fs.mkdirSync(defaultDir, { recursive: true });
                
                const prefsPath = path.join(defaultDir, 'Preferences');
                let prefsData = {};
                if (fs.existsSync(prefsPath)) {
                    prefsData = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
                }
                
                if (!prefsData.partition) prefsData.partition = {};
                
                // Công thức tính zoom level của Chromium: level = ln(zoom_percent / 100) / ln(1.2)
                const zoomLevel = Math.log(options.scaleFactor) / Math.log(1.2);
                prefsData.partition.default_zoom_level = { 'x': zoomLevel };
                
                fs.writeFileSync(prefsPath, JSON.stringify(prefsData));
            } catch (e) {
                console.log(`[Manager] ⚠️ Không thể thiết lập zoom: ${e.message}`);
            }
        }
        let context;
        try {
            context = await chromium.launchPersistentContext(profileDir, launchConfig);
        } catch (err) {
            // Xử lý lỗi "Opening in existing browser session": Chrome cũ vẫn chiếm lock sau khi restart server
            if (err.message && err.message.includes('Opening in existing browser session')) {
                console.log(`[Manager] ⚠️ Profile [${profileData.name}] có Chrome cũ — đang diệt và thử lại...`);
                await new Promise((resolve) => {
                    const { exec } = require('child_process');
                    exec(
                        `powershell -Command "Get-WmiObject Win32_Process -Filter 'Name=''chrome.exe''' | Where-Object { $_.CommandLine -match '${profileId}' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`,
                        () => resolve()
                    );
                    setTimeout(resolve, 3000);
                });
                context = await chromium.launchPersistentContext(profileDir, launchConfig);
            } else {
                throw err;
            }
        }

        // ❌ KHÔNG dùng addInitScript — Cloudflare detect MỌI Object.defineProperty
        // Screen/Timezone/Locale đã được xử lý native bởi patchright
        // hardwareConcurrency/deviceMemory cần C++ patch trong tương lai
        console.log(`[Manager] 🎭 GPU: ${profileData.gpu.renderer.substring(0, 50)}`);
        console.log(`[Manager] 🖥️  Screen: ${screen.width}x${screen.height}`);
        console.log(`[Manager] 🌍 TZ: ${timezone} | Locale: ${locale}`);
        console.log(`[Manager] 🔒 WebRTC: disabled non-proxied UDP`);

        // Chặn tài nguyên nặng nếu bật blockImages
        if (blockImages) {
            await context.route('**/*', route => {
                const type = route.request().resourceType();
                if (['image', 'media', 'font'].includes(type)) {
                    return route.abort();
                }
                return route.continue();
            });
        }

        let page;
        // Nếu là profile mới và không có URL chỉ định, mặc định mở Google
        const effectiveStartUrl = (isNewProfile && (!options.startUrl || options.startUrl === 'about:blank')) 
            ? 'https://www.google.com' 
            : options.startUrl;

        if (effectiveStartUrl && effectiveStartUrl !== 'about:blank') {
            page = context.pages()[0] || await context.newPage();
            await page.goto(effectiveStartUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
        } else {
            // Đợi session khôi phục (tối đa 2 giây)
            for (let i = 0; i < 10; i++) {
                if (context.pages().length > 1) break;
                await new Promise(r => setTimeout(r, 200));
            }

            let pages = context.pages();
            if (pages.length > 1) {
                // Nếu có nhiều tab, đóng TẤT CẢ các tab trống để trả lại session cũ
                for (const p of pages) {
                    const url = p.url();
                    if (url === 'about:blank' || url.includes('chrome://newtab')) {
                        // Chỉ đóng nếu vẫn còn ít nhất 1 tab khác trong context
                        if (context.pages().length > 1) {
                            await p.close().catch(() => {});
                        }
                    }
                }
                const remainingPages = context.pages();
                page = remainingPages[0];
            } else {
                // Nếu chỉ có 1 tab duy nhất và nó đang trống -> Mặc định mở Google
                page = pages[0] || await context.newPage();
                const url = page.url();
                if (url === 'about:blank' || url.includes('chrome://newtab')) {
                    await page.goto('https://www.google.com', { waitUntil: 'domcontentloaded' }).catch(() => {});
                }
            }
        }

        // Lưu vào bộ theo dõi
        this.runningProfiles.set(profileId, { context, page });

        // Khi profile bị đóng (user đóng cửa sổ), tự dọn dẹp
        context.on('close', () => {
            this.runningProfiles.delete(profileId);
            console.log(`[Manager] ⏹️ Profile [${profileData.name}] đã đóng.`);
        });

        // Đọc wsEndpoint từ file DevToolsActivePort (chứa port ngẫu nhiên thực sự)
        let wsEndpoint = null;
        let debugPort = null;
        try {
            const devToolsFile = path.join(profileDir, 'DevToolsActivePort');
            // Đợi tối đa 3s cho Chrome ghi file
            for (let i = 0; i < 30; i++) {
                if (fs.existsSync(devToolsFile)) break;
                await new Promise(r => setTimeout(r, 100));
            }
            if (fs.existsSync(devToolsFile)) {
                const content = fs.readFileSync(devToolsFile, 'utf8').trim();
                debugPort = content.split('\n')[0].trim();
                wsEndpoint = `ws://127.0.0.1:${debugPort}/json/version`;
                console.log(`[Manager] 🔌 Profile [${profileData.name}] CDP tại port ${debugPort}`);
            }
        } catch (e) {
            console.warn(`[Manager] ⚠️ Không đọc được DevToolsActivePort: ${e.message}`);
        }

        console.log(`[Manager] ✅ Profile [${profileData.name}] đang chạy.`);
        return { context, page, profileData, wsEndpoint, debugPort };
        } finally {
            // Luôn giải phóng khóa dù thành công hay thất bại
            this.launchingProfiles.delete(profileId);
        }
    }


    /** Đóng 1 profile mạnh mẽ */
    async closeProfile(profileId, skipWmic = false) {
        const running = this.runningProfiles.get(profileId);
        
        // 1. Dọn khỏi RAM ngay lập tức để UI nhận phản hồi
        if (running) {
            this.runningProfiles.delete(profileId);
            try {
                await Promise.race([
                    running.context.close(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Close Timeout')), 2000))
                ]);
            } catch (e) {
                console.warn(`[Manager] ⚠️ Đóng profile ${profileId} chậm, bỏ qua chờ...`);
            }
        }
        
        // 2. BULLETPROOF: Nếu không skip, bắn bỏ process mồ côi bằng powershell
        if (!skipWmic) {
            const { exec } = require('child_process');
            exec(`powershell -Command "Get-WmiObject Win32_Process -Filter 'Name=''chrome.exe''' | Where-Object { $_.CommandLine -match '${profileId}' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`, () => {});
        }
    }

    /** Đóng tất cả đồng thời và mạnh mẽ */
    async closeAll() {
        const ids = [...this.runningProfiles.keys()];
        
        // Gọi closeProfile nhưng BỎ QUA kill lẻ để dồn vào 1 lệnh cuối
        await Promise.allSettled(ids.map(id => this.closeProfile(id, true)));

        // Dùng powershell quét và Force Kill toàn bộ cực mạnh.
        const { exec } = require('child_process');
        return new Promise((resolve) => {
            exec(`powershell -Command "Get-WmiObject Win32_Process -Filter 'Name=''chrome.exe''' | Where-Object { $_.CommandLine -match 'profiles_data' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`, () => {
                console.log(`[Manager] 🧹 Đã dọn dẹp toàn bộ tiến trình Chrome rác.`);
                resolve();
            });
        });
    }

    /** Lấy danh sách profile đang chạy */
    getRunningProfiles() {
        return [...this.runningProfiles.keys()];
    }
}

module.exports = ProfileManager;

// ============================================================================
// TEST THỬ NGHIỆM (chạy: node manager.js)
// ============================================================================
if (require.main === module) {
    (async () => {
        const manager = new ProfileManager();

        // Tạo 1 profile test
        const p = manager.createProfile('Test Profile 01');
        console.log('Profile created:', p.id, '| GPU:', p.gpu.renderer);

        // Mở trình duyệt
        const { page } = await manager.launchProfile(p.id, { startUrl: 'https://bot.sannysoft.com/' });
        console.log('✅ Trình duyệt đã mở. Đóng cửa sổ trình duyệt để thoát.');
    })();
}
