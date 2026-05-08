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
                // ===== LUỒNG 2FA (Authenticator) =====
                log('[2FA] Đang xử lý mã 2FA...');

                // 1. Kiểm tra xem ô nhập mã đã hiện sẵn chưa để bỏ qua bước chọn phương thức
                const inputSelector = 'input[type="tel"], input#totpPin, input[autocomplete="one-time-code"]';
                const isInputVisible = await page.locator(inputSelector).first().isVisible({ timeout: 5000 }).catch(() => false);

                if (!isInputVisible) {
                    log('[2FA] Chưa thấy ô nhập mã, đang tìm phương thức xác thực...');
                    try {
                        const selectionResult = await page.evaluate(() => {
                            const findAndClick = (selector) => {
                                const elements = Array.from(document.querySelectorAll(selector));
                                for (const el of elements) {
                                    const text = el.textContent?.toLowerCase() || '';
                                    const isAuth = text.includes('authenticator') || text.includes('app');
                                    const isWrong = text.includes('offline') || text.includes('security code') || text.includes('sms');
                                    if (isAuth && !isWrong) {
                                        el.scrollIntoView({ block: 'center' });
                                        el.click();
                                        return true;
                                    }
                                }
                                return false;
                            };

                            // Ưu tiên 1: challengetype="6"
                            if (findAndClick('[data-challengetype="6"]')) return 'type6';
                            // Ưu tiên 2: challengeid="2"
                            if (findAndClick('[data-challengeid="2"]')) return 'id2';
                            // Ưu tiên 3: challengeid="3"
                            if (findAndClick('[data-challengeid="3"]')) return 'id3';
                            // Cuối cùng: tìm bất kỳ mục nào có text khớp
                            if (findAndClick('li, div[role="link"], div[role="button"]')) return 'text_fallback';
                            
                            return null;
                        });

                        if (selectionResult) {
                            log(`[2FA] Đã chọn phương thức (${selectionResult}), đợi chuyển trang...`);
                            await sleep(2500);
                        }
                    } catch (e) {
                        log('[2FA] Lỗi khi chọn phương thức: ' + e.message);
                    }
                }

                // 2. Đợi ô nhập mã (type="tel" là chuẩn nhất)
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
