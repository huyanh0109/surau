const { sleep, generate2FACode, isEmail, clickNextButton } = require('./helpers');

/**
 * LOGIN GOOGLE (không có Gesture Captcha)
 * Bản gốc — dành cho tài khoản không bị Gesture Captcha.
 */
async function run(page, job, signal, logger) {
    const log = (msg) => { logger?.(msg); console.log(`[P${job.profileId}] ${msg}`); };
    try {
        const { sheetRow } = job;
        if (!sheetRow?.Gmail || !sheetRow?.PassWord) return { profileId: job.profileId, success: false, error: 'Thiếu Gmail hoặc Password' };

        if (signal?.aborted) return { profileId: job.profileId, success: false, error: 'Stopped' };

        // 1. Mở trang login
        await page.goto('https://accounts.google.com/v3/signin/identifier?authuser=0&continue=https%3A%2F%2Fone.google.com%2F&ec=GAlAywM&hl=en_GB&flowName=GlifWebSignIn&flowEntry=AddSession&theme=glif', {
            waitUntil: 'domcontentloaded'
        });

        // 2. Nhập email
        await page.waitForSelector('input[type="email"]', { timeout: 30000 });
        await page.locator('input[type="email"]').type(sheetRow.Gmail, { delay: 10 });
        await page.locator('#identifierNext').click();

        if (signal?.aborted) return { profileId: job.profileId, success: false, error: 'Stopped' };

        // 3. Chờ và nhập password
        await page.waitForSelector('input[type="password"]', { state: 'visible', timeout: 300000 });
        const pwField = page.locator('input[type="password"]').first();
        await pwField.type(sheetRow.PassWord, { delay: 10 });
        log('Đã nhập password.');
        await sleep(300);
        await pwField.press('Enter');
        log('Đã submit password.');

        // Dismiss "Save password?" popup
        try {
            await page.evaluate(() => {
                const btn = Array.from(document.querySelectorAll('button')).find(b =>
                    ['Never', 'No thanks', 'Không bao giờ', 'Không, cảm ơn'].some(t => b.textContent?.includes(t))
                );
                if (btn) btn.click();
            });
        } catch {}

        if (signal?.aborted) return { profileId: job.profileId, success: false, error: 'Stopped' };

        // 4. Xác minh: Email khôi phục hoặc 2FA
        try {
            const isEmailRecovery = isEmail(sheetRow.Recover);

            if (isEmailRecovery) {
                // ===== EMAIL KHÔI PHỤC =====
                try {
                    const inputField = page.locator('[name="knowledgePreregisteredEmailResponse"]').first();
                    const isInputDirectlyVisible = await inputField.isVisible().catch(() => false);
                    
                    if (!isInputDirectlyVisible) {
                        const recoveryOption = page.locator('[data-challengetype="12"]').first();
                        await recoveryOption.waitFor({ state: 'visible', timeout: 5000 });
                        await recoveryOption.click();
                        log('Đã click tùy chọn email khôi phục.');
                    }
                } catch (e) {
                    log('Không thấy nút chọn email khôi phục, thử chờ ô nhập.');
                }

                await page.waitForSelector('[name="knowledgePreregisteredEmailResponse"]', { state: 'visible', timeout: 10000 });
                const recoverField = page.locator('[name="knowledgePreregisteredEmailResponse"]').first();
                await recoverField.type(sheetRow.Recover, { delay: 10 });
                log('Đã nhập email khôi phục.');
                await recoverField.press('Enter');

            } else {
                // ===== 2FA (Authenticator) =====
                log('[2FA] Xử lý 2FA...');
                const inputSelector = 'input[type="tel"], input#totpPin, input[autocomplete="one-time-code"]';
                const isInputVisible = await page.locator(inputSelector).first().isVisible({ timeout: 3000 }).catch(() => false);

                if (!isInputVisible) {
                    const clicked = await page.evaluate(() => {
                        const findAndClick = (selector) => {
                            for (const el of document.querySelectorAll(selector)) {
                                const txt = el.textContent?.toLowerCase() || '';
                                if ((txt.includes('authenticator') || txt.includes('app')) &&
                                    !txt.includes('offline') && !txt.includes('sms') && !txt.includes('security code')) {
                                    el.scrollIntoView({ block: 'center' }); el.click(); return true;
                                }
                            }
                            return false;
                        };
                        return findAndClick('[data-challengetype="6"]') ||
                               findAndClick('[data-challengeid="2"]') ||
                               findAndClick('[data-challengeid="3"]') ||
                               findAndClick('li, div[role="link"], div[role="button"]');
                    }).catch(() => false);
                    if (clicked) log('[2FA] Đã chọn phương thức Authenticator.');
                }

                await page.waitForSelector(inputSelector, { state: 'visible', timeout: 15000 });
                const code = generate2FACode(sheetRow.Recover);
                log(`[2FA] Mã: ${code}`);
                if (code && code.length === 6) {
                    const inputField = page.locator(inputSelector).first();
                    await inputField.fill(code);
                    log('[2FA] Đã nhập mã, submit...');
                    await inputField.press('Enter');
                } else {
                    throw new Error(`Mã 2FA không hợp lệ: ${code}`);
                }
            }
        } catch (error) {
            log(`Info: Skip/Manual verification (${error.message})`);
        }

        if (signal?.aborted) return { profileId: job.profileId, success: false, error: 'Stopped' };

        // 5. Chờ đăng nhập xong
        try { await page.waitForNavigation({ waitUntil: 'load', timeout: 30000 }); } catch {}

        log('✅ Đăng nhập xong!');
        return { profileId: job.profileId, success: true, data: { gmail: sheetRow.Gmail, message: 'Done!' } };
    } catch (error) {
        return { profileId: job.profileId, success: false, error: error.message };
    }
}

module.exports = { name: 'login-google', run };
