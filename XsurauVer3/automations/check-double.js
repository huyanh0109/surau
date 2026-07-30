const { sleep } = require('./helpers');

const API_BASE = `http://127.0.0.1:${process.env.API_PORT || 3334}`;

/**
 * CHECK DOUBLE (Combine Check Phone Verify + Fast Retry Double Verify)
 * 
 * Multi-Sheet Profiles Ready:
 * - Dùng `job.profileId` để lấy SĐT riêng từ Queue theo từng profile.
 * - Dùng `job.sheetRow.Gmail` để cập nhật kết quả SĐT về đúng row sheet của từng profile.
 * 
 * Luồng hoạt động:
 * GIAI ĐOẠN 1: Check Phone Verify
 *   1. Lấy SĐT từ Phone Queue.
 *   2. Điền SĐT vào #phoneNumberId, kiểm tra tính hợp lệ.
 *   3. Nếu hợp lệ -> Lấy mã OTP qua API và xác minh Lần 1.
 *   4. Lưu usablePhone & cập nhật Google Sheet cho Profile.
 * 
 * GIAI ĐOẠN 2: Fast-Retry Double Verify (50 lần với đúng usablePhone)
 *   1. Sử dụng đúng SĐT (usablePhone) vừa xác minh ở Giai đoạn 1.
 *   2. Nhập liên tục thật nhanh vào ô #phoneNumberId ở bước verify 2 (tối đa 50 lần).
 *   3. Đến khi Google chấp nhận và chuyển sang trang nhập OTP Lần 2.
 *   4. Lấy mã OTP lần 2 qua API, điền mã & hoàn tất.
 */

// Dùng Promise chung để tránh nhiều profile cùng load queue 1 lúc
let _queueLoadPromise = null;

async function run(page, job, signal, logger) {
    const log = (msg) => {
        logger?.(msg);
        console.log(`[P${job.profileId}] ${msg}`);
    };

    try {
        if (signal?.aborted) {
            return { profileId: job.profileId, success: false, error: 'Stopped' };
        }

        // ============================================================
        // GIAI ĐOẠN 1: CHECK & VERIFY SĐT LẦN 1
        // ============================================================
        log(`=== GIAI ĐOẠN 1: CHECK PHONE VERIFY LẦN 1 ===`);

        // Auto-load queue nếu trống
        await ensureQueueLoaded(log);

        if (signal?.aborted) {
            return { profileId: job.profileId, success: false, error: 'Stopped' };
        }

        const phoneInputSelector = '#phoneNumberId';
        const codeInputSel = '[aria-label="Enter code"], [aria-label="Enter the code"], #idvAnyPhonePin, [name="pin"]';
        
        log(`Tìm tab có ô nhập SĐT (${phoneInputSelector})...`);

        let activePage = page;
        const deadline = Date.now() + 30000;
        let found = false;

        while (Date.now() < deadline) {
            if (signal?.aborted) {
                return { profileId: job.profileId, success: false, error: 'Stopped' };
            }
            try {
                const allPages = page.context().pages();
                for (const p of allPages) {
                    try {
                        const el = await p.$(phoneInputSelector);
                        if (el && await el.isVisible({ timeout: 300 })) {
                            activePage = p;
                            found = true;
                            if (activePage !== page) {
                                log(`⚠️ Tab ban đầu sai, chuyển sang: ${activePage.url()}`);
                                try { await activePage.bringToFront(); } catch { }
                            }
                            break;
                        }
                    } catch { }
                }
            } catch { }

            if (found) break;
            await sleep(500);
        }

        if (!found) {
            log(`❌ Không tìm thấy ô nhập số điện thoại (${phoneInputSelector})`);
            throw new Error(`Không có ô nhập số điện thoại (${phoneInputSelector})`);
        }
        log(`✅ Tìm thấy ô nhập SĐT Lần 1`);

        page = activePage;

        let usablePhone = null;
        const maxAttempts = 40;
        let attempt = 0;

        while (attempt < maxAttempts && !usablePhone) {
            if (signal?.aborted) {
                log(`⏹️ Dừng lại theo signal tại lần thử ${attempt}`);
                return { profileId: job.profileId, success: false, error: 'Stopped' };
            }

            attempt++;
            log(`--- GĐ1: Lần thử ${attempt}/${maxAttempts} ---`);

            const inputStillVisible = await page.locator(phoneInputSelector).isVisible({ timeout: 2000 }).catch(() => false);
            if (!inputStillVisible) {
                log(`Tab hiện tại không còn ô nhập SĐT, tìm lại qua các tab...`);
                let refound = false;
                try {
                    const allPages = page.context().pages();
                    for (const p of allPages) {
                        try {
                            const vis = await p.locator(phoneInputSelector).isVisible({ timeout: 1000 }).catch(() => false);
                            if (vis) { page = p; refound = true; try { await page.bringToFront(); } catch { } break; }
                        } catch { }
                    }
                } catch { }
                if (!refound) {
                    log(`❌ Không còn tìm thấy ô nhập SĐT trên bất kỳ tab nào. Dừng.`);
                    break;
                }
            }

            // Lấy số từ queue cho profileId này
            const phoneData = await getNextPhoneFromQueue(job.profileId);

            if (!phoneData || !phoneData.phoneNumber || phoneData.phoneNumber.trim() === '') {
                log(`⚠️ Không còn SĐT trong queue. Dừng lại.`);
                break;
            }

            const phone = phoneData.phoneNumber;
            log(`Checking: ${phone}`);

            try {
                await page.locator(phoneInputSelector).click({ clickCount: 3, timeout: 5000 });
            } catch {
                await page.click(phoneInputSelector, { clickCount: 3 });
            }
            await page.keyboard.press('Backspace');
            await page.type(phoneInputSelector, phone, { delay: 10 });
            await sleep(500);

            // Click Next lần 1
            try {
                const nextBtn = await page.waitForSelector('button:not([disabled])', { state: 'visible', timeout: 5000 });
                if (nextBtn) {
                    await nextBtn.evaluate(el => el.scrollIntoView({ block: 'center' }));
                    await sleep(200);
                    await nextBtn.click();
                }
            } catch (err) {
                log(`⚠️ Không click được nút Next lần 1: ${err.message}`);
            }

            await sleep(2000);

            // Kiểm tra xem đã sang trang OTP chưa
            let isOtpPage = await page.locator(codeInputSel).first().isVisible({ timeout: 2000 }).catch(() => false);
            if (isOtpPage) {
                log(`✓ SĐT ${phone} hợp lệ (đã chuyển sang trang nhập OTP)`);
                usablePhone = phone;
                break;
            }

            // Kiểm tra lỗi sau click 1
            const isInvalid = await checkIfPhoneInvalid(page);
            if (isInvalid) {
                log(`✗ ${phone} (Invalid sau click 1)`);
                await markPhoneInQueue(phone, job.profileId, false);
                continue;
            }

            // Click Next lần 2 (nếu có)
            try {
                const nextBtn2 = await page.waitForSelector('button[type="button"]', { state: 'visible', timeout: 4000 }).catch(() => null);
                if (nextBtn2) {
                    await nextBtn2.click();
                    await sleep(2000);
                }
            } catch (err) {
                log(`Info: Không có hoặc không click được Next lần 2: ${err.message}`);
            }

            isOtpPage = await page.locator(codeInputSel).first().isVisible({ timeout: 2000 }).catch(() => false);
            if (isOtpPage) {
                log(`✓ SĐT ${phone} hợp lệ (đã chuyển sang trang nhập OTP sau click 2)`);
                usablePhone = phone;
                break;
            }

            const hasErrorAfterClick2 = await checkIfPhoneInvalid(page);
            if (hasErrorAfterClick2) {
                log(`✗ ${phone} (Invalid sau click 2)`);
                await markPhoneInQueue(phone, job.profileId, false);
                usablePhone = null;
                continue;
            }

            log(`⚠️ Không rõ trạng thái của ${phone}, tạm coi là valid`);
            usablePhone = phone;
            break;
        }

        if (!usablePhone) {
            throw new Error(`Không tìm được SĐT hợp lệ sau ${attempt} lần thử`);
        }

        if (signal?.aborted) {
            return { profileId: job.profileId, success: false, error: 'Stopped' };
        }

        // Lấy verification code Lần 1
        log(`Lấy verification code lần 1 cho ${usablePhone}...`);
        const verificationCode1 = await getVerificationCode(usablePhone, job.profileId);
        if (!verificationCode1) throw new Error('Không lấy được verification code lần 1');
        log(`Code 1: ${verificationCode1}`);

        // Điền code 1
        await page.waitForSelector(codeInputSel, { state: 'visible', timeout: 30000 });
        await page.locator(codeInputSel).first().type(verificationCode1, { delay: 20 });
        await sleep(1000);

        if (signal?.aborted) {
            return { profileId: job.profileId, success: false, error: 'Stopped' };
        }

        // Submit Code 1
        let submitted1 = false;
        for (const sel of [
            'xpath///*[@id="idvPreregisteredPhoneNext"]/div/button',
            'button[jsname="V67Aae"]',
            'button:not([disabled])',
        ]) {
            try {
                const btn = await page.waitForSelector(sel, { state: 'visible', timeout: 3000 });
                if (btn) { await btn.click(); submitted1 = true; break; }
            } catch { }
        }
        if (!submitted1) {
            await page.evaluate(() => {
                const btn = Array.from(document.querySelectorAll('button')).find(b =>
                    b.textContent?.trim().toLowerCase() === 'next' && !b.disabled
                );
                if (btn) btn.click();
            });
        }

        await sleep(2500);

        // Mark valid trong Queue & Cập nhật Google Sheet cho Profile nếu có Gmail
        await markPhoneInQueue(usablePhone, job.profileId, true);

        if (job.sheetRow?.Gmail) {
            log(`📋 Cập nhật Sheet [Profile ${job.profileId}]: Gmail=${job.sheetRow.Gmail}, Phone=${usablePhone}`);
            await updatePhoneInSheet(job.sheetRow.Gmail, usablePhone);
        } else {
            log(`⚠️ SheetRow không có Gmail — bỏ qua cập nhật Sheet`);
        }

        log(`✅ GIAI ĐOẠN 1 THÀNH CÔNG (SĐT: ${usablePhone})`);

        // ============================================================
        // GIAI ĐOẠN 2: DOUBLE VERIFY - FAST RETRY 50 LẦN
        // ============================================================
        log(`=== GIAI ĐOẠN 2: FAST-RETRY DOUBLE VERIFY (50 LẦN VỚI ${usablePhone}) ===`);

        const maxSpamAttempts = 50;
        let doubleVerifySuccess = false;

        for (let spamAttempt = 1; spamAttempt <= maxSpamAttempts; spamAttempt++) {
            if (signal?.aborted) {
                return { profileId: job.profileId, success: false, error: 'Stopped' };
            }

            log(`⚡ GĐ2: Fast retry lần ${spamAttempt}/${maxSpamAttempts} với SĐT: ${usablePhone}...`);

            // Kiểm tra xem đã chuyển sang trang OTP lần 2 chưa
            let isOtpPage2 = await page.locator(codeInputSel).first().isVisible({ timeout: 1000 }).catch(() => false);
            if (isOtpPage2) {
                log(`🎯 Đã ở trang OTP Lần 2 tại lượt thử ${spamAttempt}!`);
                doubleVerifySuccess = true;
                break;
            }

            // Tìm ô nhập SĐT bước 2
            let phoneInput2 = await page.locator(phoneInputSelector).isVisible({ timeout: 1500 }).catch(() => false);
            if (!phoneInput2) {
                // Kiểm tra lại trên các tab nếu ô input bị đổi tab
                const allPages = page.context().pages();
                for (const p of allPages) {
                    try {
                        const vis = await p.locator(phoneInputSelector).isVisible({ timeout: 500 }).catch(() => false);
                        if (vis) { page = p; phoneInput2 = true; break; }
                    } catch { }
                }
            }

            if (phoneInput2) {
                try {
                    await page.locator(phoneInputSelector).click({ clickCount: 3, timeout: 2000 });
                } catch {
                    await page.click(phoneInputSelector, { clickCount: 3 }).catch(() => {});
                }
                await page.keyboard.press('Backspace');
                await page.type(phoneInputSelector, usablePhone, { delay: 5 });

                // Click Next thật nhanh
                try {
                    const nextBtn = await page.waitForSelector('button:not([disabled])', { state: 'visible', timeout: 2000 });
                    if (nextBtn) await nextBtn.click();
                } catch { }
            }

            await sleep(600); // Chờ ngắn trước khi check kết quả

            // Check xem đã chuyển sang trang OTP lần 2 chưa
            isOtpPage2 = await page.locator(codeInputSel).first().isVisible({ timeout: 1500 }).catch(() => false);
            if (isOtpPage2) {
                log(`🎯 Google đã chấp nhận số ${usablePhone} ở lần thử thứ ${spamAttempt}!`);
                doubleVerifySuccess = true;
                break;
            }
        }

        if (!doubleVerifySuccess) {
            throw new Error(`Đã thử nhập lại ${maxSpamAttempts} lần nhưng Google chưa chuyển sang trang OTP lần 2`);
        }

        if (signal?.aborted) {
            return { profileId: job.profileId, success: false, error: 'Stopped' };
        }

        // Lấy verification code Lần 2
        log(`Lấy verification code lần 2 cho ${usablePhone}...`);
        const verificationCode2 = await getVerificationCode(usablePhone, job.profileId);
        if (!verificationCode2) throw new Error('Không lấy được verification code lần 2');
        log(`Code 2: ${verificationCode2}`);

        // Điền code 2
        await page.waitForSelector(codeInputSel, { state: 'visible', timeout: 30000 });
        await page.locator(codeInputSel).first().type(verificationCode2, { delay: 20 });
        await sleep(1000);

        if (signal?.aborted) {
            return { profileId: job.profileId, success: false, error: 'Stopped' };
        }

        // Submit Code 2
        let submitted2 = false;
        for (const sel of [
            'xpath///*[@id="idvPreregisteredPhoneNext"]/div/button',
            'button[jsname="V67Aae"]',
            'button:not([disabled])',
        ]) {
            try {
                const btn = await page.waitForSelector(sel, { state: 'visible', timeout: 3000 });
                if (btn) { await btn.click(); submitted2 = true; break; }
            } catch { }
        }
        if (!submitted2) {
            await page.evaluate(() => {
                const btn = Array.from(document.querySelectorAll('button')).find(b =>
                    b.textContent?.trim().toLowerCase() === 'next' && !b.disabled
                );
                if (btn) btn.click();
            });
        }

        await sleep(2000);

        log(`🎉 HOÀN THÀNH CHECK DOUBLE THÀNH CÔNG CHO PROFILE ${job.profileId}!`);
        return {
            profileId: job.profileId,
            success: true,
            data: { phone: usablePhone, code: verificationCode2, message: 'Check Double verified successfully!' }
        };

    } catch (error) {
        log(`❌ Lỗi Check Double: ${error.message}`);
        return { profileId: job.profileId, success: false, error: error.message };
    }
}

// ============================================================
// HELPERS
// ============================================================

async function ensureQueueLoaded(log) {
    try {
        const res = await fetch(`${API_BASE}/api/phone/queue/status`);
        const status = await res.json();
        if (status.available > 0) {
            log(`Queue đã có sẵn ${status.total} SĐT (available: ${status.available})`);
            return;
        }
    } catch { }

    if (!_queueLoadPromise) {
        log('Queue trống, đang load SĐT từ sheet...');
        _queueLoadPromise = fetch(`${API_BASE}/api/phone/queue/load`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ days: 0, limit: 300 }),
        })
            .then(r => r.json())
            .then(data => { log(`Load queue xong: ${data.total || 0} SĐT`); return data; })
            .catch(() => null)
            .finally(() => { _queueLoadPromise = null; });
    } else {
        log('Đang chờ profile khác load queue xong...');
    }

    await _queueLoadPromise;
}

async function getNextPhoneFromQueue(profileId) {
    try {
        const res = await fetch(`${API_BASE}/api/phone/queue/next?profileId=${profileId}`);
        const data = await res.json();
        if (data.error) return null;
        return data;
    } catch {
        return null;
    }
}

async function markPhoneInQueue(phoneNumber, profileId, isValid) {
    try {
        await fetch(`${API_BASE}/api/phone/queue/mark`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phoneNumber, profileId, isValid }),
        });
    } catch { }
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
    const apiUrl = `${API_BASE}/api/phone/lookup?number=${encodeURIComponent(phoneNumber)}`;
    const maxRetries = 45;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const res = await fetch(apiUrl);
            if (res.status === 500) {
                console.log(`[P${profileId}] [Code] API 500, thử lại (${attempt}/${maxRetries})...`);
                await sleep(2000);
                continue;
            }
            const text = await res.text();
            let data;
            try { data = JSON.parse(text); } catch { await sleep(2000); continue; }
            if (data.code) return data.code;
            console.log(`[P${profileId}] [Code] Chưa có code, thử lại (${attempt}/${maxRetries})...`);
            await sleep(2000);
        } catch (err) {
            console.error(`[P${profileId}] [Code] Lỗi: ${err.message}`);
            await sleep(2000);
        }
    }
    return null;
}

async function updatePhoneInSheet(gmail, phoneNumber) {
    try {
        await fetch(`${API_BASE}/api/sheet/update-phone`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gmail, phone: phoneNumber, automationName: 'check-double' }),
        });
    } catch { }
}

module.exports = { name: 'check-double', run };
