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
        await sleep(1000);

        // 4. Kiểm tra lỗi sau click 1
        const isInvalid1 = await checkIfPhoneInvalid(page);
        if (isInvalid1) {
            log(`✗ ${phone} — Invalid (sau click 1)`);
            return { profileId: job.profileId, success: false, error: 'Phone invalid based on Google check' };
        }

        // 5. Click Next lần 2
        try {
            const btn2 = await page.waitForSelector('button[type="button"]', { state: 'visible', timeout: 5000 });
            if (btn2) { await btn2.click(); }
        } catch { }
        await sleep(1000);

        if (signal?.aborted) return { profileId: job.profileId, success: false, error: 'Stopped' };

        // 6. Kiểm tra lỗi sau click 2
        const isInvalid2 = await checkIfPhoneInvalid(page);
        if (isInvalid2) {
            log(`✗ ${phone} — Invalid (sau click 2)`);
            return { profileId: job.profileId, success: false, error: 'Phone invalid after 2nd submit' };
        }

        // 7. Lấy verification code
        log(`Lấy code cho ${phone}...`);
        const verificationCode = await getVerificationCode(phone, job.profileId);
        if (!verificationCode) throw new Error('Không lấy được verification code từ API');
        log(`Code: ${verificationCode}`);

        // 8. Điền code
        await page.waitForSelector('[aria-label="Enter code"], [aria-label="Enter the code"]', { state: 'visible', timeout: 30000 });
        // Chọn input đúng
        let inputSel = '[aria-label="Enter code"]';
        const altInputs = await page.$$('[aria-label="Enter the code"]');
        if (altInputs.length > 0) inputSel = '[aria-label="Enter the code"]';
        await page.locator(inputSel).type(verificationCode, { delay: 20 });
        await sleep(1000);

        if (signal?.aborted) return { profileId: job.profileId, success: false, error: 'Stopped' };

        // 9. Submit
        let submitted = false;
        for (const sel of [
            'xpath///*[@id="idvPreregisteredPhoneNext"]/div/button',
            'button[jsname="V67Aae"]',
            'button:not([disabled])',
        ]) {
            try {
                const btn = await page.waitForSelector(sel, { state: 'visible', timeout: 3000 });
                if (btn) { await btn.click(); submitted = true; break; }
            } catch { }
        }
        if (!submitted) {
            await page.evaluate(() => {
                const btn = Array.from(document.querySelectorAll('button')).find(b =>
                    b.textContent?.trim().toLowerCase() === 'next' && !b.disabled
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
            return ["can't be used for verification", "cannot be used for verification",
                "too many unsuccessful attempts", "Use another phone number"]
                .some(kw => bodyText.includes(kw));
        });
    } catch { return false; }
}

async function getVerificationCode(phoneNumber, profileId) {
    const apiUrl = `http://localhost:1337/api/phone/lookup?number=${encodeURIComponent(phoneNumber)}`;
    for (let i = 1; i <= 5; i++) {
        try {
            const res = await fetch(apiUrl);
            if (res.status === 500) { await new Promise(r => setTimeout(r, 2000)); continue; }
            const text = await res.text();
            const data = JSON.parse(text);
            if (data.code) return data.code;
            await new Promise(r => setTimeout(r, 2000));
        } catch { await new Promise(r => setTimeout(r, 2000)); }
    }
    return null;
}

module.exports = { name: 'verify-phone-sheet-check', run };
