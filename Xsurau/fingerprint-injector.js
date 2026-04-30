/**
 * FINGERPRINT INJECTOR — Xsurau
 *
 * Chỉ override những gì patchright KHÔNG tự handle:
 * - WebGL vendor/renderer
 * - hardwareConcurrency, deviceMemory
 * - plugins, screen
 * - Canvas/Audio noise (nhỏ thôi)
 * - userAgentData (Client Hints)
 *
 * KHÔNG override userAgent/language → patchright native handle (tránh UA mismatch gây lỗi Cloudflare)
 */

const GPU_DATABASE = [
    { vendor: 'Google Inc. (Intel)',  renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    { vendor: 'Google Inc. (Intel)',  renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    { vendor: 'Google Inc. (Intel)',  renderer: 'ANGLE (Intel, Intel(R) HD Graphics 520 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    { vendor: 'Google Inc. (Intel)',  renderer: 'ANGLE (Intel, Intel(R) HD Graphics 530 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    { vendor: 'Google Inc. (Intel)',  renderer: 'ANGLE (Intel, Intel(R) Iris Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    { vendor: 'Google Inc. (Intel)',  renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 770 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 6GB Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    { vendor: 'Google Inc. (AMD)',    renderer: 'ANGLE (AMD, AMD Radeon RX 580 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    { vendor: 'Google Inc. (AMD)',    renderer: 'ANGLE (AMD, AMD Radeon RX 5600 XT Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    { vendor: 'Google Inc. (AMD)',    renderer: 'ANGLE (AMD, AMD Radeon Vega 8 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)' },
];

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.82 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
];

const SCREEN_RESOLUTIONS = [
    { width: 1920, height: 1080 }, { width: 1920, height: 1200 },
    { width: 2560, height: 1440 }, { width: 1680, height: 1050 },
    { width: 1440, height: 900  }, { width: 1366, height: 768  },
    { width: 1536, height: 864  }, { width: 1600, height: 900  },
];

const HARDWARE_CONCURRENCY = [2, 4, 6, 8, 12, 16];
const DEVICE_MEMORY        = [2, 4, 8];
const LANGUAGES            = [['en-US', 'en'], ['en-GB', 'en'], ['vi-VN', 'vi'], ['en-US', 'en-GB', 'en']];

// ============================================================
// Seeded PRNG
// ============================================================
function mulberry32(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = Math.imul(31, h) + s.charCodeAt(i) | 0;
    return () => {
        h |= 0; h = h + 0x6D2B79F5 | 0;
        let t = Math.imul(h ^ h >>> 15, 1 | h);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

// ============================================================
// Generate fingerprint từ seed
// ============================================================
function generateFingerprint(noiseSeed, gpuOverride = null) {
    const rng  = mulberry32(noiseSeed || 'xsurau_default');
    const pick = (arr) => arr[Math.floor(rng() * arr.length)];

    const gpu       = gpuOverride || pick(GPU_DATABASE);
    const screen    = pick(SCREEN_RESOLUTIONS);
    const userAgent = pick(USER_AGENTS);
    const languages = pick(LANGUAGES);

    const uaVerMatch    = userAgent.match(/Chrome\/([\d.]+)/);
    const chromeVersion = uaVerMatch ? uaVerMatch[1] : '124.0.0.0';
    const chromeMajor   = parseInt(chromeVersion.split('.')[0]);

    const canvasNoiseByte = Math.floor(rng() * 3) - 1; // -1, 0, 1
    const audioNoise      = (rng() - 0.5) * 0.0001;

    return {
        userAgent, platform: 'Win32',
        language: languages[0], languages,
        gpu, screen,
        hardwareConcurrency: pick(HARDWARE_CONCURRENCY),
        deviceMemory:        pick(DEVICE_MEMORY),
        chromeVersion, chromeMajor,
        canvasNoiseByte, audioNoise,
    };
}

// ============================================================
// Injection script — mỗi block try-catch độc lập, KHÔNG crash page
// ============================================================
function buildInjectionScript(fp) {
    return `(function() {
'use strict';
/* Bỏ qua nếu đang trong iframe Cloudflare/captcha — tránh crash Turnstile */
try {
    const _h = (window.location && window.location.hostname) || '';
    if (_h.includes('cloudflare.com') || _h.includes('hcaptcha.com') ||
        _h.includes('recaptcha.net') || _h.includes('challenges.')) {
        return;
    }
} catch(e) {}

const FP = ${JSON.stringify(fp)};

/* 1. navigator cơ bản mà patchright không set */
try { Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', { get: () => FP.hardwareConcurrency, configurable: true }); } catch(e) {}
try { Object.defineProperty(Navigator.prototype, 'deviceMemory',        { get: () => FP.deviceMemory,        configurable: true }); } catch(e) {}
try { Object.defineProperty(Navigator.prototype, 'maxTouchPoints',      { get: () => 0,                      configurable: true }); } catch(e) {}
try { Object.defineProperty(navigator, 'webdriver', { get: () => false, configurable: true }); } catch(e) {}

/* 2. plugins */
try {
    const pd = [
        { name: 'Chrome PDF Plugin',  filename: 'internal-pdf-viewer',             description: 'Portable Document Format' },
        { name: 'Chrome PDF Viewer',  filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
        { name: 'Native Client',      filename: 'internal-nacl-plugin',             description: '' },
    ];
    const pa = Object.create(PluginArray.prototype);
    pd.forEach((d, i) => {
        const p = Object.create(Plugin.prototype);
        Object.defineProperties(p, {
            name: { value: d.name, enumerable: true }, filename: { value: d.filename, enumerable: true },
            description: { value: d.description, enumerable: true }, length: { value: 0, enumerable: true },
        });
        pa[i] = p;
    });
    Object.defineProperty(pa, 'length', { value: pd.length, enumerable: true });
    Object.defineProperty(Navigator.prototype, 'plugins', { get: () => pa, configurable: true });
} catch(e) {}

/* 3. screen */
try {
    [['width',FP.screen.width],['height',FP.screen.height],['availWidth',FP.screen.width],
     ['availHeight',FP.screen.height-40],['colorDepth',24],['pixelDepth',24]]
    .forEach(([k,v]) => { try { Object.defineProperty(screen, k, { get: () => v, configurable: true }); } catch(e) {} });
    Object.defineProperty(window, 'devicePixelRatio', { get: () => 1, configurable: true });
} catch(e) {}

/* 4. WebGL */
function patchGL(Ctor) {
    if (!Ctor) return;
    const _o = Ctor.prototype.getParameter;
    Ctor.prototype.getParameter = function(p) {
        if (p===0x1F00||p===0x9245) return FP.gpu.vendor;
        if (p===0x1F01||p===0x9246) return FP.gpu.renderer;
        return _o.call(this, p);
    };
}
try { patchGL(WebGLRenderingContext);  } catch(e) {}
try { patchGL(WebGL2RenderingContext); } catch(e) {}

/* 5. Canvas noise — anti-recursion flag */
try {
    const _orig = HTMLCanvasElement.prototype.toDataURL;
    let _busy = false;
    HTMLCanvasElement.prototype.toDataURL = function(t, q) {
        if (_busy) return _orig.call(this, t, q);
        _busy = true;
        try {
            const r = _orig.call(this, t, q);
            if (!r || r==='data:,' || FP.canvasNoiseByte===0) return r;
            const i = r.length - 8;
            const c = r.charCodeAt(i);
            return r.slice(0,i) + String.fromCharCode(((c + FP.canvasNoiseByte - 64 + 64)%64)+64) + r.slice(i+1);
        } finally { _busy = false; }
    };
} catch(e) {}

/* 6. Audio noise */
try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
        const _o = AC.prototype.createAnalyser;
        AC.prototype.createAnalyser = function() {
            const n = _o.call(this);
            const _g = n.getFloatFrequencyData.bind(n);
            n.getFloatFrequencyData = function(a) { _g(a); for(let i=0;i<a.length;i++) a[i]+=FP.audioNoise; };
            return n;
        };
    }
} catch(e) {}

/* 7. userAgentData */
try {
    const brands = [
        {brand:'Not_A Brand',version:'8'},
        {brand:'Chromium',version:String(FP.chromeMajor)},
        {brand:'Google Chrome',version:String(FP.chromeMajor)},
    ];
    Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => ({
        brands, mobile: false, platform: 'Windows',
        getHighEntropyValues: async function(hints) {
            const r={};
            hints.forEach(h => {
                if(h==='architecture')    r.architecture='x86';
                if(h==='bitness')         r.bitness='64';
                if(h==='model')           r.model='';
                if(h==='platform')        r.platform='Windows';
                if(h==='platformVersion') r.platformVersion='10.0.0';
                if(h==='uaFullVersion')   r.uaFullVersion=FP.chromeVersion;
                if(h==='fullVersionList') r.fullVersionList=brands.map(b=>({brand:b.brand,version:FP.chromeVersion}));
                if(h==='wow64')           r.wow64=false;
            });
            return r;
        },
        toJSON() { return {brands,mobile:false,platform:'Windows'}; },
    }), configurable: true });
} catch(e) {}

/* 8. chrome object */
try {
    if (!window.chrome || !window.chrome.runtime) {
        window.chrome = {
            app:{isInstalled:false},
            runtime:{id:undefined,connect(){},sendMessage(){}},
            loadTimes(){return{requestTime:Date.now()/1000,firstPaintTime:Date.now()/1000,navigationType:'Other',connectionInfo:'h2'};},
            csi(){return{startE:Date.now(),onloadT:Date.now(),pageT:2.5,tran:15};},
        };
    }
} catch(e) {}

/* 9. Remove Playwright traces */
try { delete window.__playwright;    } catch(e) {}
try { delete window.__pw_manual;     } catch(e) {}
try { delete window.__pwInitScripts; } catch(e) {}

})();`;
}

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Inject fingerprint vào BrowserContext.
 * Nhận fp object đã generate (từ generateFingerprint).
 * KHÔNG set HTTP headers — userAgent được set native trong launchConfig.
 */
async function injectFingerprint(context, fp) {
    await context.addInitScript({ content: buildInjectionScript(fp) });
}

module.exports = { injectFingerprint, generateFingerprint, buildInjectionScript };
