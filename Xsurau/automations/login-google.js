const { sleep, generate2FACode, isEmail, clickNextButton } = require('./helpers');

/** 
 * Login Google - Ported from src/automation/automations/login-google/login-google.automation.ts 
 */
async function run(page, job, signal, logger) {
    const log = (msg) => { logger?.(msg); console.log(`[P${job.profileId}] ${msg}`); };
    try {
        const { sheetRow } = job;
        if (!sheetRow?.Gmail || !sheetRow?.PassWord) return { profileId: job.profileId, success: false, error: 'Thiếu Gmail hoặc Password' };

        if (signal?.aborted) return { profileId: job.profileId, success: false, error: 'Stopped' };
        
        // 1. Mở trang login (URL gốc)
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
        await sleep(2000);
        await page.locator('input[type="password"]').type(sheetRow.PassWord, { delay: 10 });
        await sleep(500);
        await page.locator('#passwordNext').click({ clickCount: 2, delay: 100 });
        await sleep(2000);

        // Tự động đóng popup "Save password?"
        try {
            await page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll('button'));
                const dismissBtn = buttons.find(btn =>
                    btn.textContent?.includes('Never') ||
                    btn.textContent?.includes('No thanks') ||
                    btn.textContent?.includes('Không bao giờ') ||
                    btn.textContent?.includes('Không, cảm ơn')
                );
                if (dismissBtn) dismissBtn.click();
            });
        } catch { }

        if (signal?.aborted) return { profileId: job.profileId, success: false, error: 'Stopped' };

        // 4. Xác minh qua Email hoặc 2FA
        try {
            const isEmailRecovery = isEmail(sheetRow.Recover);

            if (isEmailRecovery) {
                // ===== LUỒNG EMAIL KHÔI PHỤC =====
                const recoveryOption = page.locator('[data-challengetype="12"]').first();
                if (await recoveryOption.isVisible({ timeout: 10000 })) {
                    await recoveryOption.scrollIntoViewIfNeeded();
                    await sleep(500);
                    await recoveryOption.click();
                }

                await sleep(3000);
                await page.waitForSelector('[name="knowledgePreregisteredEmailResponse"]', { state: 'visible', timeout: 10000 });
                await page.locator('[name="knowledgePreregisteredEmailResponse"]').type(sheetRow.Recover, { delay: 10 });
                await sleep(500);
                await clickNextButton(page);
            } else {
                // ===== LUỒNG 2FA =====
                log(`[2FA] Đang xử lý mã 2FA cho Secret: ${sheetRow.Recover?.substring(0, 5)}***`);
                
                // 1. Kiểm tra xem có đang ở trang chọn phương thức không
                try {
                    const twoFAOption = page.locator('[data-challengeid="3"]').first();
                    const inputExist = await page.locator('input[type="tel"], input#totpPin').first().isVisible({ timeout: 2000 }).catch(() => false);
                    
                    if (!inputExist && await twoFAOption.isVisible({ timeout: 3000 })) {
                        log('[2FA] Nhấn chọn phương thức Authenticator app...');
                        await twoFAOption.scrollIntoViewIfNeeded();
                        await sleep(500);
                        await twoFAOption.click();
                        await sleep(2000);
                    }
                } catch (e) { }

                // 2. Chờ ô nhập mã xuất hiện (thử nhiều selector)
                log('[2FA] Đợi ô nhập mã...');
                const inputSelector = 'input[type="tel"], input#totpPin, input[autocomplete="one-time-code"]';
                await page.waitForSelector(inputSelector, { state: 'visible', timeout: 15000 });
                
                // 3. Sinh mã và nhập
                const code = generate2FACode(sheetRow.Recover);
                log(`[2FA] Mã sinh ra: ${code}`);
                
                if (code && code.length === 6) {
                    const inputField = page.locator(inputSelector).first();
                    await inputField.click();
                    await inputField.fill(''); // Xóa trắng
                    await inputField.type(code, { delay: 50 });
                    await sleep(1000);
                    log('[2FA] Đang nhấn Tiếp theo...');
                    await clickNextButton(page);
                } else {
                    throw new Error(`Mã 2FA không hợp lệ: ${code}`);
                }
            }
        } catch (error) { 
            log(`Info: Skip/Manual 2FA check (${error.message})`);
        }

        if (signal?.aborted) return { profileId: job.profileId, success: false, error: 'Stopped' };

        // 5. Chờ đăng nhập thành công
        try { await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 60000 }); } catch { }
        
        log('✅ Đăng nhập xong!');
        return { profileId: job.profileId, success: true, data: { gmail: sheetRow.Gmail, message: 'Done!' } };
    } catch (error) {
        return { profileId: job.profileId, success: false, error: error.message };
    }
}

module.exports = { name: 'login-google', run };
