const { sleep, generate2FACode, clickNextButton } = require('./helpers');

/** @type {import('../automation-engine').AutomationTask} */
module.exports = async (page, job, log, signal) => {
    const { sheetRow } = job;
    if (!sheetRow?.Recover) {
        log('ERROR: Missing 2FA Secret in Recover column', 'error');
        return { profileId: job.profileId, success: false, error: 'Missing 2FA Secret' };
    }

    try {
        log('[SOLVE-2FA] Bắt đầu quét màn hình 2FA...');

        const inputSelector = 'input[type="tel"], input#totpPin, input[autocomplete="one-time-code"]';
        
        // 1. Kiểm tra nhanh xem ô nhập có sẵn không
        let isInputVisible = await page.locator(inputSelector).first().isVisible({ timeout: 3000 }).catch(() => false);

        if (!isInputVisible) {
            log('[SOLVE-2FA] Chưa thấy ô nhập, tìm phương thức xác thực...');
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

                // Thứ tự ưu tiên như đã thống nhất
                if (findAndClick('[data-challengetype="6"]')) return 'type6';
                if (findAndClick('[data-challengeid="2"]')) return 'id2';
                if (findAndClick('[data-challengeid="3"]')) return 'id3';
                if (findAndClick('li, div[role="link"], div[role="button"]')) return 'text_fallback';
                return null;
            });

            if (selectionResult) {
                log(`[SOLVE-2FA] Đã chọn phương thức (${selectionResult}), đợi chuyển trang...`);
                await sleep(3000);
            }
        }

        // 2. Chờ ô nhập hiện ra (hoặc đã hiện sẵn)
        log('[SOLVE-2FA] Đợi ô nhập mã (max 10s)...');
        await page.waitForSelector(inputSelector, { state: 'visible', timeout: 10000 });
        
        // 3. Giải mã và điền
        const code = generate2FACode(sheetRow.Recover);
        if (!code || code.length !== 6) {
            throw new Error(`Mã 2FA sinh ra không hợp lệ: ${code}`);
        }

        log(`[SOLVE-2FA] Điền mã: ${code}`);
        const inputField = page.locator(inputSelector).first();
        await inputField.click();
        await inputField.fill('');
        await inputField.type(code, { delay: 50 });
        await sleep(1000);
        
        log('[SOLVE-2FA] Nhấn Tiếp theo...');
        await clickNextButton(page);
        
        log('[SOLVE-2FA] Hoàn tất giải quyết 2FA!', 'success');
        return { profileId: job.profileId, success: true };

    } catch (error) {
        log(`[SOLVE-2FA] Lỗi hoặc không thấy mục tiêu: ${error.message}`, 'warning');
        return { profileId: job.profileId, success: false, error: error.message };
    }
};
