/**
 * DIAGNOSE-TURNSTILE.JS
 * Chẩn đoán nhanh tại sao Cloudflare Turnstile fail.
 * Chạy: node diagnose-turnstile.js <profileId>
 * Kết quả: in ra console + lưu diagnose_result.json
 */

const ProfileManager = require('../manager');
const fs = require('fs');
const path = require('path');

const profileId = process.argv[2];
if (!profileId) {
    console.error('Usage: node diagnose-turnstile.js <profileId>');
    console.error('Lấy profileId từ G:\\XsurauData\\profiles_meta\\');
    process.exit(1);
}

async function diagnose() {
    const manager = new ProfileManager();
    console.log(`\n🔍 Đang chẩn đoán profile: ${profileId}\n`);

    const { context, page } = await manager.launchProfile(profileId, {
        startUrl: 'about:blank',
        headless: false,
    });

    const results = {};

    // ─────────────────────────────────────────────────────────────────────
    // 1. KIỂM TRA CÁC SIGNAL CLOUDFLARE THƯỜNG CHECK
    // ─────────────────────────────────────────────────────────────────────
    console.log('📋 Đang đọc browser signals...');
    const signals = await page.evaluate(() => {
        const r = {};

        // Navigator basics
        r.userAgent       = navigator.userAgent;
        r.webdriver       = navigator.webdriver;
        r.platform        = navigator.platform;
        r.languages       = JSON.stringify(navigator.languages);
        r.hardwareConcurrency = navigator.hardwareConcurrency;
        r.deviceMemory    = navigator.deviceMemory;
        r.maxTouchPoints  = navigator.maxTouchPoints;
        r.plugins         = navigator.plugins.length;
        r.doNotTrack      = navigator.doNotTrack;

        // userAgentData
        try {
            const uad = navigator.userAgentData;
            r.uadBrands   = JSON.stringify(uad?.brands);
            r.uadPlatform = uad?.platform;
            r.uadMobile   = uad?.mobile;
        } catch(e) { r.uadBrands = 'ERROR: ' + e.message; }

        // Chrome object
        r.chromeObj       = typeof window.chrome;
        r.chromeRuntime   = typeof window.chrome?.runtime;
        r.chromeLoadTimes = typeof window.chrome?.loadTimes;

        // Playwright/CDP artifacts
        r.playwright      = typeof window.__playwright;
        r.pwManual        = typeof window.__pw_manual;
        r.cdc             = Object.keys(window).filter(k => k.startsWith('cdc_')).join(', ') || 'none';
        r.seleniumGdcL    = typeof window.$cdc_asdjflasutopfhvcZLmcfl_;

        // Permissions API (Cloudflare check)
        r.notificationPerm = 'checking...';

        // WebGL
        try {
            const canvas = document.createElement('canvas');
            const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
            r.webglVendor   = gl?.getParameter(0x1F00);
            r.webglRenderer = gl?.getParameter(0x1F01);
            r.webglVendorExt = gl?.getParameter(0x9245);
        } catch(e) { r.webglVendor = 'ERROR'; }

        // Canvas
        try {
            const c = document.createElement('canvas');
            c.width = 200; c.height = 50;
            const ctx = c.getContext('2d');
            ctx.textBaseline = 'top';
            ctx.font = '14px Arial';
            ctx.fillText('Cwm fjordbank glyphs vext quiz', 2, 2);
            r.canvasHash = c.toDataURL().slice(-20);
        } catch(e) { r.canvasHash = 'ERROR'; }

        // Screen
        r.screen = `${screen.width}x${screen.height} dpr=${window.devicePixelRatio}`;

        // window.outerWidth/outerHeight vs innerWidth/innerHeight
        r.outerInner = `outer=${window.outerWidth}x${window.outerHeight} inner=${window.innerWidth}x${window.innerHeight}`;

        return r;
    });

    // Check permissions separately (needs async)
    try {
        signals.notificationPerm = await page.evaluate(async () => {
            try {
                const p = await navigator.permissions.query({ name: 'notifications' });
                return p.state;
            } catch(e) { return 'ERROR: ' + e.message; }
        });
    } catch(e) {}

    results.signals = signals;

    // ─────────────────────────────────────────────────────────────────────
    // 2. KIỂM TRA TRÊN BOT DETECTION SITES
    // ─────────────────────────────────────────────────────────────────────

    // 2a. browserscan.net/bot-detection
    console.log('\n🌐 Đang check browserscan.net...');
    try {
        await page.goto('https://www.browserscan.net/bot-detection', { waitUntil: 'networkidle', timeout: 15000 });
        await page.waitForTimeout(3000);
        const bsResult = await page.evaluate(() => {
            const items = {};
            document.querySelectorAll('tr, .check-item, [class*="row"]').forEach(row => {
                const cells = row.querySelectorAll('td, [class*="cell"], [class*="value"]');
                if (cells.length >= 2) {
                    const key = cells[0].textContent?.trim();
                    const val = cells[1].textContent?.trim();
                    if (key && val && key.length < 60) items[key] = val;
                }
            });
            // Fallback: lấy text chứa PASS/FAIL
            document.querySelectorAll('*').forEach(el => {
                const text = el.textContent?.trim();
                if (text && (text.includes('✓') || text.includes('✗') || 
                    text.toLowerCase().includes('pass') || text.toLowerCase().includes('fail')) 
                    && text.length < 100 && el.children.length === 0) {
                    items['_raw_' + el.className] = text;
                }
            });
            return items;
        });
        results.browserscan = bsResult;
        await page.screenshot({ path: 'diagnose_browserscan.png', fullPage: true });
        console.log('   ✅ Screenshot lưu: diagnose_browserscan.png');
    } catch(e) {
        results.browserscan = { error: e.message };
        console.log('   ❌ browserscan lỗi:', e.message);
    }

    // 2b. bot.sannysoft.com
    console.log('\n🌐 Đang check bot.sannysoft.com...');
    try {
        await page.goto('https://bot.sannysoft.com/', { waitUntil: 'networkidle', timeout: 15000 });
        await page.waitForTimeout(2000);
        const sResult = await page.evaluate(() => {
            const items = {};
            document.querySelectorAll('tr').forEach(row => {
                const cells = row.querySelectorAll('td');
                if (cells.length >= 2) {
                    const key = cells[0].textContent?.trim();
                    const val = cells[1].textContent?.trim();
                    const color = cells[1].style?.backgroundColor || cells[1].className;
                    if (key) items[key] = `${val} [${color}]`;
                }
            });
            return items;
        });
        results.sannysoft = sResult;
        await page.screenshot({ path: 'diagnose_sannysoft.png', fullPage: true });
        console.log('   ✅ Screenshot lưu: diagnose_sannysoft.png');
    } catch(e) {
        results.sannysoft = { error: e.message };
        console.log('   ❌ sannysoft lỗi:', e.message);
    }

    // 2c. pixelscan.net
    console.log('\n🌐 Đang check pixelscan.net...');
    try {
        await page.goto('https://pixelscan.net/', { waitUntil: 'networkidle', timeout: 15000 });
        await page.waitForTimeout(4000); // pixelscan cần thời gian load
        await page.screenshot({ path: 'diagnose_pixelscan.png', fullPage: true });
        console.log('   ✅ Screenshot lưu: diagnose_pixelscan.png');
        results.pixelscan = 'screenshot only - xem file';
    } catch(e) {
        results.pixelscan = { error: e.message };
    }

    // ─────────────────────────────────────────────────────────────────────
    // 3. IN KẾT QUẢ
    // ─────────────────────────────────────────────────────────────────────
    console.log('\n' + '═'.repeat(60));
    console.log('📊 KẾT QUẢ CHẨN ĐOÁN SIGNALS');
    console.log('═'.repeat(60));

    const s = signals;
    const check = (name, val, isGood) => {
        const icon = isGood ? '✅' : '❌';
        console.log(`${icon} ${name.padEnd(25)} ${val}`);
    };

    check('webdriver',       s.webdriver,    s.webdriver === false);
    check('chrome obj',      s.chromeObj,    s.chromeObj === 'object');
    check('chrome.runtime',  s.chromeRuntime, s.chromeRuntime === 'object');
    check('playwright trace', s.playwright,  s.playwright === 'undefined');
    check('cdc_ keys',       s.cdc,          s.cdc === 'none');
    check('plugins count',   s.plugins,      s.plugins > 0);
    check('maxTouchPoints',  s.maxTouchPoints, s.maxTouchPoints === 0);
    check('uad brands',      s.uadBrands,    (s.uadBrands || '').includes('Google Chrome'));
    check('notif perm',      s.notificationPerm, s.notificationPerm !== 'denied');
    check('webgl vendor',    s.webglVendor?.substring(0, 30), true);
    check('UA',              s.userAgent?.substring(0, 50), true);

    console.log('═'.repeat(60));
    console.log(`\n📁 Lưu kết quả: diagnose_result.json`);
    console.log('📸 Screenshots: diagnose_browserscan.png, diagnose_sannysoft.png, diagnose_pixelscan.png\n');

    fs.writeFileSync('diagnose_result.json', JSON.stringify(results, null, 2));

    // Giữ browser mở 30s để xem thủ công
    console.log('⏳ Browser mở thêm 30 giây để xem thủ công...');
    await page.waitForTimeout(30000);
    await manager.closeProfile(profileId);
    process.exit(0);
}

diagnose().catch(e => {
    console.error('❌ Lỗi:', e.message);
    process.exit(1);
});
