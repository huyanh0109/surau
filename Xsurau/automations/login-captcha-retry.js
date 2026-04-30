const { sleep, generate2FACode, isEmail, clickNextButton } = require('./helpers');

/**
 * Login Google với retry loop và giải Captcha tự động qua CapMonster Extension.
 * Port từ login-captcha-retry.automation.ts
 */
async function run(page, job, signal, logger) {
    const log = (msg) => {
        logger?.(msg);
        console.log(`[P${job.profileId}] ${msg}`);
    };

    try {
        const { sheetRow } = job;
        if (!sheetRow?.Gmail || !sheetRow?.PassWord) {
            return { profileId: job.profileId, success: false, error: 'Thiếu Gmail hoặc Password' };
        }

        const maxAttempts = 10;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            if (signal?.aborted) return { profileId: job.profileId, success: false, error: 'Stopped' };
            log(`=== Lần thử đăng nhập ${attempt}/${maxAttempts} ===`);

            // 1. Mở trang login
            await page.goto('https://accounts.google.com/v3/signin/identifier?authuser=0&continue=https%3A%2F%2Fone.google.com%2F&hl=en_GB&flowName=GlifWebSignIn&flowEntry=AddSession', {
                waitUntil: 'domcontentloaded',
            });

            if (signal?.aborted) return { profileId: job.profileId, success: false, error: 'Stopped' };

            // 2. Nhập email
            await page.waitForSelector('input[type="email"]', { timeout: 30000 });
            await page.locator('input[type="email"]').fill('');
            await page.locator('input[type="email"]').type(sheetRow.Gmail, { delay: 10 });
            await page.locator('#identifierNext').click();

            // 3. Phát hiện UI tiếp theo
            let nextStep = 'UNKNOWN';
            for (let w = 0; w < 15; w++) {
                if (signal?.aborted) return { profileId: job.profileId, success: false, error: 'Stopped' };
                const status = await page.evaluate(() => {
                    const text = document.body.innerText;
                    if (text.includes("Couldn't sign you in") || text.includes("Something went wrong")) return 'BLOCKED';
                    const pw = document.querySelector('input[type="password"]');
                    if (pw) {
                        const s = window.getComputedStyle(pw);
                        if (s.display !== 'none' && s.visibility !== 'hidden') return 'PASSWORD';
                    }
                    if (document.querySelector('iframe[src*="recaptcha"], [data-sitekey]')) return 'CAPTCHA';
                    return 'WAITING';
                });
                if (status !== 'WAITING') { nextStep = status; break; }
                await sleep(1000);
            }

            log(`Màn hình tiếp theo: ${nextStep}`);

            if (nextStep === 'BLOCKED') {
                log('Bị Google chặn. Thử lại sau 3s...');
                await sleep(3000);
                continue;
            }

            if (nextStep === 'CAPTCHA') {
                log('Trúng CAPTCHA! Bắt đầu đợi CapMonster Extension...');
                const { waitForCapMonsterExtension, resetCaptchaWidget } = require('./helpers');
                const solved = await waitForCapMonsterExtension(page, job.profileId, signal, logger);

                if (!solved) {
                    log('Giải Captcha thất bại. Thử lại toàn bộ...');
                    await sleep(3000);
                    continue;
                }

                await sleep(5000);
                const blocked = await page.evaluate(() =>
                    document.body.innerText.includes("Couldn't sign you in") || document.body.innerText.includes("Something went wrong")
                );
                if (blocked) { log('Bị chặn sau Captcha. Thử lại...'); await sleep(3000); continue; }

                // Bấm Next sau captcha nếu chưa thấy password
                const pwVisible = await page.evaluate(() => {
                    const pw = document.querySelector('input[type="password"]');
                    if (!pw) return false;
                    const s = window.getComputedStyle(pw);
                    return s.display !== 'none' && s.visibility !== 'hidden';
                });
                if (!pwVisible) {
                    await page.evaluate(() => {
                        const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
                        for (const btn of buttons) {
                            const text = btn.textContent?.trim().toLowerCase() || '';
                            if (text === 'next' || text === 'tiếp theo') { btn.click(); return; }
                        }
                    });
                }
            }

            // 4. Nhập Password
            try {
                await page.waitForSelector('input[type="password"]', { state: 'visible', timeout: 15000 });
            } catch {
                const blocked = await page.evaluate(() =>
                    document.body.innerText.includes("Couldn't sign you in")
                );
                if (blocked) { log('Bị chặn ở bước nhập pass. Thử lại...'); continue; }
                throw new Error('Không thấy ô nhập Password!');
            }

            await sleep(1000);
            await page.locator('input[type="password"]').fill('');
            await page.locator('input[type="password"]').type(sheetRow.PassWord, { delay: 10 });
            await sleep(500);
            await page.locator('#passwordNext').click({ clickCount: 2, delay: 100 });
            await sleep(2000);

            // Bỏ qua popup "Save password?"
            try {
                await page.evaluate(() => {
                    const btn = Array.from(document.querySelectorAll('button')).find(b =>
                        b.textContent?.includes('Never') || b.textContent?.includes('No thanks') ||
                        b.textContent?.includes('Không bao giờ') || b.textContent?.includes('Không, cảm ơn')
                    );
                    if (btn) btn.click();
                });
            } catch { }

            // 5. Xác minh 2FA/Recovery
            try {
                const emailRecovery = isEmail(sheetRow.Recover);
                if (emailRecovery) {
                    await page.waitForSelector('[data-challengetype="12"]', { state: 'visible', timeout: 10000 });
                    await page.locator('[data-challengetype="12"]').click();
                    await sleep(3000);
                    await page.waitForSelector('[name="knowledgePreregisteredEmailResponse"]', { state: 'visible', timeout: 10000 });
                    await page.locator('[name="knowledgePreregisteredEmailResponse"]').type(sheetRow.Recover, { delay: 10 });
                    await sleep(500);
                    await clickNextButton(page);
                } else {
                    try {
                        await page.waitForSelector('[data-challengeid="3"]', { state: 'visible', timeout: 5000 });
                        await page.locator('[data-challengeid="3"]').click();
                        await sleep(2000);
                    } catch { }
                    await page.waitForSelector('[type="tel"]', { state: 'visible', timeout: 10000 });
                    const code = generate2FACode(sheetRow.Recover);
                    await page.locator('[type="tel"]').type(code, { delay: 10 });
                    await sleep(500);
                    await clickNextButton(page);
                }
            } catch { /* Không yêu cầu 2FA */ }

            // 6. Kiểm tra đăng nhập thành công
            try { await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }); } catch { }
            const finalUrl = page.url();
            if (finalUrl.includes('myaccount') || finalUrl.includes('one.google.com') || finalUrl.includes('myactivity')) {
                log('✅ ĐĂNG NHẬP THÀNH CÔNG!');
                return { profileId: job.profileId, success: true, data: { gmail: sheetRow.Gmail, message: 'Đăng nhập thành công!' } };
            }

            const finalBlocked = await page.evaluate(() =>
                document.body.innerText.includes("Couldn't sign you in") || document.body.innerText.includes("Something went wrong")
            );
            if (finalBlocked) { log('Bị chặn bước cuối. Thử lại...'); await sleep(3000); continue; }

            log(`URL cuối lạ: ${finalUrl}. Tạm kết thúc thành công.`);
            return { profileId: job.profileId, success: true, data: { gmail: sheetRow.Gmail, message: 'Done nhưng URL lạ' } };
        }

        throw new Error(`Đã thử ${maxAttempts} lần nhưng Google vẫn chặn.`);
    } catch (error) {
        console.error(`❌ [P${job.profileId}] Lỗi:`, error.message);
        return { profileId: job.profileId, success: false, error: error.message };
    }
}

module.exports = { name: 'login-captcha-retry', run };
