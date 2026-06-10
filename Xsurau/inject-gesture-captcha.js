/**
 * inject-gesture-captcha.js
 * Connect vào profile Xsurau đang chạy qua CDP
 * và inject fake camera stream cho gesture captcha
 * 
 * Cách dùng: node inject-gesture-captcha.js [profileId]
 * Ví dụ: node inject-gesture-captcha.js profile_1780735759572_73caea
 */

const { chromium } = require('patchright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { setupGestureCaptchaSolver, detectGestureFromText } = require('./automations/solve-gesture-captcha');

const RECORDINGS_DIR = path.join(__dirname, 'recordings');
const VIDEO_SERVER_PORT = 17771;

// Map profileId → thư mục profile data
const PROFILES_DATA_DIR = 'G:\\XsurauData\\profiles_data';

/**
 * Đọc debug port từ file DevToolsActivePort trong profile dir
 */
function getProfileDebugPort(profileId) {
    const portFile = path.join(PROFILES_DATA_DIR, profileId, 'DevToolsActivePort');
    if (!fs.existsSync(portFile)) {
        return null;
    }
    const content = fs.readFileSync(portFile, 'utf8').trim();
    const port = parseInt(content.split('\n')[0].trim());
    return isNaN(port) ? null : port;
}

/**
 * Liệt kê tất cả profile đang chạy (có DevToolsActivePort)
 */
function getRunningProfiles() {
    if (!fs.existsSync(PROFILES_DATA_DIR)) return [];
    return fs.readdirSync(PROFILES_DATA_DIR)
        .filter(name => name.startsWith('profile_'))
        .map(name => {
            const port = getProfileDebugPort(name);
            return port ? { id: name, port } : null;
        })
        .filter(Boolean);
}

/**
 * HTTP server serve video files với CORS headers
 */
function startVideoServer() {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            const fileName = path.basename(req.url);
            const filePath = path.join(RECORDINGS_DIR, fileName);

            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
            res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length');

            if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

            if (!fs.existsSync(filePath)) {
                res.writeHead(404); res.end('Not Found'); return;
            }

            const stat = fs.statSync(filePath);
            const fileSize = stat.size;
            const range = req.headers.range;

            if (range) {
                const parts = range.replace(/bytes=/, '').split('-');
                const start = parseInt(parts[0], 10);
                const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
                res.writeHead(206, {
                    'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                    'Accept-Ranges': 'bytes',
                    'Content-Length': (end - start) + 1,
                    'Content-Type': 'video/mp4',
                });
                fs.createReadStream(filePath, { start, end }).pipe(res);
            } else {
                res.writeHead(200, {
                    'Content-Length': fileSize,
                    'Content-Type': 'video/mp4',
                    'Accept-Ranges': 'bytes',
                });
                fs.createReadStream(filePath).pipe(res);
            }
        });

        // Kiểm tra port có đang dùng không
        server.on('error', (e) => {
            if (e.code === 'EADDRINUSE') {
                console.log(`[VideoServer] Port ${VIDEO_SERVER_PORT} đã dùng — dùng server hiện có`);
                resolve(null);
            }
        });

        server.listen(VIDEO_SERVER_PORT, '127.0.0.1', () => {
            console.log(`\x1b[32m[VideoServer] Đang serve video tại http://127.0.0.1:${VIDEO_SERVER_PORT}/\x1b[0m`);
            resolve(server);
        });
    });
}

/**
 * Inject getUserMedia override vào một page cụ thể (và tất cả frame của nó)
 */
async function injectFakeCameraIntoPage(page, videoBaseUrl) {
    const initScript = `
(function() {
    if (window.__xsurauFakeCameraInstalled) return;
    window.__xsurauFakeCameraInstalled = true;

    const fakeVideo = document.createElement('video');
    fakeVideo.loop = true;
    fakeVideo.muted = true;
    fakeVideo.playsInline = true;
    fakeVideo.autoplay = true;
    fakeVideo.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;';
    document.documentElement.appendChild(fakeVideo);

    window.__xsurauFakeCamera = fakeVideo;

    window.switchGestureVideo = function(gestureName) {
        const src = '${videoBaseUrl}/' + gestureName + '.mp4';
        console.log('[FakeCamera] Switch:', gestureName, '->', src);
        fakeVideo.src = src;
        fakeVideo.load();
        fakeVideo.play().catch(() => {});
        return gestureName;
    };

    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const _orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = async function(constraints) {
            if (constraints && constraints.video) {
                console.log('[FakeCamera] getUserMedia intercepted!');
                if (fakeVideo.readyState < 2) {
                    await new Promise(r => {
                        fakeVideo.addEventListener('canplay', r, { once: true });
                        setTimeout(r, 3000);
                    });
                }
                return fakeVideo.captureStream(30);
            }
            return _orig(constraints);
        };
        console.log('[FakeCamera] getUserMedia override OK');
    }
})();
`;

    // Inject vào main frame
    try {
        await page.addInitScript(initScript);
        await page.evaluate(initScript);
    } catch (e) { /* ignore */ }

    // Inject vào tất cả frames hiện có
    for (const frame of page.frames()) {
        try {
            await frame.evaluate(initScript);
        } catch (e) { /* cross-origin, skip */ }
    }
}

/**
 * Switch video trong tất cả frame của page
 */
async function switchVideoInPage(page, gestureName) {
    const videoPath = path.join(RECORDINGS_DIR, `${gestureName}.mp4`);
    if (!fs.existsSync(videoPath)) {
        console.warn(`[!] Chưa có video: ${gestureName}.mp4`);
        return false;
    }
    console.log(`\x1b[36m[🎬] Switch camera → ${gestureName}\x1b[0m`);

    for (const frame of page.frames()) {
        try {
            await frame.evaluate((name) => {
                if (window.switchGestureVideo) window.switchGestureVideo(name);
            }, gestureName);
        } catch (e) { /* skip */ }
    }
    return true;
}

/**
 * Theo dõi text trong captcha iframe và switch video
 */
async function watchAndSolve(page, timeoutMs = 90000) {
    const deadline = Date.now() + timeoutMs;
    let lastGesture = 'hand_open';

    while (Date.now() < deadline) {
        for (const frame of page.frames()) {
            if (!frame.url().includes('recaptcha') && !frame.url().includes('accounts.google')) continue;
            try {
                const texts = await frame.evaluate(() =>
                    Array.from(document.querySelectorAll('*'))
                        .filter(el => el.children.length === 0 && el.textContent.trim())
                        .map(el => el.textContent.trim())
                        .filter(t => t.length > 3 && t.length < 200)
                );
                for (const text of texts) {
                    const gesture = detectGestureFromText(text);
                    if (gesture && gesture !== lastGesture) {
                        console.log(`\x1b[32m[🔍] Phát hiện: "${text}" → ${gesture}\x1b[0m`);
                        await switchVideoInPage(page, gesture);
                        lastGesture = gesture;
                        return { success: true, detectedText: text, gesture };
                    }
                }
            } catch (e) { /* skip */ }
        }
        await new Promise(r => setTimeout(r, 100));
    }
    return { success: false, reason: 'timeout' };
}

async function main() {
    console.log('\x1b[36m========================================================\x1b[0m');
    console.log('\x1b[36m   XSURAU GESTURE CAPTCHA — INJECT VÀO PROFILE\x1b[0m');
    console.log('\x1b[36m========================================================\x1b[0m\n');

    // Tìm tất cả profile đang chạy
    const runningProfiles = getRunningProfiles();
    if (runningProfiles.length === 0) {
        console.error('[Lỗi] Không tìm thấy profile nào đang chạy!');
        console.log('[Hint] Mở ít nhất 1 profile từ Xsurau dashboard trước.');
        process.exit(1);
    }

    // Lấy profile theo tham số dòng lệnh hoặc profile đầu tiên
    const targetProfileId = process.argv[2];
    let profile;
    if (targetProfileId) {
        profile = runningProfiles.find(p => p.id === targetProfileId || p.id.includes(targetProfileId));
    }
    if (!profile) {
        profile = runningProfiles[0];
        console.log(`[*] Không chỉ định profile, dùng profile đầu tiên: ${profile.id}`);
    }

    console.log(`[*] Kết nối vào profile: \x1b[33m${profile.id}\x1b[0m`);
    console.log(`[*] CDP Port: \x1b[33m${profile.port}\x1b[0m`);
    console.log('\n[*] Các profile đang chạy:');
    runningProfiles.forEach(p => console.log(`    - ${p.id} (port: ${p.port})`));
    console.log('');

    // Khởi động HTTP video server
    await startVideoServer();
    const videoBaseUrl = `http://127.0.0.1:${VIDEO_SERVER_PORT}`;

    // Connect vào profile qua CDP
    let browser;
    try {
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${profile.port}`);
        console.log(`\x1b[32m[OK] Đã kết nối vào profile ${profile.id}!\x1b[0m`);
    } catch (e) {
        console.error(`[Lỗi] Không connect được vào port ${profile.port}: ${e.message}`);
        process.exit(1);
    }

    // Lấy tất cả context/page đang mở
    const contexts = browser.contexts();
    if (contexts.length === 0) {
        console.error('[Lỗi] Profile không có context nào đang mở!');
        process.exit(1);
    }

    const context = contexts[0];
    let pages = context.pages();
    console.log(`[*] Tìm thấy ${pages.length} tab đang mở`);

    // Inject fake camera vào TẤT CẢ page đang mở
    for (const page of pages) {
        const url = page.url();
        console.log(`[*] Inject vào tab: ${url.substring(0, 80)}`);
        await injectFakeCameraIntoPage(page, videoBaseUrl);
    }

    // Theo dõi khi có page mới mở
    context.on('page', async (newPage) => {
        await newPage.waitForLoadState('domcontentloaded').catch(() => {});
        console.log(`[*] Tab mới mở: ${newPage.url().substring(0, 80)}`);
        await injectFakeCameraIntoPage(newPage, videoBaseUrl);
    });

    console.log(`\n\x1b[32m[✓] Fake camera đã inject vào tất cả tab!\x1b[0m`);
    console.log('\x1b[33m[*] Hướng dẫn:\x1b[0m');
    console.log('  1. Trong trình duyệt profile, mở Google accounts và đăng nhập.');
    console.log('  2. Khi xuất hiện "Gesture with your hand" → nhấn Next.');
    console.log('  3. Script sẽ TỰ ĐỘNG kích hoạt video và detect bước 2!');
    console.log('  4. Xem log dưới đây để theo dõi.\n');

    // Giám sát vô hạn tất cả page
    while (true) {
        try {
            pages = context.pages();
            for (const page of pages) {
                const url = page.url();
                if (url.includes('challenge') || url.includes('recaptcha')) {
                    // Kích hoạt video bàn tay bước 1
                    await switchVideoInPage(page, 'hand_open');

                    console.log('[*] Đang giám sát gesture bước 2...');
                    const result = await watchAndSolve(page, 90000);

                    if (result.success) {
                        console.log(`\x1b[32m[✓] Xong! "${result.detectedText}" → ${result.gesture}\x1b[0m`);
                    } else {
                        console.log('[!] Timeout bước 2.');
                    }
                    await new Promise(r => setTimeout(r, 3000));
                }
            }
        } catch (e) { /* page đang navigate */ }
        await new Promise(r => setTimeout(r, 500));
    }
}

main().catch(err => console.error('[Lỗi]', err.message));
