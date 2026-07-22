/**
 * test-fakecam-chrome.js
 * Test fake camera với Google Chrome thông thường
 * Run: node test-fakecam-chrome.js
 */
const { chromium } = require('patchright');
const path = require('path');
const fs = require('fs');

const RECORDINGS_DIR = path.join(__dirname, '..', 'recordings');
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

function getVideoBase64(name) {
    const filePath = path.join(RECORDINGS_DIR, `${name}.mp4`);
    if (!fs.existsSync(filePath)) { console.error('❌ File not found:', filePath); return null; }
    return fs.readFileSync(filePath).toString('base64');
}

const INJECT_SCRIPT = `(function() {
    if (window.__xsurauFakeCam) return;
    window.__xsurauFakeCam = true;

    // Canvas stream — luôn có content
    var canvas = document.createElement('canvas');
    canvas.width = 320; canvas.height = 240;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#00cc44';
    ctx.fillRect(0, 0, 320, 240);
    ctx.fillStyle = 'white'; ctx.font = 'bold 24px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('XSURAU FAKE CAM', 160, 110);
    ctx.fillText('Loading video...', 160, 145);
    var canvasStream = canvas.captureStream(30);
    window.__fakeCanvas = canvas;

    // Video — off-screen nhưng đủ lớn để Chrome render
    var vid = document.createElement('video');
    vid.loop = true; vid.muted = true; vid.playsInline = true;
    vid.style.cssText = 'position:fixed;top:-200px;left:0;width:160px;height:90px;pointer-events:none;';
    document.documentElement.appendChild(vid);
    window.__fakeCamEl = vid;
    window.__videoBlobUrls = {};

    // Draw loop
    setInterval(function() {
        if (vid.readyState >= 2 && !vid.paused) {
            try { ctx.drawImage(vid, 0, 0, 320, 240); } catch(e) {
                console.error('[FakeCam] drawImage err:', e.message);
            }
        }
    }, 33);

    window.switchGestureVideo = function(name) {
        var url = window.__videoBlobUrls[name];
        if (!url) { console.warn('[FakeCam] no blob:', name); return; }
        vid.pause(); vid.src = url;
        vid.addEventListener('canplay', function() {
            vid.play().then(function() {
                console.log('[FakeCam] playing:', name, 'readyState:', vid.readyState);
            }).catch(function(e) {
                console.error('[FakeCam] play error:', e.name);
                setTimeout(function() { vid.play().catch(function(){}); }, 300);
            });
        }, { once: true });
        vid.load();
        console.log('[FakeCam] loading:', name);
    };

    if (navigator.mediaDevices) {
        var orig = navigator.mediaDevices.getUserMedia && navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = function(c) {
            if (c && c.video) {
                console.log('[FakeCam] getUserMedia → canvas stream');
                return Promise.resolve(canvasStream);
            }
            return orig ? orig(c) : Promise.reject(new Error('unavailable'));
        };
        navigator.mediaDevices.enumerateDevices = function() {
            return Promise.resolve([
                { deviceId: 'xsurau', kind: 'videoinput', label: 'FakeCam', toJSON: function(){ return this; } }
            ]);
        };
        console.log('[FakeCam] READY on', location.href.substring(0, 60));
    }
})();`;

async function main() {
    console.log('🚀 Launching Chrome...');
    const browser = await chromium.launch({
        executablePath: CHROME_PATH,
        headless: false,
        args: [
            '--use-fake-ui-for-media-stream',   // auto-accept camera permission
            '--allow-running-insecure-content',
        ]
    });

    const context = await browser.newContext({
        permissions: ['camera', 'microphone'],
    });

    // Inject getUserMedia override vào TẤT CẢ pages từ đầu
    await context.addInitScript(INJECT_SCRIPT);
    console.log('✅ addInitScript đăng ký');

    const page = await context.newPage();

    // Lắng nghe console từ page
    page.on('console', msg => {
        const text = msg.text();
        if (text.includes('[FakeCam]')) console.log('  [Browser]', text);
    });

    // Đăng ký route handler cho gesture challenge
    await page.route(/recaptcha\/challenge|hand-gestures/, async (route) => {
        const req = route.request();
        if (req.method() !== 'GET') { await route.continue(); return; }
        try {
            const response = await route.fetch();
            const ct = response.headers()['content-type'] || '';
            if (!ct.includes('text/html')) { await route.fulfill({ response }); return; }
            let body = await response.text();
            const tag = `<script>${INJECT_SCRIPT}</script>`;
            body = body.includes('<head>') ? body.replace('<head>', '<head>' + tag) : tag + body;
            const headers = { ...response.headers() };
            delete headers['content-security-policy'];
            delete headers['content-security-policy-report-only'];
            await route.fulfill({ response, body, headers });
            console.log('🔧 Script injected into gesture HTML!');
        } catch(e) { await route.continue(); }
    });

    console.log('🌐 Navigate to Google...');
    await page.goto('https://accounts.google.com/', { waitUntil: 'domcontentloaded' });
    console.log('✅ Page loaded. Đăng nhập Google, rồi chờ gesture captcha...');
    console.log('   Script sẽ tự inject khi gesture frame xuất hiện.');

    // Chờ gesture frame
    let gestureFrame = null;
    for (let i = 0; i < 1200; i++) {

        gestureFrame = page.frames().find(f => f.url().includes('hand-gestures') || f.url().includes('recaptcha/challenge'));
        if (gestureFrame) { console.log('✅ Gesture frame:', gestureFrame.url().substring(0, 80)); break; }
        if (i % 20 === 0) console.log(`   [${i}s] Chờ gesture iframe...`);
        await new Promise(r => setTimeout(r, 500));
    }

    if (!gestureFrame) { console.log('❌ Timeout chờ gesture frame'); await browser.close(); return; }

    // Preload videos
    console.log('📦 Preloading videos...');
    const preloaded = [];
    for (const name of ['hand_open', 'fist', 'finger_1', 'finger_2', 'thumbs_down']) {
        const b64 = getVideoBase64(name);
        if (!b64) continue;
        try {
            await gestureFrame.evaluate(({ name, data }) => {
                const binary = atob(data);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                window.__videoBlobUrls = window.__videoBlobUrls || {};
                window.__videoBlobUrls[name] = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
            }, { name, data: b64 });
            preloaded.push(name);
        } catch(e) { console.log('  preload err:', name, e.message); }
    }
    console.log('✅ Preloaded:', preloaded.join(', '));

    // Switch to hand_open
    await gestureFrame.evaluate(() => {
        if (window.switchGestureVideo) window.switchGestureVideo('hand_open');
    });
    console.log('🎬 Switched to hand_open');

    // Diagnostic: check canvas pixel
    await new Promise(r => setTimeout(r, 2000));
    const pixel = await gestureFrame.evaluate(() => {
        var canvas = window.__fakeCanvas;
        if (!canvas) return 'no canvas!';
        var ctx = canvas.getContext('2d');
        var vid = window.__fakeCamEl;
        if (vid && vid.readyState >= 2) {
            try { ctx.drawImage(vid, 0, 0, 320, 240); } catch(e) { return 'drawImage err: ' + e.message; }
        }
        var px = ctx.getImageData(0, 0, 1, 1).data;
        return 'r=' + px[0] + ' g=' + px[1] + ' b=' + px[2] + ' (vid readyState=' + (vid?.readyState) + ')';
    }).catch(e => 'eval err: ' + e.message);
    console.log('🎨 Canvas pixel:', pixel);

    console.log('\n📌 Browser vẫn mở. Xem camera trong gesture captcha.');
    console.log('   Ctrl+C để thoát.\n');

    // Giữ browser mở
    await new Promise(r => setTimeout(r, 300000));
    await browser.close();
}

main().catch(e => { console.error('❌ Error:', e.message); process.exit(1); });
