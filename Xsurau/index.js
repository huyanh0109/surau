const { chromium } = require('playwright');
const { FingerprintGenerator } = require('fingerprint-generator');
const fs = require('fs');
const path = require('path');

// Đường dẫn tới Chrome.exe tự build (đã được vá mã nguồn C++)
const CUSTOM_CHROME_PATH = 'K:\\chromium_src\\src\\out\\Xsurau\\chrome.exe';

// Khởi tạo bộ sinh vân tay (Chỉ lấy Chrome và hệ điều hành Windows)
const fingerprintGenerator = new FingerprintGenerator({
    browsers: ['chrome'],
    operatingSystems: ['windows'],
});

async function launchProfile(profileId, proxyUrl = null) {
    const profilePath = path.resolve(`./profiles_data/${profileId}`);
    const metaPath = `./profiles_meta/${profileId}.json`;

    let browserProfile;

    // Nếu profile này chưa từng tồn tại -> Tạo mới vân tay sạch và lưu lại
    if (!fs.existsSync(metaPath)) {
        console.log(`[+] Đang tạo vân tay mới cho ${profileId}...`);
        browserProfile = fingerprintGenerator.getFingerprint();

        if (!fs.existsSync('./profiles_meta')) {
            fs.mkdirSync('./profiles_meta', { recursive: true });
        }
        if (!fs.existsSync('./profiles_data')) {
            fs.mkdirSync('./profiles_data', { recursive: true });
        }
        fs.writeFileSync(metaPath, JSON.stringify(browserProfile, null, 2));
    } else {
        // Đã có profile -> Tải lại vân tay cũ để giữ tính nhất quán
        console.log(`[+] Đang tải profile có sẵn: ${profileId}`);
        browserProfile = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    }

    // Tạo seed ngẫu nhiên từ profileId để mỗi profile có vân tay phần cứng riêng
    const noiseSeed = profileId;

    console.log(`[+] Đang mở trình duyệt qua Xsurau Custom Chromium (C++ patched)...`);

    const launchOptions = {
        headless: false,
        executablePath: CUSTOM_CHROME_PATH,   // ← Dùng Chrome tự build
        args: [
            '--start-maximized',
            '--disable-blink-features=AutomationControlled',
            // Truyền seed vân tay phần cứng vào lõi C++ (các file đã được vá)
            `--canvas-noise-seed=${noiseSeed}`,
            `--audio-noise-seed=${noiseSeed}`,
            `--rect-noise-seed=${noiseSeed}`,
            // Fake thông số WebGL (Card đồ họa) - thay đổi theo từng profile nếu muốn
            '--webgl-vendor=Google Inc. (Intel)',
            '--webgl-renderer=ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)',
        ],
        ignoreDefaultArgs: ['--enable-automation'],
        viewport: null
    };

    if (proxyUrl) {
        launchOptions.proxy = { server: proxyUrl };
    }

    const context = await chromium.launchPersistentContext(profilePath, launchOptions);

    const page = await context.newPage();
    await page.goto('https://chototmmo.com/');

    console.log(`[+] Trình duyệt đang chạy. Đóng Terminal để dừng.`);
}

// Chạy thử nghiệm Profile 1
launchProfile('my_profile_01');
