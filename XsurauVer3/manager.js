const { chromium } = require('patchright');
const { FingerprintGenerator } = require('fingerprint-generator');
const { injectFingerprint } = require('./fingerprint-injector');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { stopGestureWatcher } = require('./gesture-watcher');
const proxyService = require('./proxy-service');
const proxyChain = require('proxy-chain');
const geoService = require('./geo-service');

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
const DEVICE_MEMORY = [4, 8];
const TIMEZONES = [
    'Asia/Ho_Chi_Minh', 'America/New_York', 'America/Chicago',
    'America/Los_Angeles', 'Europe/London', 'Europe/Berlin',
    'Asia/Tokyo', 'Asia/Singapore', 'Asia/Bangkok',
];
const LOCALES = ['vi-VN', 'en-US', 'en-GB', 'en-AU', 'ja-JP', 'de-DE'];

// ============================================================================
// HÀM BÓC TÁCH TÀI KHOẢN MICROSOFT (MSAL / LIVE / BING / REWARDS / LOGIN DATA)
// ============================================================================
function isValidAccountEmail(e) {
    if (!e || typeof e !== 'string') return false;
    e = e.trim().toLowerCase();
    if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(e)) return false;
    const blocked = ['schema.org', 'w3.org', 'example.com', 'google.com', 'chromium.org', 'gstatic.com', 'googleapis.com', 'microsoft.com', 'bing.com'];
    const domain = e.split('@')[1];
    if (blocked.includes(domain)) return false;
    if (e.endsWith('.png') || e.endsWith('.jpg') || e.endsWith('.svg') || e.endsWith('.js') || e.endsWith('.css')) return false;
    return true;
}

function extractAccountFromProfileDir(profileDir) {
    const defaultDir = path.join(profileDir, 'Default');
    if (!fs.existsSync(defaultDir)) return null;

    // 1. Kiểm tra History (URLs, MeControl username, OAuth login_hint, page titles)
    const histPath = path.join(defaultDir, 'History');
    if (fs.existsSync(histPath)) {
        try {
            const rawHist = fs.readFileSync(histPath, 'latin1');
            // Check username=..., login_hint=..., email=...
            const urlMatches = rawHist.match(/(?:username|login_hint|email)=([a-zA-Z0-9._%+-]+(?:%40|@)[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/ig);
            if (urlMatches) {
                for (const u of urlMatches) {
                    const clean = decodeURIComponent(u.split('=')[1].replace(/Continue$/i, '').trim());
                    if (isValidAccountEmail(clean)) return clean;
                }
            }
            // Check hotmail/outlook/live/msn in History
            const msEmails = rawHist.match(/[a-zA-Z0-9._%+-]+@(hotmail|outlook|live|msn)\.com/gi);
            if (msEmails) {
                for (const m of msEmails) {
                    const clean = m.replace(/Continue$/i, '').trim();
                    if (isValidAccountEmail(clean)) return clean;
                }
            }
        } catch (_) {}
    }

    // 2. Kiểm tra Web Data (Autofill form inputs)
    const webDataPath = path.join(defaultDir, 'Web Data');
    if (fs.existsSync(webDataPath)) {
        try {
            const rawWebData = fs.readFileSync(webDataPath, 'latin1');
            const matches = rawWebData.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
            if (matches) {
                for (let m of matches) {
                    if (m.startsWith('usernameEntry')) m = m.substring('usernameEntry'.length);
                    const subMatch = m.match(/^[a-zA-Z0-9._%+-]+@(hotmail|outlook|live|msn)\.com/i);
                    if (subMatch && isValidAccountEmail(subMatch[0])) return subMatch[0];
                    if (isValidAccountEmail(m)) return m;
                }
            }
        } catch (_) {}
    }

    // 3. Kiểm tra Segmentation platform (ukm_db)
    const ukmPath = path.join(profileDir, 'segmentation_platform', 'ukm_db');
    if (fs.existsSync(ukmPath)) {
        try {
            const files = fs.readdirSync(ukmPath).filter(f => f.endsWith('.ldb') || f.endsWith('.log'));
            for (const file of files) {
                const fullPath = path.join(ukmPath, file);
                const str = fs.readFileSync(fullPath, 'latin1');
                const msMatches = str.match(/[a-zA-Z0-9._%+-]+@(hotmail|outlook|live|msn)\.com/gi);
                if (msMatches) {
                    for (const m of msMatches) {
                        if (isValidAccountEmail(m)) return m.trim();
                    }
                }
            }
        } catch (_) {}
    }

    // 4. Kiểm tra Local Storage (LevelDB)
    const lsDir = path.join(defaultDir, 'Local Storage', 'leveldb');
    if (fs.existsSync(lsDir)) {
        try {
            const files = fs.readdirSync(lsDir).filter(f => f.endsWith('.ldb') || f.endsWith('.log'));
            for (const file of files) {
                const fullPath = path.join(lsDir, file);
                const str = fs.readFileSync(fullPath, 'latin1');
                const jsonPatterns = [
                    /"(?:username|preferred_username|upn|email|userPrincipalName)":\s*"([^"@]+@[^"]+)"/i,
                    /"(?:login_hint|unique_name)":\s*"([^"@]+@[^"]+)"/i,
                    /"account":\s*\{[^}]*"username":\s*"([^"@]+@[^"]+)"/i
                ];
                for (const p of jsonPatterns) {
                    const match = str.match(p);
                    if (match && isValidAccountEmail(match[1])) {
                        return match[1].trim();
                    }
                }
                const msMatches = str.match(/[a-zA-Z0-9._%+-]+@(hotmail|outlook|live|msn)\.com/gi);
                if (msMatches) {
                    for (const m of msMatches) {
                        if (isValidAccountEmail(m)) return m.trim();
                    }
                }
            }
        } catch (e) {}
    }

    // 5. Kiểm tra Login Data (SQLite / binary)
    const loginDataPath = path.join(defaultDir, 'Login Data');
    if (fs.existsSync(loginDataPath)) {
        try {
            const rawLogin = fs.readFileSync(loginDataPath, 'latin1');
            const matches = rawLogin.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
            if (matches) {
                for (const m of matches) {
                    if (isValidAccountEmail(m)) return m.trim();
                }
            }
        } catch (_) {}
    }

    // 6. Kiểm tra Session Storage
    const ssDir = path.join(defaultDir, 'Session Storage');
    if (fs.existsSync(ssDir)) {
        try {
            const files = fs.readdirSync(ssDir).filter(f => f.endsWith('.ldb') || f.endsWith('.log'));
            for (const file of files) {
                const fullPath = path.join(ssDir, file);
                const str = fs.readFileSync(fullPath, 'latin1');
                const jsonPatterns = [
                    /"(?:username|preferred_username|upn|email)":\s*"([^"@]+@[^"]+)"/i,
                    /"(?:login_hint|unique_name)":\s*"([^"@]+@[^"]+)"/i
                ];
                for (const p of jsonPatterns) {
                    const match = str.match(p);
                    if (match && isValidAccountEmail(match[1])) {
                        return match[1].trim();
                    }
                }
            }
        } catch (e) {}
    }

    // 7. Kiểm tra Preferences
    const prefPath = path.join(defaultDir, 'Preferences');
    if (fs.existsSync(prefPath)) {
        try {
            const prefStr = fs.readFileSync(prefPath, 'utf8');
            const match = prefStr.match(/"email":\s*"([^"@]+@[^"]+)"/i) || prefStr.match(/"user_email":\s*"([^"@]+@[^"]+)"/i);
            if (match && isValidAccountEmail(match[1])) {
                return match[1].trim();
            }
        } catch (e) {}
    }

    return null;
}

async function extractAccountFromRunningContext(context) {
    if (!context) return null;
    try {
        const pages = context.pages();
        for (const page of pages) {
            try {
                // 1. Kiểm tra URL của tab hiện tại
                const curUrl = page.url();
                if (curUrl && (curUrl.includes('username=') || curUrl.includes('login_hint=') || curUrl.includes('email='))) {
                    const m = curUrl.match(/(?:username|login_hint|email)=([a-zA-Z0-9._%+-]+(?:%40|@)[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
                    if (m) {
                        const clean = decodeURIComponent(m[1].replace(/Continue$/i, '').trim());
                        if (isValidAccountEmail(clean)) return clean;
                    }
                }

                // 2. Trích xuất DOM & Storage trong trang
                const email = await page.evaluate(() => {
                    // Check URL
                    const href = window.location.href;
                    const urlMatch = href.match(/(?:username|login_hint|email)=([a-zA-Z0-9._%+-]+(?:%40|@)[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
                    if (urlMatch) return decodeURIComponent(urlMatch[1]);

                    // Selectors Microsoft MeControl, Bing user, login page
                    const selectors = [
                        '#mectrl_currentAccount_secondary',
                        '.mectrl_accountEmail',
                        '#bnp_user_name',
                        '#id_a',
                        '.id_username',
                        '#displayName',
                        '#userDisplayName',
                        'div[data-bind*="userDisplayName"]',
                        'input[name="loginfmt"]',
                        '#i0116',
                        'input[type="email"]',
                        '.identity',
                        '[data-test-id="current-user-email"]',
                        '.user-profile-email',
                        '#mectrl_main_trigger',
                        '[aria-label*="@"]',
                        '[title*="@"]'
                    ];
                    for (const s of selectors) {
                        const el = document.querySelector(s);
                        if (el) {
                            const val = el.value || el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || '';
                            if (val && val.includes('@')) {
                                const m = val.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
                                if (m) return m[0];
                            }
                        }
                    }

                    // Check toàn bộ text trang có đuôi Microsoft email
                    const bodyText = document.body ? document.body.innerText : '';
                    if (bodyText) {
                        const m = bodyText.match(/[a-zA-Z0-9._%+-]+@(hotmail|outlook|live|msn)\.com/i);
                        if (m) return m[0];
                    }

                    // Check localStorage
                    for (let i = 0; i < localStorage.length; i++) {
                        const k = localStorage.key(i);
                        const v = localStorage.getItem(k);
                        if (v && v.includes('@')) {
                            const match = v.match(/"(?:username|preferred_username|upn|email|userPrincipalName)":\s*"([^"@]+@[^"]+)"/i);
                            if (match) return match[1];
                            const msMatch = v.match(/[a-zA-Z0-9._%+-]+@(hotmail|outlook|live|msn)\.com/i);
                            if (msMatch) return msMatch[0];
                        }
                    }

                    // Check sessionStorage
                    for (let i = 0; i < sessionStorage.length; i++) {
                        const k = sessionStorage.key(i);
                        const v = sessionStorage.getItem(k);
                        if (v && v.includes('@')) {
                            const match = v.match(/"(?:username|preferred_username|upn|email)":\s*"([^"@]+@[^"]+)"/i);
                            if (match) return match[1];
                            const msMatch = v.match(/[a-zA-Z0-9._%+-]+@(hotmail|outlook|live|msn)\.com/i);
                            if (msMatch) return msMatch[0];
                        }
                    }
                    return null;
                });
                if (email && isValidAccountEmail(email)) return email.trim();
            } catch (err) {}
        }

        // 3. Quét Cookies trực tiếp từ context
        try {
            const cookies = await context.cookies();
            for (const c of cookies) {
                if (c.name === 'DefaultUser' || c.name === 'SignInState' || c.value.includes('@')) {
                    const m = decodeURIComponent(c.value).match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
                    if (m && isValidAccountEmail(m[0])) return m[0];
                }
            }
        } catch (_) {}
    } catch (e) {}
    return null;
}

class ProfileManager {
    constructor(options = {}) {
        // Thay đổi thư mục lưu trữ Data sang ổ G: theo yêu cầu
        const baseDir = options.baseDir || 'G:\\XsurauDataVer3';
        this.baseDir = baseDir;
        this.isFeed = !!options.isFeed || (typeof baseDir === 'string' && baseDir.toLowerCase().includes('feed'));
        this.profilesDataPath = path.join(baseDir, 'profiles_data');  // Lưu cookie, cache trình duyệt
        this.profilesMetaPath = path.join(baseDir, 'profiles_meta');  // Lưu cấu hình profile (JSON)
        this.archivesDir = path.join(baseDir, 'archives');           // Lưu trữ profile cũ (Safe from Delete All)
        this.extensionsPath = path.join(baseDir, 'extensions');       // Kho extension dùng chung
        this.settingsFile = path.join(baseDir, 'settings.json');      // Cấu hình toàn cục
        this.archivesMetaFile = path.join(this.archivesDir, 'archives.json'); // Metadata cho lưu trữ
        this.groupsFile = path.join(baseDir, 'groups.json');          // Quản lý nhóm (Groups)
        this.tagsFile = path.join(baseDir, 'tags.json');              // Quản lý nhãn (Tags)
        this.customChromePath = options.chromePath || 'K:\\chromium_src\\src\\out\\Xsurau\\chrome.exe';

        // Theo dõi profile đang chạy (RAM only — không cần lưu file)
        this.runningProfiles = new Map(); // profileId -> { context, pages[], pid }
        this.anonymizedProxies = new Map(); // profileId -> anonProxyUrl (bridge xác thực cho proxy)
        // Khóa tránh mở 2 lần cùng lúc (race condition giữa thời gian launch và runningProfiles.set)
        this.launchingProfiles = new Set(); // profileId đang trong quá trình khởi động
        // Lưu vị trí grid layout cuối cùng (dùng lại khi automation mở profile)
        this.savedLayout = {}; // profileId -> { windowSize, windowPosition }

        // Bộ sinh vân tay
        this.fingerprintGenerator = new FingerprintGenerator({
            browsers: [
                { name: 'chrome', minVersion: 120 }
            ],
            operatingSystems: ['windows'],
        });

        this.profilesCache = new Map(); // profileId -> profileData RAM cache

        this._initDirectories();
        this._initSettings();
        this._loadProfilesCache();
    }

    _loadProfilesCache() {
        this.profilesCache.clear();
        if (!fs.existsSync(this.profilesMetaPath)) return;
        try {
            const files = fs.readdirSync(this.profilesMetaPath).filter(f => f.endsWith('.json'));
            for (const f of files) {
                try {
                    const raw = fs.readFileSync(path.join(this.profilesMetaPath, f), 'utf8').replace(/^\uFEFF/, '');
                    const data = JSON.parse(raw);
                    this.profilesCache.set(data.id, data);
                } catch (e) {}
            }
        } catch (e) {
            console.error('[Manager] Error loading profiles cache:', e.message);
        }
    }

    _initDirectories() {
        [this.profilesDataPath, this.profilesMetaPath, this.archivesDir, this.extensionsPath].forEach(dir => {
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        });
        if (!fs.existsSync(this.archivesMetaFile)) {
            fs.writeFileSync(this.archivesMetaFile, JSON.stringify({}, null, 2));
        }
        if (!fs.existsSync(this.groupsFile)) {
            fs.writeFileSync(this.groupsFile, JSON.stringify([], null, 2));
        }
        if (!fs.existsSync(this.tagsFile)) {
            fs.writeFileSync(this.tagsFile, JSON.stringify([], null, 2));
        }
    }
    _initSettings() {
        let settings = { globalExtensions: [] };
        if (fs.existsSync(this.settingsFile)) {
            try {
                settings = JSON.parse(fs.readFileSync(this.settingsFile, 'utf8'));
            } catch (e) {
                console.error('[Manager] Error reading settings.json:', e.message);
            }
        }
        
        let changed = false;
        if (!settings.globalExtensions) {
            settings.globalExtensions = [];
            changed = true;
        }
        if (settings.googleSheetId === undefined) {
            settings.googleSheetId = '';
            changed = true;
        }
        if (settings.tabs === undefined) {
            settings.tabs = [
                {
                    name: "FactoryAccount",
                    columns: {
                        Gmail: "A",
                        PassWord: "B",
                        Recover: "C",
                        Phone: "D",
                        Owner: "E",
                        Note: "F",
                        DateAppeal: "H",
                        DateRestore: "I"
                    }
                },
                {
                    name: "RentPhone",
                    columns: {
                        PhoneNumber: "A",
                        Api: "B",
                        DateTime: "C",
                        LastUse: "D",
                        Owner: "E"
                    }
                }
            ];
            changed = true;
        }
        if (settings.automations === undefined) {
            settings.automations = {
                "login-google": {
                    tab: "FactoryAccount",
                    matchKey: "Gmail",
                    mapping: { Gmail: "Gmail", PassWord: "PassWord", Recover: "Recover" }
                },
                "login-google-gesture": {
                    tab: "FactoryAccount",
                    matchKey: "Gmail",
                    mapping: { Gmail: "Gmail", PassWord: "PassWord", Recover: "Recover" }
                },
                "setup-2fa": {
                    tab: "FactoryAccount",
                    matchKey: "Gmail",
                    mapping: { Gmail: "Gmail", PassWord: "PassWord", Recover: "Recover" }
                },
                "solve-2fa": {
                    tab: "FactoryAccount",
                    matchKey: "Gmail",
                    mapping: { Gmail: "Gmail", Recover: "Recover" }
                },
                "verify-phone-sheet": {
                    tab: "FactoryAccount",
                    matchKey: "Gmail",
                    mapping: { Gmail: "Gmail", Phone: "Phone" }
                },
                "verify-phone-sheet-check": {
                    tab: "FactoryAccount",
                    matchKey: "Gmail",
                    mapping: { Gmail: "Gmail", Phone: "Phone" }
                },
                "appeal-google": {
                    tab: "FactoryAccount",
                    matchKey: "Gmail",
                    mapping: { Gmail: "Gmail" }
                },
                "logout-google": {
                    tab: "FactoryAccount",
                    matchKey: "Gmail",
                    mapping: { Gmail: "Gmail" }
                },
                "check-phone-verify": {
                    tab: "RentPhone",
                    matchKey: "PhoneNumber",
                    mapping: { PhoneNumber: "PhoneNumber", Api: "Api", DateTime: "DateTime", LastUse: "LastUse", Owner: "Owner" }
                },
                "check-double": {
                    tab: "RentPhone",
                    matchKey: "PhoneNumber",
                    mapping: { PhoneNumber: "PhoneNumber", Api: "Api", DateTime: "DateTime", LastUse: "LastUse", Owner: "Owner" }
                },
                "register-google-one": {
                    tab: "FactoryAccount",
                    matchKey: "Gmail",
                    mapping: { Gmail: "Gmail", PassWord: "PassWord", Recover: "Recover" }
                }
            };
            changed = true;
        }
        if (!settings.sheets || !Array.isArray(settings.sheets)) {
            settings.sheets = [];
            changed = true;
        }
        if (settings.sheets.length === 0) {
            settings.sheets.push({
                id: 'sheet_' + Date.now(),
                name: 'Main Sheet',
                spreadsheetId: settings.googleSheetId || '',
                defaultSyncTab: settings.defaultSyncTab || (settings.tabs?.[0]?.name || ''),
                scannedTabs: settings.scannedTabs || [],
                tabs: settings.tabs || []
            });
            changed = true;
        }

        // Migrate automation sources if needed
        if (settings.automations) {
            if (!settings.automations["check-double"]) {
                settings.automations["check-double"] = {
                    tab: "RentPhone",
                    matchKey: "PhoneNumber",
                    mapping: { PhoneNumber: "PhoneNumber", Api: "Api", DateTime: "DateTime", LastUse: "LastUse", Owner: "Owner" }
                };
                changed = true;
            }

            const defaultSheetId = settings.sheets[0].id;
            for (const [autoName, autoConfig] of Object.entries(settings.automations)) {
                if (!autoConfig.sources || !Array.isArray(autoConfig.sources) || autoConfig.sources.length === 0) {
                    autoConfig.sources = [{
                        sheetId: defaultSheetId,
                        tab: autoConfig.tab || 'FactoryAccount',
                        matchKey: autoConfig.matchKey || 'Gmail',
                        mapping: autoConfig.mapping || {}
                    }];
                    changed = true;
                }
            }
        }

        if (!settings.dashboardAutomations || !Array.isArray(settings.dashboardAutomations)) {
            settings.dashboardAutomations = Object.keys(settings.automations || {});
            changed = true;
        } else if (!settings.dashboardAutomations.includes("check-double")) {
            settings.dashboardAutomations.push("check-double");
            changed = true;
        }

        if (!settings.globalExtensions || !Array.isArray(settings.globalExtensions) || settings.globalExtensions.length === 0) {
            settings.globalExtensions = [
                "G:\\XsurauData\\extensions\\autosubmit",
                "G:\\XsurauData\\extensions\\chrome-build1.14.16-prod"
            ];
            changed = true;
        }

        if (!settings.realtimeSync) {
            settings.realtimeSync = {
                enabled: false,
                sheetId: settings.sheets?.[0]?.id || '',
                tab: settings.sheets?.[0]?.tabs?.[0]?.name || 'FactoryAccount',
                filterColumn: 'Note',
                filterValue: 'on',
                intervalSeconds: 1.5
            };
            changed = true;
        }

        if (!settings.multiProxy) {
            settings.multiProxy = {
                enabled: false,
                proxies: [],
                rotateUrls: []
            };
            changed = true;
        }

        if (settings.smartBandwidthSaver === undefined) {
            settings.smartBandwidthSaver = false;
            changed = true;
        }

        if (!settings.profileCreationDefaults) {
            settings.profileCreationDefaults = {
                mode: 'random',
                userAgent: '',
                gpu: '',
                screen: '',
                hardwareConcurrency: 8,
                deviceMemory: 8,
                timezone: 'Asia/Ho_Chi_Minh',
                locale: 'vi-VN'
            };
            changed = true;
        }
        
        if (!settings.autoGeoProxy) {
            settings.autoGeoProxy = {
                enabled: true,            // Master switch: Tự động đổi theo IP Proxy
                autoTimezone: true,       // Tự động đổi Múi giờ
                autoGeolocation: true,    // Tự động đổi Tọa độ GPS
                autoLocale: true,         // Tự động đổi Ngôn ngữ / Locale
                realisticJitter: true     // Tạo độ lệch ngẫu nhiên 500m-1.5km
            };
            changed = true;
        }

        if (changed || !fs.existsSync(this.settingsFile)) {
            fs.writeFileSync(this.settingsFile, JSON.stringify(settings, null, 2));
        }
    }

    getSettings() {
        this._initSettings();
        return JSON.parse(fs.readFileSync(this.settingsFile, 'utf8'));
    }

    saveSettings(config) {
        this._initSettings();
        const settings = JSON.parse(fs.readFileSync(this.settingsFile, 'utf8'));
        if (config.googleSheetId !== undefined) settings.googleSheetId = config.googleSheetId;
        if (config.tabs !== undefined) settings.tabs = config.tabs;
        if (config.automations !== undefined) settings.automations = config.automations;
        if (config.globalExtensions !== undefined) settings.globalExtensions = config.globalExtensions;
        if (config.defaultSyncTab !== undefined) settings.defaultSyncTab = config.defaultSyncTab;
        if (config.scannedTabs !== undefined) settings.scannedTabs = config.scannedTabs;
        if (config.sheets !== undefined) settings.sheets = config.sheets;
        if (config.activeSheetId !== undefined) settings.activeSheetId = config.activeSheetId;
        if (config.dashboardAutomations !== undefined) settings.dashboardAutomations = config.dashboardAutomations;
        if (config.realtimeSync !== undefined) settings.realtimeSync = config.realtimeSync;
        if (config.multiProxy !== undefined) settings.multiProxy = config.multiProxy;
        if (config.smartBandwidthSaver !== undefined) settings.smartBandwidthSaver = config.smartBandwidthSaver;
        if (config.profileCreationDefaults !== undefined) settings.profileCreationDefaults = config.profileCreationDefaults;
        if (config.autoGeoProxy !== undefined) settings.autoGeoProxy = config.autoGeoProxy;
        
        fs.writeFileSync(this.settingsFile, JSON.stringify(settings, null, 2));
        return settings;
    }

    getFingerprintOptions() {
        return {
            gpus: GPU_DATABASE,
            screens: SCREEN_DATABASE,
            hardwareConcurrency: HARDWARE_CONCURRENCY,
            deviceMemory: DEVICE_MEMORY,
            timezones: TIMEZONES,
            locales: LOCALES,
            userAgents: [
                { label: 'Chrome 149 (Lõi Custom Chromium 149.0.7812.0 - Đề xuất)', value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.7812.0 Safari/537.36' },
                { label: 'Chrome 150 (Windows - Latest Stable)', value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.7871.187 Safari/537.36' },
                { label: 'Chrome 148 (Windows)', value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36' },
                { label: 'Chrome 137 (Windows)', value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36' },
                { label: 'Chrome 136 (Windows)', value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36' },
                { label: 'Chrome 135 (Windows)', value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36' },
                { label: 'Chrome 134 (Windows)', value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36' },
                { label: 'Chrome 133 (Windows)', value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36' },
                { label: 'Chrome 149 (Macintosh)', value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.7812.0 Safari/537.36' }
            ]
        };
    }

    getGoogleSheetConfig() {
        const settings = this.getSettings();
        const accTab = settings.tabs?.find(t => t.name === "FactoryAccount") || settings.tabs?.[0];
        const phoneTab = settings.tabs?.find(t => t.name === "RentPhone") || settings.tabs?.[1];
        return {
            googleSheetId: settings.googleSheetId || '',
            googleSheetName: phoneTab ? phoneTab.name : 'RentPhone',
            googleSheetName2: accTab ? accTab.name : 'FactoryAccount',
            googleSheetName3: '',
            columns: {
                account: accTab ? accTab.columns : {},
                phone: phoneTab ? phoneTab.columns : {}
            }
        };
    }

    setGoogleSheetConfig(config) {
        const settings = this.getSettings();
        if (config.googleSheetId !== undefined) settings.googleSheetId = config.googleSheetId;
        if (config.googleSheetName2) {
            const accTab = settings.tabs?.find(t => t.name === "FactoryAccount") || settings.tabs?.[0];
            if (accTab) {
                accTab.name = config.googleSheetName2;
                if (config.columns?.account) accTab.columns = config.columns.account;
            }
        }
        if (config.googleSheetName) {
            const phoneTab = settings.tabs?.find(t => t.name === "RentPhone") || settings.tabs?.[1];
            if (phoneTab) {
                phoneTab.name = config.googleSheetName;
                if (config.columns?.phone) phoneTab.columns = config.columns.phone;
            }
        }
        return this.saveSettings(settings);
    }    // ========================================================================
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
        if (!fs.existsSync(extPath)) return this.getGlobalExtensions();

        let finalPath = extPath;
        const targetDir = this.extensionsPath; // G:\XsurauData\extensions

        // Nếu path chưa nằm trong thư mục extensions của G:, tiến hành copy
        if (!extPath.toLowerCase().startsWith(targetDir.toLowerCase())) {
            const folderName = path.basename(extPath);
            const dest = path.join(targetDir, folderName);
            
            try {
                console.log(`[Manager] 📂 Đang copy extension sang ổ G: ${extPath} -> ${dest}`);
                // fs.cpSync có từ Node 16.7.0+, hỗ trợ copy đệ quy
                fs.cpSync(extPath, dest, { recursive: true, overwrite: true });
                finalPath = dest;
            } catch (e) {
                console.error(`[Manager] ❌ Lỗi copy extension: ${e.message}`);
            }
        }

        const exts = this.getGlobalExtensions();
        if (!exts.includes(finalPath)) {
            exts.push(finalPath);
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
    createProfile(name, proxy = null, extensions = [], customOptions = {}) {
        let id;
        if (customOptions.id) {
            id = String(customOptions.id).trim();
        } else if (name && /^\d+$/.test(String(name).trim())) {
            id = String(name).trim();
        } else if (this.isFeed) {
            let maxId = 0;
            const existingIds = Array.from(this.profilesCache.keys());
            if (fs.existsSync(this.profilesMetaPath)) {
                try {
                    fs.readdirSync(this.profilesMetaPath).forEach(f => {
                        const base = f.replace(/\.json$/i, '');
                        if (!existingIds.includes(base)) existingIds.push(base);
                    });
                } catch (_) {}
            }
            existingIds.forEach(val => {
                const n = parseInt(val, 10);
                if (!isNaN(n) && n > maxId) maxId = n;
            });
            id = String(maxId + 1);
        } else {
            id = 'profile_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
        }

        const noiseSeed = crypto.randomBytes(16).toString('hex');
        const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

        const settings = this.getSettings();
        const globalDefaults = settings.profileCreationDefaults || {};
        const mode = customOptions.mode || globalDefaults.mode || 'random';

        let userAgent;
        if (mode === 'custom' && customOptions.userAgent && customOptions.userAgent !== 'random') {
            userAgent = customOptions.userAgent;
        } else if (mode === 'custom' && globalDefaults.userAgent && globalDefaults.userAgent !== 'random') {
            userAgent = globalDefaults.userAgent;
        } else {
            const fp = this.fingerprintGenerator.getFingerprint();
            userAgent = fp.fingerprint.navigator.userAgent;
        }

        let gpu;
        if (mode === 'custom' && customOptions.gpu && customOptions.gpu !== 'random') {
            gpu = typeof customOptions.gpu === 'string' ? JSON.parse(customOptions.gpu) : customOptions.gpu;
        } else if (mode === 'custom' && globalDefaults.gpu && globalDefaults.gpu !== 'random') {
            gpu = typeof globalDefaults.gpu === 'string' ? JSON.parse(globalDefaults.gpu) : globalDefaults.gpu;
        } else {
            gpu = pick(GPU_DATABASE);
        }

        let screen;
        if (mode === 'custom' && customOptions.screen && customOptions.screen !== 'random') {
            screen = typeof customOptions.screen === 'string' ? JSON.parse(customOptions.screen) : customOptions.screen;
        } else if (mode === 'custom' && globalDefaults.screen && globalDefaults.screen !== 'random') {
            screen = typeof globalDefaults.screen === 'string' ? JSON.parse(globalDefaults.screen) : globalDefaults.screen;
        } else {
            screen = pick(SCREEN_DATABASE);
        }

        let hardwareConcurrency;
        if (mode === 'custom' && customOptions.hardwareConcurrency && customOptions.hardwareConcurrency !== 'random' && !isNaN(parseInt(customOptions.hardwareConcurrency, 10))) {
            hardwareConcurrency = parseInt(customOptions.hardwareConcurrency, 10);
        } else if (mode === 'custom' && globalDefaults.hardwareConcurrency && globalDefaults.hardwareConcurrency !== 'random' && !isNaN(parseInt(globalDefaults.hardwareConcurrency, 10))) {
            hardwareConcurrency = parseInt(globalDefaults.hardwareConcurrency, 10);
        } else {
            hardwareConcurrency = pick(HARDWARE_CONCURRENCY);
        }

        let deviceMemory;
        if (mode === 'custom' && customOptions.deviceMemory && customOptions.deviceMemory !== 'random' && !isNaN(parseInt(customOptions.deviceMemory, 10))) {
            deviceMemory = parseInt(customOptions.deviceMemory, 10);
        } else if (mode === 'custom' && globalDefaults.deviceMemory && globalDefaults.deviceMemory !== 'random' && !isNaN(parseInt(globalDefaults.deviceMemory, 10))) {
            deviceMemory = parseInt(globalDefaults.deviceMemory, 10);
        } else {
            deviceMemory = pick(DEVICE_MEMORY);
        }

        let timezone;
        if (mode === 'custom' && customOptions.timezone && customOptions.timezone !== 'random') {
            timezone = customOptions.timezone;
        } else if (mode === 'custom' && globalDefaults.timezone && globalDefaults.timezone !== 'random') {
            timezone = globalDefaults.timezone;
        } else {
            timezone = 'auto';
        }

        let locale;
        if (mode === 'custom' && customOptions.locale && customOptions.locale !== 'random') {
            locale = customOptions.locale;
        } else if (mode === 'custom' && globalDefaults.locale && globalDefaults.locale !== 'random') {
            locale = globalDefaults.locale;
        } else {
            locale = pick(LOCALES);
        }

        const profileData = {
            id,
            name: name || id,
            createdAt: new Date().toISOString(),
            proxy,
            group: customOptions.group || '',
            tags: Array.isArray(customOptions.tags) ? customOptions.tags : [],
            account: customOptions.account || '',
            extensions,
            noiseSeed,
            userAgent,
            gpu,
            screen,
            hardwareConcurrency,
            deviceMemory,
            timezone,
            locale,
            notes: '',
            creationMode: mode
        };

        const metaFile = path.join(this.profilesMetaPath, `${id}.json`);
        fs.writeFileSync(metaFile, JSON.stringify(profileData, null, 2));
        this.profilesCache.set(id, profileData);
        console.log(`[Manager] ✅ Profile: ${profileData.name} (${mode.toUpperCase()}) | GPU: ${profileData.gpu.renderer.substring(0, 40)}... | Screen: ${profileData.screen.width}x${profileData.screen.height} | Cores: ${profileData.hardwareConcurrency}`);
        return profileData;
    }

    /** Tạo hàng loạt profile */
    bulkCreateProfiles(count, namePrefix = 'Profile', proxies = [], customOptions = {}) {
        const created = [];
        let startNum = 1;
        if (this.isFeed) {
            let maxId = 0;
            const existingIds = Array.from(this.profilesCache.keys());
            if (fs.existsSync(this.profilesMetaPath)) {
                try {
                    fs.readdirSync(this.profilesMetaPath).forEach(f => {
                        const base = f.replace(/\.json$/i, '');
                        if (!existingIds.includes(base)) existingIds.push(base);
                    });
                } catch (_) {}
            }
            existingIds.forEach(val => {
                const n = parseInt(val, 10);
                if (!isNaN(n) && n > maxId) maxId = n;
            });
            startNum = maxId + 1;
        }

        const proxyMode = customOptions.proxyMode || 'auto';
        const validProxies = Array.isArray(proxies)
            ? proxies.map(s => (typeof s === 'string' ? s.trim() : s)).filter(Boolean)
            : [];

        for (let i = 0; i < count; i++) {
            let proxy = null;
            if (validProxies.length > 0) {
                if (proxyMode === 'single') {
                    // Dùng chung 1 proxy cho tất cả profile
                    proxy = validProxies[0];
                } else if (proxyMode === 'rotate') {
                    // Xoay vòng tuần tự qua danh sách proxy
                    proxy = validProxies[i % validProxies.length];
                } else if (proxyMode === 'list') {
                    // Tuần tự mỗi dòng 1 profile, nếu thiếu thì null
                    proxy = validProxies[i] || null;
                } else {
                    // Mặc định 'auto':
                    // - Nếu chỉ nhập 1 proxy -> tự động dùng chung cho TẤT CẢ profile được tạo
                    // - Nếu nhập nhiều proxy nhưng ít hơn số profile -> tự động xoay vòng chia đều
                    // - Nếu đủ hoặc thừa proxy -> gán tuần tự 1:1
                    if (validProxies.length === 1) {
                        proxy = validProxies[0];
                    } else if (validProxies.length < count) {
                        proxy = validProxies[i % validProxies.length];
                    } else {
                        proxy = validProxies[i] || null;
                    }
                }
            }

            let profile;
            if (this.isFeed) {
                const profileId = String(startNum + i);
                profile = this.createProfile(profileId, proxy, [], { ...customOptions, id: profileId });
            } else {
                const num = String(i + 1).padStart(3, '0');
                profile = this.createProfile(`${namePrefix} ${num}`, proxy, [], customOptions);
            }
            created.push(profile);
        }
        console.log(`[Manager] 📦 Đã tạo ${count} profile hàng loạt! (ProxyMode: ${proxyMode}, Proxies: ${validProxies.length})`);
        return created;
    }

    /** Lấy thông tin 1 profile */
    getProfile(profileId) {
        let data = this.profilesCache.get(profileId);
        if (!data) {
            const metaFile = path.join(this.profilesMetaPath, `${profileId}.json`);
            if (!fs.existsSync(metaFile)) return null;
            data = JSON.parse(fs.readFileSync(metaFile, 'utf8').replace(/^\uFEFF/, ''));
            this.profilesCache.set(profileId, data);
        }
        return {
            ...data,
            group: data.group || '',
            tags: Array.isArray(data.tags) ? data.tags : [],
            account: data.account || '',
            status: this.runningProfiles.has(profileId) ? 'running' : 'stopped'
        };
    }

    /** Liệt kê tất cả profile (Đồng bộ cache với disk) */
    listProfiles() {
        this._loadProfilesCache();
        return Array.from(this.profilesCache.values()).map(data => ({
            ...data,
            group: data.group || '',
            tags: Array.isArray(data.tags) ? data.tags : [],
            account: data.account || '',
            status: this.runningProfiles.has(data.id) ? 'running' : 'stopped'
        }));
    }

    /** Cập nhật profile (proxy, extensions, name, notes, account, group, tags) */
    updateProfile(profileId, updates) {
        const metaFile = path.join(this.profilesMetaPath, `${profileId}.json`);
        if (!fs.existsSync(metaFile)) throw new Error(`Profile ${profileId} không tồn tại`);
        let data = this.profilesCache.get(profileId);
        if (!data) data = JSON.parse(fs.readFileSync(metaFile, 'utf8').replace(/^\uFEFF/, ''));

        if (updates.name !== undefined) data.name = updates.name;
        if (updates.proxy !== undefined) data.proxy = updates.proxy;
        if (updates.account !== undefined) data.account = updates.account;
        if (updates.group !== undefined) data.group = updates.group;
        if (updates.tags !== undefined) data.tags = Array.isArray(updates.tags) ? updates.tags : [];
        if (updates.extensions !== undefined) data.extensions = updates.extensions;
        if (updates.notes !== undefined) data.notes = updates.notes;
        if (updates.deviceMemory !== undefined) data.deviceMemory = updates.deviceMemory;
        if (updates.hardwareConcurrency !== undefined) data.hardwareConcurrency = updates.hardwareConcurrency;
        if (updates.screen !== undefined) data.screen = updates.screen;
        if (updates.timezone !== undefined) data.timezone = updates.timezone;
        if (updates.locale !== undefined) data.locale = updates.locale;

        fs.writeFileSync(metaFile, JSON.stringify(data, null, 2));
        this.profilesCache.set(profileId, data);
        return data;
    }

    // ========================================================================
    // QUẢN LÝ NHÓM (GROUPS)
    // ========================================================================

    getGroups() {
        if (!fs.existsSync(this.groupsFile)) return [];
        try {
            return JSON.parse(fs.readFileSync(this.groupsFile, 'utf8'));
        } catch (_) {
            return [];
        }
    }

    createGroup(name, color = '#38bdf8') {
        if (!name || !name.trim()) throw new Error('Tên nhóm không được để trống');
        const groups = this.getGroups();
        const id = 'grp_' + Date.now() + '_' + crypto.randomBytes(2).toString('hex');
        const newGroup = {
            id,
            name: name.trim(),
            color: color || '#38bdf8',
            createdAt: new Date().toISOString()
        };
        groups.push(newGroup);
        fs.writeFileSync(this.groupsFile, JSON.stringify(groups, null, 2));
        console.log(`[Manager] 📁 Đã tạo nhóm: [${newGroup.name}] (${newGroup.id})`);
        return newGroup;
    }

    updateGroup(groupId, updates = {}) {
        const groups = this.getGroups();
        const group = groups.find(g => g.id === groupId);
        if (!group) throw new Error(`Nhóm ${groupId} không tồn tại`);
        if (updates.name && updates.name.trim()) group.name = updates.name.trim();
        if (updates.color) group.color = updates.color;
        fs.writeFileSync(this.groupsFile, JSON.stringify(groups, null, 2));
        console.log(`[Manager] 📁 Đã cập nhật nhóm: [${group.name}]`);
        return group;
    }

    deleteGroup(groupId) {
        let groups = this.getGroups();
        const group = groups.find(g => g.id === groupId);
        if (!group) throw new Error(`Nhóm ${groupId} không tồn tại`);
        groups = groups.filter(g => g.id !== groupId);
        fs.writeFileSync(this.groupsFile, JSON.stringify(groups, null, 2));

        // Bỏ nhóm cho các profile thuộc nhóm bị xóa
        let affected = 0;
        const allProfiles = this.listProfiles();
        for (const p of allProfiles) {
            if (p.group === groupId) {
                p.group = '';
                const metaFile = path.join(this.profilesMetaPath, `${p.id}.json`);
                fs.writeFileSync(metaFile, JSON.stringify(p, null, 2));
                this.profilesCache.set(p.id, p);
                affected++;
            }
        }
        console.log(`[Manager] 🗑️ Đã xóa nhóm [${group.name}], giải phóng ${affected} profiles.`);
        return { success: true, affectedProfiles: affected };
    }

    moveToGroup(profileIds, groupId) {
        if (!Array.isArray(profileIds)) profileIds = [profileIds];
        const validGroup = groupId ? this.getGroups().find(g => g.id === groupId) : null;
        const targetGroupId = validGroup ? validGroup.id : '';

        let movedCount = 0;
        for (const id of profileIds) {
            const p = this.getProfile(id);
            if (p) {
                p.group = targetGroupId;
                const metaFile = path.join(this.profilesMetaPath, `${id}.json`);
                fs.writeFileSync(metaFile, JSON.stringify(p, null, 2));
                this.profilesCache.set(id, p);
                movedCount++;
            }
        }
        console.log(`[Manager] 🔀 Đã di chuyển ${movedCount} profile vào nhóm [${validGroup ? validGroup.name : 'Chưa phân nhóm'}]`);
        return { success: true, count: movedCount, groupId: targetGroupId };
    }

    // ========================================================================
    // QUẢN LÝ NHÃN (TAGS)
    // ========================================================================

    getTags() {
        if (!fs.existsSync(this.tagsFile)) return [];
        try {
            return JSON.parse(fs.readFileSync(this.tagsFile, 'utf8'));
        } catch (_) {
            return [];
        }
    }

    createTag(name, color = '#10b981') {
        if (!name || !name.trim()) throw new Error('Tên nhãn không được để trống');
        const tags = this.getTags();
        const trimmed = name.trim();
        const existing = tags.find(t => t.name.toLowerCase() === trimmed.toLowerCase());
        if (existing) return existing;

        const id = 'tag_' + Date.now() + '_' + crypto.randomBytes(2).toString('hex');
        const newTag = {
            id,
            name: trimmed,
            color: color || '#10b981'
        };
        tags.push(newTag);
        fs.writeFileSync(this.tagsFile, JSON.stringify(tags, null, 2));
        console.log(`[Manager] 🏷️ Đã tạo nhãn: [${newTag.name}] (${newTag.id})`);
        return newTag;
    }

    updateTag(tagId, updates = {}) {
        const tags = this.getTags();
        const tag = tags.find(t => t.id === tagId);
        if (!tag) throw new Error(`Nhãn ${tagId} không tồn tại`);
        if (updates.name && updates.name.trim()) tag.name = updates.name.trim();
        if (updates.color) tag.color = updates.color;
        fs.writeFileSync(this.tagsFile, JSON.stringify(tags, null, 2));
        console.log(`[Manager] 🏷️ Đã cập nhật nhãn: [${tag.name}]`);
        return tag;
    }

    deleteTag(tagId) {
        let tags = this.getTags();
        const tag = tags.find(t => t.id === tagId);
        if (!tag) throw new Error(`Nhãn ${tagId} không tồn tại`);
        tags = tags.filter(t => t.id !== tagId);
        fs.writeFileSync(this.tagsFile, JSON.stringify(tags, null, 2));

        // Gỡ nhãn này khỏi tất cả các profile
        let affected = 0;
        const allProfiles = this.listProfiles();
        for (const p of allProfiles) {
            if (Array.isArray(p.tags) && (p.tags.includes(tagId) || p.tags.includes(tag.name))) {
                p.tags = p.tags.filter(t => t !== tagId && t !== tag.name);
                const metaFile = path.join(this.profilesMetaPath, `${p.id}.json`);
                fs.writeFileSync(metaFile, JSON.stringify(p, null, 2));
                this.profilesCache.set(p.id, p);
                affected++;
            }
        }
        console.log(`[Manager] 🗑️ Đã xóa nhãn [${tag.name}], gỡ khỏi ${affected} profile.`);
        return { success: true, affectedProfiles: affected };
    }

    addTagsToProfiles(profileIds, tagNamesOrIds) {
        if (!Array.isArray(profileIds)) profileIds = [profileIds];
        if (!Array.isArray(tagNamesOrIds)) tagNamesOrIds = [tagNamesOrIds];

        let affected = 0;
        for (const id of profileIds) {
            const p = this.getProfile(id);
            if (p) {
                const cur = Array.isArray(p.tags) ? p.tags : [];
                p.tags = [...new Set([...cur, ...tagNamesOrIds])];
                const metaFile = path.join(this.profilesMetaPath, `${id}.json`);
                fs.writeFileSync(metaFile, JSON.stringify(p, null, 2));
                this.profilesCache.set(id, p);
                affected++;
            }
        }
        console.log(`[Manager] 🏷️ Đã gán nhãn [${tagNamesOrIds.join(', ')}] cho ${affected} profiles.`);
        return { success: true, count: affected };
    }

    removeTagsFromProfiles(profileIds, tagNamesOrIds) {
        if (!Array.isArray(profileIds)) profileIds = [profileIds];
        if (!Array.isArray(tagNamesOrIds)) tagNamesOrIds = [tagNamesOrIds];

        let affected = 0;
        for (const id of profileIds) {
            const p = this.getProfile(id);
            if (p) {
                const cur = Array.isArray(p.tags) ? p.tags : [];
                p.tags = cur.filter(t => !tagNamesOrIds.includes(t));
                const metaFile = path.join(this.profilesMetaPath, `${id}.json`);
                fs.writeFileSync(metaFile, JSON.stringify(p, null, 2));
                this.profilesCache.set(id, p);
                affected++;
            }
        }
        console.log(`[Manager] 🏷️ Đã gỡ nhãn [${tagNamesOrIds.join(', ')}] khỏi ${affected} profiles.`);
        return { success: true, count: affected };
    }

    /** Cập nhật proxy hàng loạt cho các profile */
    bulkUpdateProxies(profileIds, proxies = [], options = {}) {
        if (!Array.isArray(profileIds)) profileIds = [profileIds];
        const mode = options.mode || 'list'; // 'list', 'single', 'clear'
        const overwrite = options.overwrite !== false;

        let rawProxies = Array.isArray(proxies) ? proxies : [proxies];
        let validProxies = [];
        for (const item of rawProxies) {
            if (typeof item === 'string') {
                const lines = item.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
                validProxies.push(...lines);
            }
        }

        let updatedCount = 0;
        for (let i = 0; i < profileIds.length; i++) {
            const id = profileIds[i];
            const p = this.getProfile(id);
            if (!p) continue;

            const hasExistingProxy = p.proxy && typeof p.proxy === 'string' && p.proxy.trim() && p.proxy.trim().toUpperCase() !== 'DIRECT';
            if (!overwrite && hasExistingProxy) {
                continue;
            }

            let newProxy = null;
            if (mode === 'clear') {
                newProxy = null;
            } else if (mode === 'single') {
                newProxy = validProxies.length > 0 ? validProxies[0] : null;
            } else {
                // list / round-robin
                if (validProxies.length > 0) {
                    newProxy = validProxies[updatedCount % validProxies.length];
                } else {
                    newProxy = null;
                }
            }

            p.proxy = newProxy;
            const metaFile = path.join(this.profilesMetaPath, `${id}.json`);
            fs.writeFileSync(metaFile, JSON.stringify(p, null, 2));
            this.profilesCache.set(id, p);
            updatedCount++;
        }

        console.log(`[Manager] 🌐 Bulk Proxy Update: Đã cập nhật proxy cho ${updatedCount}/${profileIds.length} profiles (mode=${mode}).`);
        return { success: true, count: updatedCount };
    }

    /** Trích xuất tài khoản Microsoft đã đăng nhập trong profile */
    async extractAccount(profileId) {
        const profileData = this.getProfile(profileId);
        if (!profileData) throw new Error(`Profile ${profileId} không tồn tại!`);

        let extractedEmail = null;

        // 1. Thử quét khi profile đang mở
        const running = this.runningProfiles.get(profileId);
        if (running && running.context) {
            extractedEmail = await extractAccountFromRunningContext(running.context);
        }

        // 2. Quét từ thư mục dữ liệu của profile
        if (!extractedEmail) {
            const profileDir = path.join(this.profilesDataPath, profileId);
            extractedEmail = extractAccountFromProfileDir(profileDir);
        }

        // 3. Nếu tìm thấy email, cập nhật vào metadata
        if (extractedEmail) {
            profileData.account = extractedEmail;
            const metaFile = path.join(this.profilesMetaPath, `${profileId}.json`);
            fs.writeFileSync(metaFile, JSON.stringify(profileData, null, 2));
            this.profilesCache.set(profileId, profileData);
            console.log(`[Manager] 📧 Đã trích xuất tài khoản cho profile [${profileData.name}]: ${extractedEmail}`);
            return { success: true, account: extractedEmail };
        }

        return { success: false, message: 'Chưa phát hiện tài khoản Microsoft đã đăng nhập' };
    }

    /** Xóa profile (xóa cả data trình duyệt) */
    deleteProfile(profileId) {
        stopGestureWatcher(profileId);
        if (this.runningProfiles.has(profileId)) {
            this.closeProfile(profileId).catch(() => {});
        }
        this.profilesCache.delete(profileId);

        const metaFile = path.join(this.profilesMetaPath, `${profileId}.json`);
        const dataDir = path.join(this.profilesDataPath, profileId);
        if (fs.existsSync(metaFile)) {
            try { fs.unlinkSync(metaFile); } catch(e) {}
        }
        if (fs.existsSync(dataDir)) {
            try {
                fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
            } catch(e) {
                console.warn(`[Manager] ⚠️ Dọn dẹp folder ${profileId}: ${e.message}`);
            }
        }
        console.log(`[Manager] 🗑️ Đã xóa profile: ${profileId}`);
    }

    /** Xóa tất cả profile (Xóa cực mạnh - WIPE ALL) */
    async deleteAllProfiles() {
        // 1. Đóng tất cả và diệt TẤT CẢ process chrome liên quan đến data folder
        await this.closeAll();
        
        // 2. Chờ một chút để giải phóng lock
        await new Promise(r => setTimeout(r, 500));

        let count = this.profilesCache.size;
        this.profilesCache.clear();

        try {
            // Xóa sạch folder meta
            if (fs.existsSync(this.profilesMetaPath)) {
                fs.rmSync(this.profilesMetaPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
                fs.mkdirSync(this.profilesMetaPath, { recursive: true });
            }
            // Xóa sạch folder data
            if (fs.existsSync(this.profilesDataPath)) {
                fs.rmSync(this.profilesDataPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
                fs.mkdirSync(this.profilesDataPath, { recursive: true });
            }
            console.log(`[Manager] 🔥 ĐÃ XÓA CỰC MẠNH: ${count} profile và toàn bộ dữ liệu trình duyệt.`);
        } catch (err) {
            console.error(`[Manager] ❌ Lỗi khi xóa cực mạnh: ${err.message}`);
        }
        return count;
    }

    // ========================================================================
    // LƯU TRỮ (ARCHIVE)
    // ========================================================================

    /** Lưu trữ các profile vào một nhóm */
    archiveProfiles(profileIds, groupName) {
        if (!groupName) throw new Error('Thiếu tên nhóm lưu trữ');
        const archives = JSON.parse(fs.readFileSync(this.archivesMetaFile, 'utf8'));
        if (!archives[groupName]) archives[groupName] = [];

        const groupDir = path.join(this.archivesDir, groupName);
        const groupMetaDir = path.join(groupDir, 'meta');
        const groupDataDir = path.join(groupDir, 'data');

        if (!fs.existsSync(groupMetaDir)) fs.mkdirSync(groupMetaDir, { recursive: true });
        if (!fs.existsSync(groupDataDir)) fs.mkdirSync(groupDataDir, { recursive: true });

        let archivedCount = 0;
        for (const id of profileIds) {
            if (this.runningProfiles.has(id)) {
                console.warn(`[Manager] ⚠️ Bỏ qua lưu trữ profile đang chạy: ${id}`);
                continue;
            }

            const metaFile = path.join(this.profilesMetaPath, `${id}.json`);
            const dataDir = path.join(this.profilesDataPath, id);

            if (fs.existsSync(metaFile)) {
                // Di chuyển meta
                fs.renameSync(metaFile, path.join(groupMetaDir, `${id}.json`));
                
                // Di chuyển data (nếu có)
                if (fs.existsSync(dataDir)) {
                    fs.renameSync(dataDir, path.join(groupDataDir, id));
                }

                if (!archives[groupName].includes(id)) {
                    archives[groupName].push(id);
                }
                archivedCount++;
            }
        }

        fs.writeFileSync(this.archivesMetaFile, JSON.stringify(archives, null, 2));
        console.log(`[Manager] 📦 Đã lưu trữ ${archivedCount} profile vào nhóm [${groupName}]`);
        return archivedCount;
    }

    /** Khôi phục các profile từ nhóm lưu trữ */
    restoreProfiles(profileIds, groupName) {
        if (!groupName) throw new Error('Thiếu tên nhóm lưu trữ');
        const archives = JSON.parse(fs.readFileSync(this.archivesMetaFile, 'utf8'));
        if (!archives[groupName]) return 0;

        const groupDir = path.join(this.archivesDir, groupName);
        const groupMetaDir = path.join(groupDir, 'meta');
        const groupDataDir = path.join(groupDir, 'data');

        let restoredCount = 0;
        const remainingProfiles = [];

        for (const id of archives[groupName]) {
            if (profileIds.includes(id)) {
                const archivedMetaFile = path.join(groupMetaDir, `${id}.json`);
                const archivedDataDir = path.join(groupDataDir, id);

                if (fs.existsSync(archivedMetaFile)) {
                    // Khôi phục meta
                    fs.renameSync(archivedMetaFile, path.join(this.profilesMetaPath, `${id}.json`));
                    
                    // Khôi phục data (nếu có)
                    if (fs.existsSync(archivedDataDir)) {
                        fs.renameSync(archivedDataDir, path.join(this.profilesDataPath, id));
                    }
                    restoredCount++;
                }
            } else {
                remainingProfiles.push(id);
            }
        }

        if (remainingProfiles.length === 0) {
            delete archives[groupName];
            // Xóa folder nhóm nếu trống
            if (fs.existsSync(groupDir)) fs.rmSync(groupDir, { recursive: true, force: true });
        } else {
            archives[groupName] = remainingProfiles;
        }

        fs.writeFileSync(this.archivesMetaFile, JSON.stringify(archives, null, 2));
        console.log(`[Manager] ♻️  Đã khôi phục ${restoredCount} profile từ nhóm [${groupName}]`);
        return restoredCount;
    }

    /** Lấy danh sách các nhóm lưu trữ và số lượng profile */
    getArchiveGroups() {
        if (!fs.existsSync(this.archivesMetaFile)) return [];
        const archives = JSON.parse(fs.readFileSync(this.archivesMetaFile, 'utf8'));
        return Object.keys(archives).map(name => ({
            name,
            count: archives[name].length,
            profiles: archives[name]
        }));
    }

    /** Xóa vĩnh viễn một nhóm lưu trữ */
    deleteArchiveGroup(groupName) {
        const archives = JSON.parse(fs.readFileSync(this.archivesMetaFile, 'utf8'));
        if (archives[groupName]) {
            delete archives[groupName];
            const groupDir = path.join(this.archivesDir, groupName);
            if (fs.existsSync(groupDir)) fs.rmSync(groupDir, { recursive: true, force: true });
            fs.writeFileSync(this.archivesMetaFile, JSON.stringify(archives, null, 2));
            console.log(`[Manager] 🗑️ Đã xóa vĩnh viễn nhóm lưu trữ [${groupName}]`);
            return true;
        }
        return false;
    }

    // ========================================================================
    // KHỞI CHẠY / ĐÓNG TRÌNH DUYỆT
    // ========================================================================

    /** Mở trình duyệt với profile đã chọn */
    async launchProfile(profileId, options = {}) {
        const { blockImages = false, headless = false, startUrl = 'about:blank', extraArgs = [], skipWatcher = false } = options;

        // Nếu profile đang chạy sẵn, trả về context hiện tại — không mở lại
        if (this.runningProfiles.has(profileId)) {
            const existing = this.runningProfiles.get(profileId);
            let isAlive = false;
            try {
                // Thử lấy danh sách pages để kiểm tra xem context/browser có còn sống không
                existing.context.pages();
                isAlive = true;
            } catch (e) {
                console.log(`[Manager] ⚠️ Profile [${profileId}] context đã chết, tiến hành dọn dẹp và mở mới.`);
                this.runningProfiles.delete(profileId);
                stopGestureWatcher(profileId);
            }
            if (isAlive) {
                const pages = existing.context.pages();
                const page = pages[pages.length - 1] || await existing.context.newPage();
                console.log(`[Manager] ♻️  Profile [${profileId}] đang chạy sẵn — tái sử dụng.`);
                return { context: existing.context, page, profileData: this.getProfile(profileId), wsEndpoint: null, debugPort: null };
            }
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
        
        const settings = this.getSettings();

        // Helper: Check nếu string là proxy hợp lệ (không rỗng, không phải NONE/DIRECT)
        const hasValidProxy = (raw) => {
            if (!raw) return false;
            const s = String(raw).trim().toUpperCase();
            return s !== '' && s !== 'NONE' && s !== 'DIRECT' && s !== 'NULL' && s !== 'UNDEFINED';
        };

        // Helper: Parse proxy string (ip:port, ip:port:user:pass, user:pass:ip:port, http://user:pass@ip:port)
        const parseProxy = (raw) => {
            if (!hasValidProxy(raw)) return null;
            let t = String(raw).trim();

            let server = '';
            let username = '';
            let password = '';

            if (t.includes('://')) {
                try {
                    const u = new URL(t);
                    server = `${u.protocol}//${u.host}`;
                    username = decodeURIComponent(u.username || '');
                    password = decodeURIComponent(u.password || '');
                    return { server, username, password };
                } catch (e) {
                    t = t.replace(/^(http|https|socks5):\/\//i, '');
                }
            }

            const p = t.split(':');
            if (p.length === 4) {
                // Check if p[0] is IP/host or username
                if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(p[0]) || (p[0].includes('.') && /^\d+$/.test(p[1]))) {
                    // ip:port:user:pass
                    server = `http://${p[0]}:${p[1]}`;
                    username = p[2];
                    password = p[3];
                } else {
                    // user:pass:ip:port
                    username = p[0];
                    password = p[1];
                    server = `http://${p[2]}:${p[3]}`;
                }
            } else if (p.length === 2) {
                // ip:port
                server = `http://${p[0]}:${p[1]}`;
            } else {
                server = `http://${t}`;
            }

            return { server, username, password };
        };

        let effectiveProxyRaw = null;
        const isMultiProxyEnabled = settings.multiProxy && settings.multiProxy.enabled && Array.isArray(settings.multiProxy.proxies) && settings.multiProxy.proxies.length > 0;

        if (this.isFeed) {
            // ====================================================================
            // CƠ CHẾ FEED MANAGER:
            // - Có proxy: dùng đúng IP/cổng/user/pass của proxy profile đó trực tiếp
            // - Không có proxy: dùng IP mạng thật của máy tính (Direct connection)
            // - Tuyệt đối KHÔNG bao giờ ép qua cổng trung gian 127.0.0.1:8888
            // ====================================================================
            if (hasValidProxy(profileData.proxy)) {
                effectiveProxyRaw = profileData.proxy.trim();
                console.log(`[FeedManager] 🌐 Profile [${profileData.name}] CÓ PROXY → Sử dụng Proxy riêng: ${effectiveProxyRaw}`);
            } else {
                effectiveProxyRaw = null;
                console.log(`[FeedManager] 🏠 Profile [${profileData.name}] KHÔNG CÓ PROXY → Kết nối trực tiếp qua mạng máy thật`);
            }
        } else {
            // Profile Manager gốc (Xsurau)
            if (isMultiProxyEnabled) {
                const allProfiles = this.listProfiles();
                const profileIndex = allProfiles.findIndex(p => p.id === profileId);
                const idx = profileIndex >= 0 ? profileIndex : 0;
                const chosenProxy = settings.multiProxy.proxies[idx % settings.multiProxy.proxies.length];
                if (chosenProxy && chosenProxy.trim()) {
                    profileData.proxy = chosenProxy.trim();
                    console.log(`[Manager] 🔀 Multi-Proxy Auto-Balancer: Profile ${profileId} (#${idx + 1}) → Proxy #${(idx % settings.multiProxy.proxies.length) + 1} [${chosenProxy.trim()}]`);
                }
                effectiveProxyRaw = profileData.proxy;
            } else if (options.proxyMode === 'individual' || options.proxyMode === 'direct') {
                effectiveProxyRaw = hasValidProxy(profileData.proxy) ? profileData.proxy.trim() : null;
            } else {
                // Gateway 8888 mode
                effectiveProxyRaw = 'http://127.0.0.1:8888';
                if (!proxyService.activeUpstream) {
                    const initialProxy = (hasValidProxy(profileData.proxy) ? profileData.proxy.trim() : null) || '160.250.166.17:10873';
                    proxyService.activeUpstream = initialProxy;
                    console.log(`[Manager] Auto-initialized gateway activeUpstream to P1 default: ${initialProxy}`);
                }
            }
        }

        const effectiveProxyObj = effectiveProxyRaw ? parseProxy(effectiveProxyRaw) : null;
        
        const profileDir = path.join(this.profilesDataPath, profileId);
        
        // Kiểm tra xem profile đã có dữ liệu chưa (để biết là mở lần đầu hay mở lại)
        const isNewProfile = !fs.existsSync(path.join(profileDir, 'Default', 'Preferences'));

        // Đảm bảo profile cũ có đủ fingerprint data (backward compat)
        const screen = profileData.screen || { width: 1920, height: 1080 };
        const hwConcurrency = profileData.hardwareConcurrency || 8;
        const devMemory = profileData.deviceMemory || 8;
        let timezone = profileData.timezone || 'Asia/Ho_Chi_Minh';
        let locale = profileData.locale || 'vi-VN';

        // Generate a fake local IP from noiseSeed for WebRTC spoofing
        const rawSeed = profileData.noiseSeed || '12345';
        const seedInt = typeof rawSeed === 'string' ? (parseInt(rawSeed.substring(0, 8), 16) || 12345) : (rawSeed || 12345);
        const ip3 = (seedInt % 254) + 1;
        const ip4 = ((seedInt >> 8) % 254) + 1;
        const fakeLocalIp = `192.168.${ip3}.${ip4}`;

        // Auto Geo & Proxy Spoofing: Tự động đổi Múi giờ, Vị trí GPS, Locale & WebRTC IP theo Proxy
        const autoGeoSettings = settings.autoGeoProxy || {
            enabled: true,
            autoTimezone: true,
            autoGeolocation: true,
            autoLocale: true,
            realisticJitter: true
        };

        let webrtcIp = fakeLocalIp;
        let geolocationConfig = null;

        // Proxy dùng để tra cứu GeoIP:
        // Nếu feed hoặc individual: dùng effectiveProxyRaw (null nếu direct máy thật)
        // Nếu gateway mode: dùng upstream proxy của gateway
        const proxyForGeo = (this.isFeed || options.proxyMode === 'individual' || options.proxyMode === 'direct' || isMultiProxyEnabled)
            ? effectiveProxyRaw
            : (proxyService.activeUpstream || null);

        if (autoGeoSettings.enabled !== false) {
            try {
                const geoInfo = await geoService.resolveProxyGeo(proxyForGeo, profileData.noiseSeed, {
                    applyJitter: autoGeoSettings.realisticJitter !== false
                });

                if (geoInfo && geoInfo.ip && geoInfo.ip !== '127.0.0.1') {
                    webrtcIp = geoInfo.ip;
                }

                // 1. Đồng bộ Múi giờ (Timezone)
                if (autoGeoSettings.autoTimezone !== false) {
                    if (geoInfo.timezone && (profileData.timezone === 'auto' || !profileData.timezone || autoGeoSettings.autoTimezone)) {
                        timezone = geoInfo.timezone;
                    }
                }

                // 2. Đồng bộ Ngôn ngữ (Locale)
                if (autoGeoSettings.autoLocale !== false && geoInfo.locale) {
                    locale = geoInfo.locale;
                }

                // 3. Đồng bộ Vị trí GPS (Geolocation)
                if (autoGeoSettings.autoGeolocation !== false && geoInfo.lat && geoInfo.lon) {
                    geolocationConfig = {
                        latitude: geoInfo.lat,
                        longitude: geoInfo.lon,
                        accuracy: 50
                    };
                }

                console.log(`[Manager] 🌐 Auto Geo [${geoInfo.source}${geoInfo.cached ? ' (cached)' : ''}]: IP=${geoInfo.ip} | City=${geoInfo.city}, ${geoInfo.countryCode} | TZ=${timezone} | GPS=(${geoInfo.lat}, ${geoInfo.lon}) | Locale=${locale}`);
            } catch (geoErr) {
                console.warn(`[Manager] ⚠️ Auto Geo resolve error: ${geoErr.message}, fallback defaults.`);
            }
        } else {
            // Khi tắt Auto Geo: giữ nguyên logic WebRTC cũ
            if (effectiveProxyRaw) {
                try {
                    const fallbackGeo = await geoService.resolveProxyGeo(effectiveProxyRaw, profileData.noiseSeed);
                    if (fallbackGeo && fallbackGeo.ip && /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(fallbackGeo.ip)) {
                        webrtcIp = fallbackGeo.ip;
                    }
                } catch (e) {}
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
        // Fake camera mặc định: mọi profile đều có camera ảo sẵn
        // → Khi gặp Gesture Captcha, watcher tự giải ngay, không cần đóng/mở lại trình duyệt
        const handOpenY4m = path.join(__dirname, 'recordings', 'hand_open.y4m');
        let uniqueHandOpenY4m = handOpenY4m;

        if (fs.existsSync(handOpenY4m)) {
            try {
                const fakeCamDir = path.join(profileDir, 'fake_camera');
                if (!fs.existsSync(fakeCamDir)) {
                    fs.mkdirSync(fakeCamDir, { recursive: true });
                }
                const targetPath = path.join(fakeCamDir, 'hand_open.y4m');
                if (!fs.existsSync(targetPath)) {
                    try {
                        // Cố gắng tạo hard link để tiết kiệm dung lượng ổ đĩa (0 byte thêm)
                        fs.linkSync(handOpenY4m, targetPath);
                        console.log(`[Manager] 🔗 Đã tạo hard link fake camera cho profile ${profileId}`);
                    } catch (linkErr) {
                        // Fallback copy nếu khác ổ đĩa hoặc filesystem không hỗ trợ hard link
                        fs.copyFileSync(handOpenY4m, targetPath);
                        console.log(`[Manager] 📂 Đã copy fake camera cho profile ${profileId} do không tạo được hard link: ${linkErr.message}`);
                    }
                }
                uniqueHandOpenY4m = targetPath;

                // Xoá file switch cũ nếu có để tránh việc camera bị nhảy sang gesture khác khi vừa mở trình duyệt
                const switchFile = uniqueHandOpenY4m + '.switch';
                if (fs.existsSync(switchFile)) {
                    try { fs.unlinkSync(switchFile); } catch (e) {}
                }
            } catch (err) {
                console.error(`[Manager] ❌ Lỗi khi thiết lập fake camera riêng cho profile: ${err.message}`);
            }
        }

        const defaultFakeCamArgs = fs.existsSync(uniqueHandOpenY4m) ? [
            '--use-fake-device-for-media-stream',
            '--use-fake-ui-for-media-stream',
            `--use-file-for-fake-video-capture=${uniqueHandOpenY4m}`,
        ] : [];

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

            // --- FAKE CAMERA MỎC ĐỌNH (không cần relaunch) ---
            ...defaultFakeCamArgs,

            // Extra args từ caller
            ...extraArgs,
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

        if (geolocationConfig) {
            launchConfig.geolocation = geolocationConfig;
            launchConfig.permissions = ['geolocation'];
        }

        let anonymizedProxyUrl = null;
        if (effectiveProxyObj && effectiveProxyObj.server) {
            if (effectiveProxyObj.username || effectiveProxyObj.password) {
                try {
                    // Dùng proxy-chain tạo bridge local 127.0.0.1 để tự động xác thực proxy
                    // Tránh triệt để Chromium hiện popup "Sign in: The proxy requires a username and password"
                    const formattedProxy = proxyService.toProxyUrl(effectiveProxyRaw);
                    anonymizedProxyUrl = await proxyChain.anonymizeProxy(formattedProxy);
                    this.anonymizedProxies.set(profileId, anonymizedProxyUrl);
                    launchConfig.proxy = { server: anonymizedProxyUrl };
                    console.log(`[Manager] 🛡️ Proxy bridge tự động xác thực: ${anonymizedProxyUrl} -> ${effectiveProxyObj.server}`);
                } catch (anonErr) {
                    console.warn(`[Manager] ⚠️ AnonymizeProxy error: ${anonErr.message}`);
                    launchConfig.proxy = { server: effectiveProxyObj.server };
                    if (effectiveProxyObj.username) launchConfig.proxy.username = effectiveProxyObj.username;
                    if (effectiveProxyObj.password) launchConfig.proxy.password = effectiveProxyObj.password;
                }
            } else {
                launchConfig.proxy = { server: effectiveProxyObj.server };
            }
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
                try {
                    context = await chromium.launchPersistentContext(profileDir, launchConfig);
                } catch (retryErr) {
                    if (anonymizedProxyUrl) {
                        try { await proxyChain.closeAnonymizedProxy(anonymizedProxyUrl, true); } catch (_) {}
                        this.anonymizedProxies.delete(profileId);
                    }
                    throw retryErr;
                }
            } else {
                if (anonymizedProxyUrl) {
                    try { await proxyChain.closeAnonymizedProxy(anonymizedProxyUrl, true); } catch (_) {}
                    this.anonymizedProxies.delete(profileId);
                }
                throw err;
            }
        }

        // Tự động gán tọa độ Geolocation & quyền định vị cho context nếu có
        if (geolocationConfig) {
            try {
                await context.setGeolocation(geolocationConfig).catch(() => {});
                await context.grantPermissions(['geolocation']).catch(() => {});
            } catch (e) {}
        }

        // ❌ KHÔNG dùng addInitScript — Cloudflare detect MỌI Object.defineProperty
        // Screen/Timezone/Locale đã được xử lý native bởi patchright
        // hardwareConcurrency/deviceMemory cần C++ patch trong tương lai
        console.log(`[Manager] 🎭 GPU: ${profileData.gpu.renderer.substring(0, 50)}`);
        console.log(`[Manager] 🖥️  Screen: ${screen.width}x${screen.height}`);
        console.log(`[Manager] 🌍 TZ: ${timezone} | Locale: ${locale}${geolocationConfig ? ` | GPS: (${geolocationConfig.latitude}, ${geolocationConfig.longitude})` : ''}`);
        console.log(`[Manager] 🔒 WebRTC: disabled non-proxied UDP`);

        // Chặn tài nguyên nặng nếu bật blockImages hoặc settings.smartBandwidthSaver
        const shouldBlockImages = options.blockImages || settings.smartBandwidthSaver || false;
        if (shouldBlockImages) {
            await context.route('**/*', route => {
                const req = route.request();
                const type = req.resourceType();
                const url = req.url().toLowerCase();

                // Whitelist CHỈ dành riêng cho Captcha (loại bỏ gstatic.com chung để chặn Logo Google)
                const isCaptchaAsset = url.includes('recaptcha') ||
                                       url.includes('cloudflare') ||
                                       url.includes('hcaptcha') ||
                                       url.includes('turnstile') ||
                                       url.includes('/api/gesture-watch');

                if (!isCaptchaAsset && ['image', 'media', 'font'].includes(type)) {
                    return route.abort('blockedbyclient');
                }
                return route.continue();
            });
            console.log(`[Manager] ⚡ Smart Bandwidth Saver: ACTIVE (Chặn ảnh web, Giữ 100% ảnh Captcha)`);
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

        // ====================================================================
        // REAL-TIME AUTO-SYNC TÀI KHOẢN MICROSOFT KHI ĐANG MỞ HOẶC KHI ĐĂNG NHẬP
        // ====================================================================
        const triggerSync = async () => {
            try {
                if (!this.runningProfiles.has(profileId)) return;
                const email = await extractAccountFromRunningContext(context);
                if (email && isValidAccountEmail(email) && email !== profileData.account) {
                    profileData.account = email;
                    const metaFile = path.join(this.profilesMetaPath, `${profileId}.json`);
                    fs.writeFileSync(metaFile, JSON.stringify(profileData, null, 2));
                    this.profilesCache.set(profileId, profileData);
                    console.log(`[Manager] ⚡ [Live-Sync] Đã tự động nhận diện & sync tài khoản: ${email}`);
                }
            } catch (_) {}
        };

        // 1. Tự động sync ngay khi vừa mở trình duyệt lên
        setTimeout(async () => {
            if (!profileData.account) {
                await this.extractAccount(profileId).catch(() => {});
            } else {
                await triggerSync();
            }
        }, 1200);

        // 2. Gắn listener trên mọi trang (khi chuyển tab, đổi URL, load xong, form submit)
        const setupPageSync = (p) => {
            p.on('framenavigated', (frame) => {
                if (frame === p.mainFrame()) {
                    const u = frame.url();
                    if (u.includes('microsoft') || u.includes('live.com') || u.includes('bing.com') || u.includes('office.com') || u.includes('msn.com')) {
                        setTimeout(triggerSync, 800);
                    }
                }
            });

            p.on('domcontentloaded', () => {
                const u = p.url();
                if (u.includes('microsoft') || u.includes('live.com') || u.includes('bing.com') || u.includes('office.com') || u.includes('msn.com')) {
                    setTimeout(triggerSync, 600);
                }
            });

            // Bắt email ngay lập tức khi người dùng submit form đăng nhập Microsoft
            p.on('request', (req) => {
                try {
                    const postData = req.postData();
                    if (postData && (postData.includes('login=') || postData.includes('loginfmt=') || postData.includes('username='))) {
                        const m = postData.match(/(?:login|loginfmt|username)=([^&]+)/i);
                        if (m) {
                            const clean = decodeURIComponent(m[1]).trim().toLowerCase();
                            if (isValidAccountEmail(clean) && clean !== profileData.account) {
                                profileData.account = clean;
                                const metaFile = path.join(this.profilesMetaPath, `${profileId}.json`);
                                fs.writeFileSync(metaFile, JSON.stringify(profileData, null, 2));
                                this.profilesCache.set(profileId, profileData);
                                console.log(`[Manager] ⚡ [Live-Sync] Bắt email từ form đăng nhập: ${clean}`);
                            }
                        }
                    }
                } catch (_) {}
            });
        };

        context.pages().forEach(setupPageSync);
        context.on('page', setupPageSync);

        // 3. Poller ngầm nhẹ nhàng kiểm tra mỗi 2.5s khi đang mở
        const liveSyncInterval = setInterval(async () => {
            if (!this.runningProfiles.has(profileId)) {
                clearInterval(liveSyncInterval);
                return;
            }
            if (!profileData.account) {
                await triggerSync();
            }
        }, 2500);

        // Khi profile bị đóng (user đóng cửa sổ), tự dọn dẹp
        context.on('close', () => {
            clearInterval(liveSyncInterval);
            this.runningProfiles.delete(profileId);
            if (this.anonymizedProxies.has(profileId)) {
                const anonUrl = this.anonymizedProxies.get(profileId);
                this.anonymizedProxies.delete(profileId);
                proxyChain.closeAnonymizedProxy(anonUrl, true).catch(() => {});
            }
            stopGestureWatcher(profileId); // Dừng watcher nếu có
            console.log(`[Manager] ⏹️ Profile [${profileData.name}] đã đóng.`);
            // Tự động quét tài khoản Microsoft sau khi tắt
            setTimeout(() => {
                this.extractAccount(profileId).catch(() => {});
            }, 1200);
        });

        // Gesture Captcha Watcher KHÔNG tự động gắn khi mở browser.
        // Người dùng phải bấm nút 🖐️ SOLVE GESTURE trong UI để bắt đầu.

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


    /** Đóng 1 profile */
    async closeProfile(profileId, skipWmic = false) {
        stopGestureWatcher(profileId); // Dừng watcher ngay lập tức trước khi close context
        if (this.anonymizedProxies.has(profileId)) {
            const anonUrl = this.anonymizedProxies.get(profileId);
            this.anonymizedProxies.delete(profileId);
            try {
                await proxyChain.closeAnonymizedProxy(anonUrl, true);
            } catch (_) {}
        }
        const running = this.runningProfiles.get(profileId);
        
        // Thử quét tài khoản trước khi context bị đóng
        if (running && running.context) {
            try {
                await Promise.race([
                    this.extractAccount(profileId),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Extract Timeout')), 1000))
                ]);
            } catch (_) {}
        }

        // 1. Dọn khỏi RAM ngay lập tức để UI nhận phản hồi
        if (running) {
            this.runningProfiles.delete(profileId);
            try {
                await Promise.race([
                    running.context.close(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Close Timeout')), 1500))
                ]);
            } catch (e) {
                console.warn(`[Manager] ⚠️ Đóng profile ${profileId} chậm...`);
            }
        }
        
        // 2. Dọn tiến trình Chrome mồ côi nếu có (không block)
        if (!skipWmic) {
            const { exec } = require('child_process');
            exec(`powershell -Command "Get-CimInstance Win32_Process -Filter \\"Name='chrome.exe'\\" | Where-Object { $_.CommandLine -like '*${profileId}*' } | Stop-Process -Force"`, () => {});
        }
    }

    /** Đóng tất cả đồng thời */
    async closeAll() {
        for (const [pId, anonUrl] of this.anonymizedProxies.entries()) {
            try { await proxyChain.closeAnonymizedProxy(anonUrl, true); } catch (_) {}
        }
        this.anonymizedProxies.clear();
        const ids = [...this.runningProfiles.keys()];
        ids.forEach(id => stopGestureWatcher(id));
        
        // Gọi closeProfile nhưng BỎ QUA kill lẻ để dồn vào 1 lệnh cuối
        await Promise.allSettled(ids.map(id => this.closeProfile(id, true)));

        // Dọn tiến trình Chrome rác ngầm
        const { exec } = require('child_process');
        return new Promise((resolve) => {
            exec(`powershell -Command "Get-CimInstance Win32_Process -Filter \\"Name='chrome.exe'\\" | Where-Object { $_.CommandLine -like '*profiles_data*' } | Stop-Process -Force"`, () => {
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
