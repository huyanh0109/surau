const { sleep } = require('./helpers');

/**
 * verify-phone-sheet: Dùng SĐT từ sheetRow.Phone để xác minh (không cần queue).
 * Tương đương verify-phone-sheet.automation.ts
 */
async function run(page, job, signal, logger) {
    const log = (msg) => { logger?.(msg); console.log(`[P${job.profileId}] ${msg}`); };
    try {
        const { sheetRow } = job;
        if (!sheetRow?.Phone) throw new Error('Thiếu Phone trong sheetRow');

        if (signal?.aborted) return { profileId: job.profileId, success: false, error: 'Stopped' };

        // 1. Click button gửi code về SĐT
        await page.waitForSelector('button[type="button"]', { state: 'visible', timeout: 10000 });
        await page.locator('button[type="button"]').first().click();
        await sleep(5000);

        if (signal?.aborted) return { profileId: job.profileId, success: false, error: 'Stopped' };

        // 2. Lấy verification code từ API (với retry)
        const phoneNumber = sheetRow.Phone;
        log(`Lấy code cho SĐT: ${phoneNumber}`);
        const verificationCode = await getVerificationCode(phoneNumber, job.profileId);
        if (!verificationCode) throw new Error('Không lấy được verification code');
        log(`Code: ${verificationCode}`);

        if (signal?.aborted) return { profileId: job.profileId, success: false, error: 'Stopped' };

        // 3. Điền code
        await page.waitForSelector('[aria-label="Enter the code"]', { state: 'visible', timeout: 30000 });
        await page.locator('[aria-label="Enter the code"]').type(verificationCode, { delay: 20 });
        await sleep(1000);

        if (signal?.aborted) return { profileId: job.profileId, success: false, error: 'Stopped' };

        // 4. Submit bằng XPath hoặc fallback
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

        // 5. Update sheet
        if (sheetRow?.Gmail) await updateSheetAfterVerification(sheetRow.Gmail);

        log('✅ Xác minh SĐT thành công!');
        return { profileId: job.profileId, success: true, data: { phone: phoneNumber, code: verificationCode, message: 'Phone verified!' } };
    } catch (error) {
        return { profileId: job.profileId, success: false, error: error.message };
    }
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

function getCurrentDateGMT7() {
    const now = new Date();
    const gmt7 = new Date(now.getTime() + 7 * 3600000);
    return `${gmt7.getUTCDate()}/${gmt7.getUTCMonth() + 1}/${String(gmt7.getUTCFullYear()).slice(-2)}`;
}

async function updateSheetAfterVerification(gmail) {
    try {
        await fetch(`http://localhost:${process.env.API_PORT || 3333}/api/sheet/update-note-and-date`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gmail, note: 'done', dateRestore: getCurrentDateGMT7() }),
        });
    } catch { }
}

module.exports = { name: 'verify-phone-sheet', run };
