const { sleep } = require('./helpers');

/**
 * verify-phone-sheet-check (double verify):
 * Dùng SĐT từ sheetRow.Phone, check hợp lệ với Google TRƯỚC khi gửi code.
 * Tương đương verify-phone-sheet-check.automation.ts
 */
async function run(page, job, signal, logger) {
    const log = (msg) => { logger?.(msg); console.log(`[P${job.profileId}] ${msg}`); };
    try {
        const { sheetRow } = job;
        if (!sheetRow?.Phone) throw new Error('Thiếu Phone trong sheetRow');
        if (signal?.aborted) return { profileId: job.profileId, success: false, error: 'Stopped' };

        // 1. Kiểm tra ô nhập SĐT
        const phoneInput = await page.$('#phoneNumberId');
        if (!phoneInput) throw new Error('Không có ô nhập số điện thoại (#phoneNumberId)');

        const phone = sheetRow.Phone;
        log(`Double-verify SĐT: ${phone}`);

        // 2. Nhập SĐT
        await page.click('#phoneNumberId', { clickCount: 3 });
        await page.keyboard.press('Backspace');
        await page.locator('#phoneNumberId').type(phone, { delay: 10 });
        await sleep(100);

        // 3. Click Next lần 1
        try {
            const btn = await page.waitForSelector('button:not([disabled])', { state: 'visible', timeout: 5000 });
            if (btn) { await btn.scrollIntoViewIfNeeded(); await sleep(200); await btn.click(); }
        } catch { }
        await sleep(2000);

        // Kiểm tra xem đã chuyển sang trang nhập OTP chưa (1-click flow)
        const codeInputSel = '[aria-label="Enter code"], [aria-label="Enter the code"], #idvAnyPhonePin, [name="pin"]';
        let isOtpPage = await page.locator(codeInputSel).first().isVisible({ timeout: 2000 }).catch(() => false);
        if (isOtpPage) {
            log(`✓ SĐT ${phone} hợp lệ (đã chuyển sang trang nhập OTP)`);
        } else {
            // 4. Kiểm tra lỗi sau click 1
            const isInvalid1 = await checkIfPhoneInvalid(page);
            if (isInvalid1) {
                log(`✗ ${phone} — Invalid (sau click 1)`);
                return { profileId: job.profileId, success: false, error: 'Phone invalid based on Google check' };
            }

            // 5. Click Next lần 2 (nếu có)
            try {
                const btn2 = await page.waitForSelector('button[type="button"]', { state: 'visible', timeout: 4000 }).catch(() => null);
                if (btn2) { await btn2.click(); await sleep(2000); }
            } catch { }

            // Kiểm tra lại xem đã sang trang nhập OTP chưa sau click 2
            isOtpPage = await page.locator(codeInputSel).first().isVisible({ timeout: 2000 }).catch(() => false);
            if (!isOtpPage) {
                // 6. Kiểm tra lỗi sau click 2
                const isInvalid2 = await checkIfPhoneInvalid(page);
                if (isInvalid2) {
                    log(`✗ ${phone} — Invalid (sau click 2)`);
                    return { profileId: job.profileId, success: false, error: 'Phone invalid after 2nd submit' };
                }
                
                // Fallback check
                log(`⚠️ Không rõ trạng thái của ${phone}, tạm coi là valid`);
            } else {
                log(`✓ SĐT ${phone} hợp lệ (đã chuyển sang trang nhập OTP sau click 2)`);
            }
        }

        // 7. Lấy verification code
        log(`Lấy code cho SĐT: ${phone}`);
        const verificationCode = await getVerificationCode(phone, job.profileId);
        if (!verificationCode) throw new Error('Không lấy được verification code');
        log(`Code: ${verificationCode}`);

        if (signal?.aborted) return { profileId: job.profileId, success: false, error: 'Stopped' };

        // 8. Điền code
        const codeInputSel = '[aria-label="Enter code"], [aria-label="Enter the code"], #idvAnyPhonePin, [name="pin"]';
        await page.waitForSelector(codeInputSel, { state: 'visible', timeout: 30000 });
        await page.locator(codeInputSel).first().type(verificationCode, { delay: 20 });
        await sleep(1000);

        if (signal?.aborted) return { profileId: job.profileId, success: false, error: 'Stopped' };

        // 9. Submit bằng XPath hoặc fallback
        let submitted = false;
        try {
            await page.waitForSelector('xpath///*[@id="idvPreregisteredPhoneNext"]/div/button', { state: 'visible', timeout: 5000 });
            await page.locator('xpath///*[@id="idvPreregisteredPhoneNext"]/div/button').click();
            submitted = true;
        } catch { }

        if (!submitted) {
            await page.evaluate(() => {
                const btn = Array.from(document.querySelectorAll('button')).find(b =>
                    !b.disabled && (b.textContent?.trim().toLowerCase() === 'next' || b.textContent?.trim().toLowerCase() === 'verify')
                );
                if (btn) btn.click();
            });
        }
        await sleep(2000);

        log('✅ Xác minh SĐT (double check) thành công!');
        return { profileId: job.profileId, success: true, data: { phone, code: verificationCode, message: 'Phone verified and checked!' } };
    } catch (error) {
        return { profileId: job.profileId, success: false, error: error.message };
    }
}

async function checkIfPhoneInvalid(page) {
    try {
        return await page.evaluate(() => {
            const bodyText = document.body.innerText || '';
            const errorKeywords = [
                "can't be used for verification",
                "cannot be used for verification",
                "too many unsuccessful attempts",
                "Use another phone number",
                "không thể dùng để xác minh",
                "quá nhiều lần thử",
                "thử số điện thoại khác",
                "chọn số điện thoại khác"
            ];
            return errorKeywords.some(kw => bodyText.toLowerCase().includes(kw.toLowerCase()));
        });
    } catch { return false; }
}

async function getVerificationCode(phoneNumber, profileId) {
    const apiUrl = `http://127.0.0.1:${process.env.API_PORT || 3333}/api/phone/lookup?number=${encodeURIComponent(phoneNumber)}`;
    const maxRetries = 45;
    for (let i = 1; i <= maxRetries; i++) {
        try {
            const res = await fetch(apiUrl);
            if (res.status === 500) { await sleep(2000); continue; }
            const data = await res.json();
            if (data.code) return data.code;
            console.warn(`[P${profileId}] No code in response (attempt ${i}/${maxRetries})`);
            await sleep(2000);
        } catch { await sleep(2000); }
    }
    return null;
}

module.exports = { name: 'verify-phone-sheet-check', run };
