const { chromium } = require('playwright');
const { FingerprintGenerator } = require('fingerprint-generator');
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

class ProfileManager {
    constructor(options = {}) {
        // Đường dẫn data — dùng đường dẫn tương đối từ thư mục Xsurau
        const baseDir = options.baseDir || __dirname;
        this.profilesDataPath = path.join(baseDir, 'profiles_data');  // Lưu cookie, cache trình duyệt
        this.profilesMetaPath = path.join(baseDir, 'profiles_meta');  // Lưu cấu hình profile (JSON)
        this.extensionsPath = path.join(baseDir, 'extensions');       // Kho extension dùng chung
        this.customChromePath = options.chromePath || 'K:\\chromium_src\\src\\out\\Xsurau\\chrome.exe';

        // Theo dõi profile đang chạy (RAM only — không cần lưu file)
        this.runningProfiles = new Map(); // profileId -> { context, pages[], pid }

        // Bộ sinh vân tay
        this.fingerprintGenerator = new FingerprintGenerator({
            browsers: ['chrome'],
            operatingSystems: ['windows'],
        });

        this._initDirectories();
    }

    _initDirectories() {
        [this.profilesDataPath, this.profilesMetaPath, this.extensionsPath].forEach(dir => {
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        });
    }

    // ========================================================================
    // QUẢN LÝ PROFILE (CRUD)
    // ========================================================================

    /** Tạo profile mới */
    createProfile(name, proxy = null, extensions = []) {
        const id = 'profile_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
        const noiseSeed = crypto.randomBytes(16).toString('hex');

        // Random GPU từ database
        const gpu = GPU_DATABASE[Math.floor(Math.random() * GPU_DATABASE.length)];

        const profileData = {
            id,
            name: name || id,
            createdAt: new Date().toISOString(),
            proxy,            // "http://user:pass@ip:port" hoặc "socks5://ip:port"
            extensions,       // ["C:\\path\\to\\ext1", "C:\\path\\to\\ext2"]
            noiseSeed,        // Seed cho Canvas/Audio/ClientRects noise (C++ level)
            gpu,              // { vendor, renderer } cho WebGL fake (C++ level)
            notes: ''         // Ghi chú tùy ý
        };

        const metaFile = path.join(this.profilesMetaPath, `${id}.json`);
        fs.writeFileSync(metaFile, JSON.stringify(profileData, null, 2));
        console.log(`[Manager] ✅ Đã tạo profile: ${profileData.name} (${id})`);
        return profileData;
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

    // ========================================================================
    // KHỞI CHẠY / ĐÓNG TRÌNH DUYỆT
    // ========================================================================

    /** Mở trình duyệt với profile đã chọn */
    async launchProfile(profileId, options = {}) {
        const { blockImages = false, headless = false, startUrl = 'about:blank' } = options;

        if (this.runningProfiles.has(profileId)) {
            throw new Error(`Profile ${profileId} đang chạy rồi!`);
        }

        const profileData = this.getProfile(profileId);
        if (!profileData) throw new Error(`Profile ${profileId} không tồn tại!`);
        const profileDir = path.join(this.profilesDataPath, profileId);

        // ---- BỘ TỐI ƯU HIỆU NĂNG CHO CHẠY HÀNG CHỤC PROFILE ----
        const args = [
            '--start-maximized',
            // --- CHỐNG PHÁT HIỆN ---
            '--disable-blink-features=AutomationControlled',
            // --- TIẾT KIỆM RAM (ƯU TIÊN CAO NHẤT) ---
            '--disable-site-isolation-trials',      // Gộp process → tiết kiệm ~100MB/profile
            '--renderer-process-limit=2',            // Giới hạn tối đa 2 renderer process/profile
            '--js-flags=--max-old-space-size=128',   // Giới hạn V8 heap mỗi tab chỉ 128MB
            '--disable-dev-shm-usage',
            // --- TẮT DỊCH VỤ NỀN THỪA ---
            '--disable-background-networking',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-breakpad',
            '--disable-client-side-phishing-detection',
            '--disable-component-extensions-with-background-pages',
            '--disable-component-update',
            '--disable-default-apps',
            '--disable-domain-reliability',
            '--disable-extensions',                  // Sẽ bật lại nếu profile có extension
            '--disable-features=Translate,OptimizationHints,MediaRouter,CalculateNativeWinOcclusion,InterestGroupStorage,AggregationService,PrivacySandboxSettings4,AutofillServerCommunication',
            '--disable-hang-monitor',
            '--disable-ipc-flooding-protection',
            '--disable-popup-blocking',
            '--disable-prompt-on-repost',
            '--disable-renderer-backgrounding',
            '--disable-sync',
            '--metrics-recording-only',
            '--mute-audio',
            '--no-default-browser-check',
            '--no-first-run',
            '--password-store=basic',
            '--use-mock-keychain',
            // --- VÂN TAY PHẦN CỨNG (TRUYỀN VÀO LÕI C++) ---
            `--canvas-noise-seed=${profileData.noiseSeed}`,
            `--audio-noise-seed=${profileData.noiseSeed}`,
            `--rect-noise-seed=${profileData.noiseSeed}`,
            `--webgl-vendor=${profileData.gpu.vendor}`,
            `--webgl-renderer=${profileData.gpu.renderer}`,
        ];

        // Load extension nếu có
        if (profileData.extensions && profileData.extensions.length > 0) {
            const idx = args.indexOf('--disable-extensions');
            if (idx > -1) args.splice(idx, 1);
            const extPaths = profileData.extensions.join(',');
            args.push(`--disable-extensions-except=${extPaths}`);
            args.push(`--load-extension=${extPaths}`);
        }

        const launchConfig = {
            headless,
            executablePath: this.customChromePath,
            args,
            ignoreDefaultArgs: ['--enable-automation'],
            viewport: null,
        };

        if (profileData.proxy) {
            launchConfig.proxy = { server: profileData.proxy };
        }

        console.log(`[Manager] 🚀 Đang mở profile [${profileData.name}]...`);
        const context = await chromium.launchPersistentContext(profileDir, launchConfig);

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

        const page = context.pages()[0] || await context.newPage();
        if (startUrl !== 'about:blank') {
            await page.goto(startUrl, { waitUntil: 'domcontentloaded' });
        }

        // Lưu vào bộ theo dõi
        this.runningProfiles.set(profileId, { context, page });

        // Khi profile bị đóng (user đóng cửa sổ), tự dọn dẹp
        context.on('close', () => {
            this.runningProfiles.delete(profileId);
            console.log(`[Manager] ⏹️ Profile [${profileData.name}] đã đóng.`);
        });

        console.log(`[Manager] ✅ Profile [${profileData.name}] đang chạy.`);
        return { context, page, profileData };
    }

    /** Đóng 1 profile */
    async closeProfile(profileId) {
        const running = this.runningProfiles.get(profileId);
        if (!running) throw new Error(`Profile ${profileId} không đang chạy.`);
        await running.context.close();
        // Event 'close' ở trên sẽ tự dọn
    }

    /** Đóng tất cả */
    async closeAll() {
        const ids = [...this.runningProfiles.keys()];
        for (const id of ids) {
            await this.closeProfile(id);
        }
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
