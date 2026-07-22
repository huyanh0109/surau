/**
 * HELPER FUNCTIONS dùng chung cho tất cả automation
 */

/**
 * Sinh mã TOTP từ secret (Dùng authenticator để chuẩn Google 2FA)
 */
/**
 * Tự giải mã Base32 và sinh mã TOTP (Không dùng thư viện ngoài để tránh lỗi)
 */
function generate2FACode(secret) {
    if (!secret || typeof secret !== 'string') return '';
    
    try {
        const crypto = require('crypto');
        const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
        const cleanSecret = secret.replace(/\s/g, '').toUpperCase().replace(/[^A-Z2-7]/g, '');
        
        if (cleanSecret.length < 8) return '';

        // 1. Giải mã Base32 sang Buffer
        let bits = 0;
        let value = 0;
        let index = 0;
        const key = Buffer.alloc((cleanSecret.length * 5 / 8) | 0);

        for (let i = 0; i < cleanSecret.length; i++) {
            const charValue = alphabet.indexOf(cleanSecret[i]);
            if (charValue === -1) continue;
            value = (value << 5) | charValue;
            bits += 5;
            if (bits >= 8) {
                key[index++] = (value >>> (bits - 8)) & 255;
                bits -= 8;
            }
        }
        const finalKey = key.slice(0, index);

        // 2. Tính toán Time Step (30s mỗi bước)
        const counter = BigInt(Math.floor(Date.now() / 1000 / 30));
        const buf = Buffer.alloc(8);
        buf.writeBigInt64BE(counter);

        // 3. HMAC-SHA1
        const hmac = crypto.createHmac('sha1', finalKey).update(buf).digest();

        // 4. Dynamic Truncation để lấy mã 6 số
        const offset = hmac[hmac.length - 1] & 0xf;
        const code = ((hmac[offset] & 0x7f) << 24 |
                      (hmac[offset + 1] & 0xff) << 16 |
                      (hmac[offset + 2] & 0xff) << 8 |
                      (hmac[offset + 3] & 0xff)) % 1000000;

        return code.toString().padStart(6, '0');
    } catch (e) {
        return '';
    }
}

/**
 * Kiểm tra chuỗi có phải email không
 */
function isEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value || '');
}

/**
 * Đợi một khoảng thời gian (ms)
 */
function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

/**
 * Click nút Next với nhiều selector fallback (Playwright style)
 */
async function clickNextButton(page) {
    const selectors = [
        'button:has-text("Next")',
        'button:has-text("Tiếp theo")',
        '[jsname="LgbsSe"]',
        '#identifierNext',
        '#passwordNext',
    ];
    for (const sel of selectors) {
        try {
            const el = page.locator(sel).first();
            if (await el.isVisible({ timeout: 1000 })) {
                await el.click();
                return true;
            }
        } catch { }
    }
    // Fallback JS
    await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const btn = buttons.find(b =>
            b.textContent?.includes('Next') || b.textContent?.includes('Tiếp theo')
        );
        if (btn) btn.click();
    });
    return false;
}

/**
 * Reset captcha widget (dùng JS injection)
 */
async function resetCaptchaWidget(page) {
    try {
        await page.evaluate(() => {
            const win = window;
            if (typeof win.grecaptcha !== 'undefined') {
                try { win.grecaptcha.reset(); } catch { }
            }
            if (win.grecaptcha?.enterprise) {
                try { win.grecaptcha.enterprise.reset(); } catch { }
            }
            // Reload iframe captcha
            document.querySelectorAll('iframe').forEach(iframe => {
                if (iframe.src?.includes('recaptcha')) {
                    iframe.src = iframe.src;
                }
            });
        });
        await sleep(2000);
    } catch { }
}

/**
 * Đợi CapMonster Extension giải captcha tự động
 * @returns {Promise<boolean>} true nếu đã giải xong
 */
async function waitForCapMonsterExtension(page, profileId, signal, logger, timeoutMs = 120000) {
    logger?.(`[P${profileId}] Đợi CapMonster giải captcha (${timeoutMs / 1000}s)...`);
    const iterations = Math.floor(timeoutMs / 2000);
    for (let i = 0; i < iterations; i++) {
        if (signal?.aborted) return false;
        await sleep(2000);
        try {
            const status = await page.evaluate(() => {
                const textareas = document.querySelectorAll('textarea[name="g-recaptcha-response"], textarea.g-recaptcha-response');
                for (const ta of textareas) {
                    if (ta.value && ta.value.length > 20) return 'solved';
                }
                const errDiv = document.querySelector('.L0Zxb, .o6cuMc, [aria-live="assertive"]');
                if (errDiv && (errDiv.textContent?.includes('verify') || errDiv.textContent?.includes('wrong'))) return 'error';
                const stillExists = document.querySelector('.g-recaptcha, iframe[src*="recaptcha"]');
                if (!stillExists) return 'solved';
                return 'waiting';
            });
            if (status === 'solved') {
                logger?.(`[P${profileId}] CapMonster đã giải xong!`);
                return true;
            }
            if (status === 'error') {
                logger?.(`[P${profileId}] CapMonster giải sai, reset widget...`);
                await resetCaptchaWidget(page);
            }
        } catch { }
    }
    return false;
}

module.exports = { generate2FACode, isEmail, sleep, clickNextButton, resetCaptchaWidget, waitForCapMonsterExtension };
