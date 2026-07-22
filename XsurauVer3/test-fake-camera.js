/**
 * test-fake-camera.js
 * Script test: Mở Chrome với fake camera từ file video .y4m
 * Dùng để test video gesture trước khi tích hợp vào automation chính
 */
const { chromium } = require('patchright');
const path = require('path');

const RECORDINGS_DIR = path.join(__dirname, 'recordings');

// Đường dẫn tới Chrome của Xsurau (custom build)
const CHROME_PATH = 'K:\\chromium_src\\src\\out\\Xsurau\\chrome.exe';

// Map tên cử chỉ → file .y4m tương ứng
const GESTURE_VIDEOS = {
    'hand_open':    path.join(RECORDINGS_DIR, 'hand_open.y4m'),    // bước 1: đặt tay vào vòng tròn
    'wave':         path.join(RECORDINGS_DIR, 'wave.y4m'),          // vẫy tay
    'thumbs_up':    path.join(RECORDINGS_DIR, 'thumbs_up.y4m'),     // ngón cái
    'palm':         path.join(RECORDINGS_DIR, 'palm.y4m'),          // xòe bàn tay
    'finger_1':     path.join(RECORDINGS_DIR, 'finger_1.y4m'),      // 1 ngón tay
    'finger_2':     path.join(RECORDINGS_DIR, 'finger_2.y4m'),      // 2 ngón tay
    'finger_3':     path.join(RECORDINGS_DIR, 'finger_3.y4m'),      // 3 ngón tay
};

async function testFakeCamera(videoKey = 'hand_open') {
    const videoPath = GESTURE_VIDEOS[videoKey];
    
    if (!require('fs').existsSync(videoPath)) {
        console.error(`[Lỗi] File video không tồn tại: ${videoPath}`);
        console.log('[Hint] Hãy quay video bằng camera-tool.js trước, rồi convert sang .y4m');
        process.exit(1);
    }

    console.log(`\x1b[36m[*] Đang mở Chrome với fake camera: ${videoKey}\x1b[0m`);
    console.log(`[*] Video: ${videoPath}`);

    const context = await chromium.launchPersistentContext('', {
        executablePath: CHROME_PATH,
        headless: false,
        args: [
            // Sử dụng file video giả làm camera (Chrome sẽ lặp lại video vô hạn)
            '--use-fake-device-for-media-stream',
            '--use-fake-ui-for-media-stream',
            `--use-file-for-fake-video-capture=${videoPath}`,
            
            // Các flag cơ bản
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-blink-features=AutomationControlled',
        ],
        permissions: ['camera', 'microphone'],
    });

    const page = await context.newPage();
    
    console.log('[*] Đang mở trang test camera...');
    await page.goto('https://webcamtests.com/', { waitUntil: 'domcontentloaded' });
    
    console.log(`\x1b[32m[OK] Trình duyệt đã mở!\x1b[0m`);
    console.log('[*] Vào trang: https://webcamtests.com/ để xem video fake camera');
    console.log('[*] Nhấn Ctrl+C tại đây để đóng trình duyệt.');
    console.log('\x1b[33m[*] Sau khi test thành công, mở trang Google accounts để test captcha.\x1b[0m');

    // Giữ script chạy để trình duyệt không tắt
    await new Promise(() => {});
}

// Lấy tên gesture từ tham số dòng lệnh (mặc định là hand_open)
const arg = process.argv[2] || 'hand_open';
console.log(`\x1b[36m========================================================\x1b[0m`);
console.log(`\x1b[36m   XSURAU - TEST FAKE CAMERA (${arg.toUpperCase()})\x1b[0m`);
console.log(`\x1b[36m========================================================\x1b[0m`);
console.log('Các gesture có sẵn:', Object.keys(GESTURE_VIDEOS).join(', '));
console.log('Cách dùng: node test-fake-camera.js [gesture_name]');
console.log('Ví dụ: node test-fake-camera.js hand_open');
console.log('\x1b[35m--------------------------------------------------------\x1b[0m\n');

testFakeCamera(arg).catch(err => {
    console.error('[Lỗi]', err.message);
});
