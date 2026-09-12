/**
 * ============================================================================
 * MODULE GIẢ LẬP MICROSOFT EDGE CHO FEED PROFILES (LOOPY ANTIDETECT BROWSER)
 * Thư mục riêng biệt: k:\Surau\Loopy\feed-edge\
 * Dễ dàng bật/tắt hoặc xóa bỏ hoàn toàn mà không ảnh hưởng code gốc
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');

// Danh sách User-Agent Microsoft Edge chuẩn trên Windows 10 & 11
const EDGE_USER_AGENTS = [
    // Edge 136 (Stable)
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 Edg/136.0.3240.50',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 Edg/136.0.3240.64',
    // Edge 137 (Stable)
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36 Edg/137.0.3300.20',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36 Edg/137.0.3300.35',
    // Edge 138
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Edg/138.0.3350.18',
    // Edge 149 (Tương thích nhân Xsurau Chromium 149)
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.7812.0 Safari/537.36 Edg/149.0.7812.0',
    // Edge 150
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.7871.187 Safari/537.36 Edg/150.0.7871.187',
];

/**
 * Lấy ngẫu nhiên một Edge User-Agent
 */
function getRandomEdgeUA() {
    return EDGE_USER_AGENTS[Math.floor(Math.random() * EDGE_USER_AGENTS.length)];
}

/**
 * Phân tích version từ chuỗi User-Agent Edge
 */
function parseEdgeVersion(ua) {
    const match = ua.match(/Edg\/([\d.]+)/) || ua.match(/Chrome\/([\d.]+)/);
    const edgeVersion = match ? match[1] : '136.0.3240.50';
    const edgeMajor = parseInt(edgeVersion.split('.')[0], 10) || 136;
    const notABrandVer = edgeMajor >= 132 ? '99' : '24';
    return { edgeVersion, edgeMajor, notABrandVer };
}

/**
 * Thiết lập mẫu tìm kiếm Bing mặc định chuẩn Microsoft Edge (FORM=EDGE8N, PC=EUPP_)
 */
function applyEdgeBingDefaultSearch(profileDir) {
    try {
        if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir, { recursive: true });

        const edgeBingTemplate = {
            short_name: "Microsoft Bing",
            keyword: "bing.com",
            url: "https://www.bing.com/search?q={searchTerms}&FORM=EDGE8N&PC=EUPP_",
            suggestions_url: "https://www.bing.com/osjson.aspx?FORM=OSDJAS&PC=EUPP_&query={searchTerms}",
            favicon_url: "https://www.bing.com/favicon.ico",
            image_url: "https://www.bing.com/images/detail/search?iss=sbiupload&FORM=EDGE8N#enterInsights",
            image_url_post_params: "imageBin={google:imageThumbnailBase64}",
            new_tab_url: "https://www.bing.com/edge/newtab",
            safe_for_autoreplace: true,
            date_created: "0",
            last_modified: "0",
            is_active: 1,
            usage_count: 0,
            prepopulate_id: 3,
            synced_guid: "5b5934c9-5215-42b1-a745-89273a1b83c8"
        };

        // 1. Ghi initial_preferences
        const initPrefPath = path.join(profileDir, 'initial_preferences');
        if (!fs.existsSync(initPrefPath)) {
            fs.writeFileSync(initPrefPath, JSON.stringify({
                default_search_provider: { enabled: true },
                default_search_provider_data: { template_url_data: edgeBingTemplate }
            }, null, 2));
        }

        // 2. Cập nhật Default/Preferences
        const defaultDir = path.join(profileDir, 'Default');
        if (!fs.existsSync(defaultDir)) fs.mkdirSync(defaultDir, { recursive: true });

        const prefPath = path.join(defaultDir, 'Preferences');
        let prefs = {};
        if (fs.existsSync(prefPath)) {
            try { prefs = JSON.parse(fs.readFileSync(prefPath, 'utf8')); } catch (_) {}
        }

        if (!prefs.default_search_provider) prefs.default_search_provider = {};
        prefs.default_search_provider.enabled = true;
        prefs.default_search_provider.reset_occurred = false;

        if (!prefs.default_search_provider_data) prefs.default_search_provider_data = {};
        prefs.default_search_provider_data.template_url_data = edgeBingTemplate;

        fs.writeFileSync(prefPath, JSON.stringify(prefs, null, 2));
        console.log(`[EdgeEmulation] 🔍 Đã gán mẫu tìm kiếm Edge Bing (PC=EUPP_) cho profile`);
    } catch (e) {
        console.warn(`[EdgeEmulation] ⚠️ Lỗi gán Bing search Edge: ${e.message}`);
    }
}

/**
 * Thiết lập môi trường Edge cho BrowserContext
 * 1. Gửi Header Client Hints chuẩn Edge (sec-ch-ua) trên mọi request mạng
 * 2. Tiêm script cấu hình navigator.userAgentData chuẩn Edge
 */
async function setupEdgeContext(context, profileData) {
    const userAgent = profileData.userAgent || getRandomEdgeUA();
    const { edgeVersion, edgeMajor, notABrandVer } = parseEdgeVersion(userAgent);

    console.log(`[EdgeEmulation] 🚀 Đang khởi tạo môi trường Microsoft Edge v${edgeVersion} (Major: ${edgeMajor})...`);

    // 1. Extra HTTP Headers — Đảm bảo Bing nhận Sec-CH-UA chuẩn Edge trên mọi request
    const clientHints = {
        'sec-ch-ua': `"Microsoft Edge";v="${edgeMajor}", "Chromium";v="${edgeMajor}", "Not?A_Brand";v="${notABrandVer}"`,
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"'
    };

    try {
        await context.setExtraHTTPHeaders(clientHints);
    } catch (err) {
        console.warn('[EdgeEmulation] ⚠️ Không thể gán setExtraHTTPHeaders:', err.message);
    }

    // 2. DOM Injection Script — Cung cấp navigator.userAgentData chuẩn Edge
    const edgeInitScript = `(function() {
        'use strict';
        try {
            const _h = (window.location && window.location.hostname) || '';
            if (_h.includes('cloudflare.com') || _h.includes('hcaptcha.com') ||
                _h.includes('recaptcha.net') || _h.includes('challenges.')) {
                return;
            }
        } catch(e) {}

        const edgeMajor = "${edgeMajor}";
        const edgeVersion = "${edgeVersion}";
        const notABrandVer = "${notABrandVer}";

        const brands = [
            { brand: 'Microsoft Edge', version: edgeMajor },
            { brand: 'Chromium', version: edgeMajor },
            { brand: 'Not?A_Brand', version: notABrandVer }
        ];

        try {
            if (navigator.userAgentData) {
                Object.defineProperty(Navigator.prototype, 'userAgentData', {
                    get: () => ({
                        brands,
                        mobile: false,
                        platform: 'Windows',
                        getHighEntropyValues: async function(hints) {
                            const r = {};
                            hints.forEach(h => {
                                if (h === 'architecture') r.architecture = 'x86';
                                if (h === 'bitness') r.bitness = '64';
                                if (h === 'model') r.model = '';
                                if (h === 'platform') r.platform = 'Windows';
                                if (h === 'platformVersion') r.platformVersion = '10.0.0';
                                if (h === 'uaFullVersion') r.uaFullVersion = edgeVersion;
                                if (h === 'fullVersionList') r.fullVersionList = brands.map(b => ({ brand: b.brand, version: edgeVersion }));
                                if (h === 'wow64') r.wow64 = false;
                            });
                            return r;
                        },
                        toJSON() { return { brands, mobile: false, platform: 'Windows' }; }
                    }),
                    configurable: true
                });
            }
        } catch (e) {}

        // Edge indicator
        try {
            if (!window.StyleMedia) {
                window.StyleMedia = function() {};
            }
        } catch(e) {}
    })();`;

    try {
        await context.addInitScript({ content: edgeInitScript });
    } catch (err) {
        console.warn('[EdgeEmulation] ⚠️ Không thể gán addInitScript:', err.message);
    }
}

module.exports = {
    EDGE_USER_AGENTS,
    getRandomEdgeUA,
    parseEdgeVersion,
    applyEdgeBingDefaultSearch,
    setupEdgeContext
};
