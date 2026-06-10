/**
 * test-gesture-solver.js
 * Script test tích hợp toàn bộ luồng:
 * Mở Chrome → Đăng nhập Google → Tự động vượt gesture captcha
 */
const { chromium } = require('patchright');
const { setupGestureCaptchaSolver } = require('./automations/solve-gesture-captcha');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CHROME_PATH = 'K:\\chromium_src\\src\\out\\Xsurau\\chrome.exe';
const RECORDINGS_DIR = path.join(__dirname, 'recordings');
const VIDEO_SERVER_PORT = 17771; // HTTP server serve video local

/**
 * Khởi động HTTP server nhỏ để serve các file MP4 từ thư mục recordings
 * Cần thiết vì Chrome chặn file:/// URL từ trong trang web (cross-origin security)
 */
function startVideoServer() {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            // Chỉ serve file MP4 từ thư mục recordings
            const fileName = path.basename(req.url); // bỏ path traversal
            const filePath = path.join(RECORDINGS_DIR, fileName);

            // Header CORS cho phép tất cả origin (cần thiết cho iframe của Google)
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Range');
            res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length');

            if (req.method === 'OPTIONS') {
                res.writeHead(204);
                res.end();
                return;
            }

            if (!fs.existsSync(filePath)) {
                console.warn(`[VideoServer] File không tồn tại: ${filePath}`);
                res.writeHead(404);
                res.end('Not Found');
                return;
            }

            const stat = fs.statSync(filePath);
            const fileSize = stat.size;
            const range = req.headers.range;

            if (range) {
                // Hỗ trợ Range requests (cần cho video streaming trong browser)
                const parts = range.replace(/bytes=/, '').split('-');
                const start = parseInt(parts[0], 10);
                const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
                const chunkSize = (end - start) + 1;

                res.writeHead(206, {
                    'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                    'Accept-Ranges': 'bytes',
                    'Content-Length': chunkSize,
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

        server.listen(VIDEO_SERVER_PORT, '127.0.0.1', () => {
            console.log(`\x1b[32m[VideoServer] HTTP server đang serve video tại http://127.0.0.1:${VIDEO_SERVER_PORT}/\x1b[0m`);
            resolve(server);
        });
    });
}

async function main() {
    console.log('\x1b[36m========================================================\x1b[0m');
    console.log('\x1b[36m   XSURAU - TEST GESTURE CAPTCHA SOLVER\x1b[0m');
    console.log('\x1b[36m========================================================\x1b[0m\n');

    // Bước 1: Khởi động HTTP server serve video
    const videoServer = await startVideoServer();

    const context = await chromium.launchPersistentContext('', {
        executablePath: CHROME_PATH,
        headless: false,
        args: [
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-blink-features=AutomationControlled',
        ],
        permissions: ['camera', 'microphone'],
        // Grant camera permissions cho Google domains
        extraHTTPHeaders: {},
    });

    // Grant camera permissions cho tất cả trang
    await context.grantPermissions(['camera', 'microphone'], { origin: 'https://accounts.google.com' });
    await context.grantPermissions(['camera', 'microphone'], { origin: 'https://www.google.com' });

    const page = await context.newPage();

    // Khởi tạo gesture solver — truyền VIDEO_SERVER_PORT để dùng HTTP URL
    const solver = await setupGestureCaptchaSolver(context, page, VIDEO_SERVER_PORT);

    console.log('[*] Đang mở Google accounts...');
    await page.goto('https://accounts.google.com/', { waitUntil: 'domcontentloaded' });

    console.log('\x1b[33m[*] Hướng dẫn:\x1b[0m');
    console.log('  1. Đăng nhập vào tài khoản Google của bạn trong trình duyệt.');
    console.log('  2. Khi xuất hiện màn hình captcha "Gesture with your hand", nhấn Next.');
    console.log('  3. Hệ thống sẽ TỰ ĐỘNG phát video bàn tay và switch gesture!');
    console.log('  4. Bạn không cần làm gì thêm.\n');

    console.log('[*] Script sẽ TỰ ĐỘNG theo dõi và kích hoạt video khi captcha xuất hiện.\n');

    // Giám sát vô hạn
    while (true) {
        try {
            const currentUrl = page.url();

            if (currentUrl.includes('challenge') || currentUrl.includes('recaptcha')) {
                console.log(`\x1b[32m[OK] Đã phát hiện trang captcha!\x1b[0m`);

                await page.waitForTimeout(2000);

                await solver.switchTo('hand_open');
                console.log('[*] ✅ Đã kích hoạt video bàn tay bước 1...');

                console.log('[*] Đang giám sát gesture instruction bước 2...');
                const result = await solver.watchAndSolve(90000);

                if (result.success) {
                    console.log(`\x1b[32m[✓] Detect và switch gesture: "${result.detectedText}" → ${result.gesture}\x1b[0m`);
                } else {
                    console.log(`\x1b[33m[!] Timeout bước 2. Có thể đã xong hoặc reset.\x1b[0m`);
                }

                await page.waitForTimeout(3000);
            } else {
                await page.waitForTimeout(500);
            }
        } catch (e) {
            await page.waitForTimeout(500);
        }
    }
}

main().catch(err => {
    console.error('[Lỗi]', err.message);
});
