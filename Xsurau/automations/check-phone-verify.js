const { sleep } = require('./helpers');

/**
 * Lấy số điện thoại từ queue, check từng số với Google, trả về số hợp lệ + xác minh.
 * Giống check-phone-verify.automation.ts nhưng dùng Playwright thay Puppeteer.
 */
async function run(page, job, signal, logger) {
    const log = (msg) => { logger?.(msg); console.log(`[P${job.profileId}] ${msg}`); };

    try {
        if (signal?.aborted) return { profileId: job.profileId, success: false, error: 'Stopped' };

        // 1. Kiểm tra ô nhập SĐT tồn tại
        const phoneInput = await page.$('#phoneNumberId');
        if (!phoneInput) throw new Error('Không có ô nhập số điện thoại (#phoneNumberId)');

        let usablePhone = null;
        const maxAttempts = 70;
        let attempt = 0;

        // 2. Vòng lặp lấy & check SĐT
        while (attempt < maxAttempts && !usablePhone) {
            if (signal?.aborted) return { profileId: job.profileId, success: false, error: 'Stopped' };
            attempt++;
            log(`=== Lần thử ${attempt}/${maxAttempts} ===`);

            // Lấy SĐT tiếp theo từ queue
            const phoneData = await getNextPhoneFromQueue(job.profileId);
            if (!phoneData?.phoneNumber?.trim()) { log('Không còn SĐT trong queue.'); break; }

            const phone = phoneData.phoneNumber;
            log(`Checking: ${phone}`);

            // Nhập SĐT
            await page.click('#phoneNumberId', { clickCount: 3 });
            await page.keyboard.press('Backspace');
            await page.locator('#phoneNumberId').type(phone, { delay: 10 });
            await sleep(500);

            // Click Next lần 1
            try {
                const btn = await page.waitForSelector('button:not([disabled])', { state: 'visible', timeout: 5000 });
                if (btn) { await btn.scrollIntoViewIfNeeded(); await sleep(200); await btn.click(); }
            } catch { }

            await sleep(2000);

            // Kiểm tra lỗi sau click 1
            const isInvalid = await checkIfPhoneInvalid(page);
            if (isInvalid) {
                log(`✗ ${phone} (Invalid sau click 1)`);
                await markPhoneInQueue(phone, job.profileId, false);
                continue;
            }

            // Click Next lần 2
            try {
                const btn2 = await page.waitForSelector('button[type="button"]', { state: 'visible', timeout: 10000 });
                if (btn2) { await btn2.click(); }
            } catch { }
            await sleep(2000);
            if (signal?.aborted) return { profileId: job.profileId, success: false, error: 'Stopped' };

            // Kiểm tra lỗi sau click 2
            const hasErrorAfterClick2 = await checkIfPhoneInvalid(page);
            if (hasErrorAfterClick2) {
                log(`✗ ${phone} (Invalid sau click 2)`);
                await markPhoneInQueue(phone, job.profileId, false);
                continue;
            }

            // Đọc SĐT thực tế Google gửi code tới
            const actualPhone = await page.evaluate(() => {
                const bodyText = document.body.innerText || '';
                const match = bodyText.match(/\((\d{3})\)\s*(\d{3})-(\d{4})/);
                return match ? match[1] + match[2] + match[3] : null;
            });

            if (!actualPhone) {
                log(`✗ ${phone} — Không đọc được SĐT trên trang`);
                await markPhoneInQueue(phone, job.profileId, false);
                continue;
            }

            log(`✓ ${actualPhone} (Valid)`);
            usablePhone = actualPhone;
            break;
        }

        if (!usablePhone) throw new Error(`Không tìm được SĐT hợp lệ sau ${attempt} lần`);

        if (signal?.aborted) return { profileId: job.profileId, success: false, error: 'Stopped' };

        // 3. Lấy verification code
        log(`Lấy code cho ${usablePhone}...`);
        const verificationCode = await getVerificationCode(usablePhone, job.profileId);
        if (!verificationCode) throw new Error('Không lấy được verification code');
        log(`Code: ${verificationCode}`);

        // 4. Điền code
        await page.waitForSelector('[aria-label="Enter code"]', { state: 'visible', timeout: 30000 });
        await page.locator('[aria-label="Enter code"]').type(verificationCode, { delay: 20 });
        await sleep(1000);

        if (signal?.aborted) return { profileId: job.profileId, success: false, error: 'Stopped' };

        // 5. Submit
        await submitCode(page, job.profileId);
        await sleep(2000);

        // 6. Mark valid + update sheet
        await markPhoneInQueue(usablePhone, job.profileId, true);
        if (job.sheetRow?.Gmail) await updatePhoneInSheet(job.sheetRow.Gmail, usablePhone);

        log('✅ Xác minh SĐT thành công!');
        return { profileId: job.profileId, success: true, data: { phone: usablePhone, code: verificationCode } };
    } catch (error) {
        return { profileId: job.profileId, success: false, error: error.message };
    }
}

// ============ HELPERS ============

async function getNextPhoneFromQueue(profileId) {
    try {
        const res = await fetch(`http://localhost:1337/api/phone/queue/next?profileId=${profileId}`);
        const data = await res.json();
        if (data.error) return null;
        return data;
    } catch { return null; }
}

async function markPhoneInQueue(phoneNumber, profileId, isValid) {
    try {
        await fetch('http://localhost:1337/api/phone/queue/mark', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phoneNumber, profileId: Number(profileId), isValid }),
        });
    } catch { }
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
            if (res.status === 500) { await sleep(2000); continue; }
            const data = await res.json();
            if (data.code) return data.code;
            await sleep(2000);
        } catch { await sleep(2000); }
    }
    return null;
}

async function updatePhoneInSheet(gmail, phoneNumber) {
    try {
        await fetch('http://localhost:1337/api/sheet/update-phone', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gmail, phone: phoneNumber }),
        });
    } catch { }
}

async function submitCode(page, profileId) {
    for (const sel of ['xpath///*[@id="idvPreregisteredPhoneNext"]/div/button', 'button[jsname="V67Aae"]', 'button:not([disabled])']) {
        try {
            const btn = await page.waitForSelector(sel, { state: 'visible', timeout: 3000 });
            if (btn) { await btn.click(); return; }
        } catch { }
    }
    await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim().toLowerCase() === 'next' && !b.disabled);
        if (btn) btn.click();
    });
}

module.exports = { name: 'check-phone-verify', run };
