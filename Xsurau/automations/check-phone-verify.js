const { sleep } = require('./helpers');

const API_BASE = `http://localhost:${process.env.API_PORT || 3333}`;

/**
 * Check Phone Verify — port 1-to-1 từ script gốc TypeScript (Surau).
 *
 * Logic chính:
 *  1. Kiểm tra #phoneNumberId tồn tại trên trang (không có → throw)
 *  2. Vòng lặp tối đa 70 lần: lấy số từ queue → nhập → check lỗi → nếu ok đọc SĐT từ trang
 *  3. Lấy code từ API, điền code, submit
 *  4. Mark valid + ghi sheet nếu có Gmail
 *
 * Khác biệt so với bản cũ:
 *  - Không có ensureQueueLoaded/reload (giống gốc: hết số thì dừng)
 *  - Không có findCorrectPageInContext (giống gốc: dùng page được truyền vào)
 *  - Chỉ dùng #phoneNumberId (giống gốc)
 *  - Signal abort được check trong loop
 *  - Submit dùng 4 phương pháp fallback giống gốc
 */
async function run(page, job, signal, logger) {
    const log = (msg, level = 'info') => {
        logger?.(msg);
        console.log(`[P${job.profileId}] ${msg}`);
    };

    try {
        if (signal?.aborted) {
            return { profileId: job.profileId, success: false, error: 'Stopped' };
        }

        // 1. Kiểm tra ô nhập SĐT có tồn tại không
        const phoneInputSelector = '#phoneNumberId';
        log(`Kiểm tra ô nhập SĐT (${phoneInputSelector})...`);
        const phoneInputExists = await page.$(phoneInputSelector);

        if (!phoneInputExists) {
            log(`❌ Không có ô nhập số điện thoại (${phoneInputSelector})`);
            throw new Error(`Không có ô nhập số điện thoại (${phoneInputSelector})`);
        }
        log(`✅ Tìm thấy ô nhập SĐT`);

        // 2. Vòng lặp lấy & check SĐT (tối đa 70 lần)
        let usablePhone = null;
        const maxAttempts = 70;
        let attempt = 0;

        while (attempt < maxAttempts && !usablePhone) {
            // Check abort signal
            if (signal?.aborted) {
                log(`⏹️ Dừng lại theo signal tại lần thử ${attempt}`);
                return { profileId: job.profileId, success: false, error: 'Stopped' };
            }

            attempt++;
            log(`=== Lần thử ${attempt}/${maxAttempts} ===`);

            // Lấy số tiếp theo từ queue
            const phoneData = await getNextPhoneFromQueue(job.profileId);

            if (!phoneData || !phoneData.phoneNumber || phoneData.phoneNumber.trim() === '') {
                log(`⚠️ Không còn SĐT trong queue. Dừng lại.`);
                break;
            }

            const phone = phoneData.phoneNumber;
            log(`Checking: ${phone}`);

            // Xóa nội dung cũ & nhập SĐT
            await page.click(phoneInputSelector, { clickCount: 3 });
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

            // Đợi 2s để Google hiển thị lỗi (nếu có)
            await sleep(2000);

            // Kiểm tra lỗi sau click lần 1
            const isInvalid = await checkIfPhoneInvalid(page);
            if (isInvalid) {
                log(`✗ ${phone} (Invalid sau click 1)`);
                await markPhoneInQueue(phone, job.profileId, false);
                continue;
            }

            // Bước tiếp theo: click Next lần 2 + đọc SĐT từ trang
            try {
                // Click Next lần 2
                const nextBtn2 = await page.waitForSelector('button[type="button"]', { state: 'visible', timeout: 10000 });
                if (nextBtn2) {
                    await nextBtn2.click();
                }
                await sleep(2000);

                if (signal?.aborted) {
                    return { profileId: job.profileId, success: false, error: 'Stopped' };
                }

                // Kiểm tra lỗi sau click lần 2
                const hasErrorAfterClick2 = await checkIfPhoneInvalid(page);
                if (hasErrorAfterClick2) {
                    log(`✗ ${phone} (Invalid sau click 2)`);
                    await markPhoneInQueue(phone, job.profileId, false);
                    usablePhone = null;
                    continue;
                }

                // Đọc SĐT thực tế Google gửi code đến từ trang
                const actualPhone = await page.evaluate(() => {
                    const bodyText = document.body.innerText || '';
                    const match = bodyText.match(/\((\d{3})\)\s*(\d{3})-(\d{4})/);
                    return match ? match[1] + match[2] + match[3] : null;
                });

                if (!actualPhone) {
                    log(`⚠️ Không đọc được SĐT trên trang cho ${phone}`);
                    await markPhoneInQueue(phone, job.profileId, false);
                    usablePhone = null;
                    continue;
                }

                log(`✓ ${actualPhone} (Valid)`);
                usablePhone = actualPhone;
                break;

            } catch (err) {
                log(`❌ Lỗi khi xác minh ${phone}: ${err.message}`);
                await markPhoneInQueue(phone, job.profileId, false);
                usablePhone = null;
                continue;
            }
        }

        // Hết loop mà không có số hợp lệ
        if (!usablePhone) {
            throw new Error(`Không tìm được SĐT hợp lệ sau ${attempt} lần thử`);
        }

        if (signal?.aborted) {
            return { profileId: job.profileId, success: false, error: 'Stopped' };
        }

        // 3. Lấy verification code
        log(`Lấy code cho ${usablePhone}...`);
        const verificationCode = await getVerificationCode(usablePhone, job.profileId);
        if (!verificationCode) throw new Error('Không lấy được verification code');
        log(`Code: ${verificationCode}`);

        // 4. Điền code
        await page.waitForSelector('[aria-label="Enter code"]', { state: 'visible', timeout: 30000 });
        await page.type('[aria-label="Enter code"]', verificationCode, { delay: 20 });
        await sleep(1000);

        if (signal?.aborted) {
            return { profileId: job.profileId, success: false, error: 'Stopped' };
        }

        // 5. Submit — thử 4 cách giống script gốc
        log(`Tìm nút submit...`);
        let submitButton = null;
        let clickMethod = '';

        // Cách 1: button text "Next"
        try {
            submitButton = await page.waitForSelector('button::-p-text(Next)', { state: 'visible', timeout: 3000 });
            clickMethod = 'text-selector';
        } catch { }

        // Cách 2: jsname="V67Aae"
        if (!submitButton) {
            try {
                submitButton = await page.waitForSelector('button[jsname="V67Aae"]', { state: 'visible', timeout: 3000 });
                clickMethod = 'jsname-selector';
            } catch { }
        }

        // Cách 3: button:not([disabled])
        if (!submitButton) {
            try {
                submitButton = await page.waitForSelector('button:not([disabled])', { state: 'visible', timeout: 3000 });
                clickMethod = 'enabled-button';
            } catch { }
        }

        // Cách 4: evaluate click
        if (!submitButton) {
            try {
                const clicked = await page.evaluate(() => {
                    const btn = Array.from(document.querySelectorAll('button'))
                        .find(b => b.textContent?.trim().toLowerCase() === 'next' && !b.disabled);
                    if (btn) { btn.click(); return true; }
                    return false;
                });
                if (clicked) clickMethod = 'evaluate-click';
            } catch { }
        }

        if (submitButton && clickMethod !== 'evaluate-click') {
            try {
                await submitButton.click();
            } catch (err) {
                // Fallback evaluate
                await page.evaluate(() => {
                    const btn = Array.from(document.querySelectorAll('button'))
                        .find(b => b.textContent?.trim().toLowerCase() === 'next' && !b.disabled);
                    if (btn) btn.click();
                });
            }
        } else if (!clickMethod) {
            throw new Error('Không tìm thấy nút submit');
        }

        await sleep(2000);

        // 6. Mark valid
        await markPhoneInQueue(usablePhone, job.profileId, true);

        // 7. Ghi SĐT vào sheet nếu có Gmail
        if (job.sheetRow?.Gmail) {
            log(`📋 Cập nhật sheet: Gmail=${job.sheetRow.Gmail}, Phone=${usablePhone}`);
            await updatePhoneInSheet(job.sheetRow.Gmail, usablePhone);
        } else {
            log(`⚠️ Không có Gmail trong sheetRow — bỏ qua ghi sheet`);
        }

        log('✅ Xác minh SĐT thành công!');
        return {
            profileId: job.profileId,
            success: true,
            data: { phone: usablePhone, code: verificationCode, message: 'Phone verified successfully!' }
        };

    } catch (error) {
        return { profileId: job.profileId, success: false, error: error.message };
    }
}

// ============ HELPERS ============

async function getNextPhoneFromQueue(profileId) {
    try {
        const apiUrl = `${API_BASE}/api/phone/queue/next?profileId=${profileId}`;
        const res = await fetch(apiUrl);
        const data = await res.json();
        if (data.error) {
            console.log(`[Queue] Không còn SĐT: ${data.error}`);
            return null;
        }
        return data;
    } catch (err) {
        console.error(`[Queue] Lỗi getNextPhone: ${err.message}`);
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
            return [
                "can't be used for verification",
                "cannot be used for verification",
                "too many unsuccessful attempts",
                "Use another phone number",
            ].some(kw => bodyText.includes(kw));
        });
    } catch { return false; }
}

async function getVerificationCode(phoneNumber, profileId) {
    const apiUrl = `${API_BASE}/api/phone/lookup?number=${encodeURIComponent(phoneNumber)}`;
    const maxRetries = 5;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const res = await fetch(apiUrl);
            if (res.status === 500) {
                console.log(`[Code] API 500, thử lại (${attempt}/${maxRetries})...`);
                await sleep(2000);
                continue;
            }
            const responseText = await res.text();
            let data;
            try { data = JSON.parse(responseText); }
            catch { await sleep(2000); continue; }

            if (data.code) return data.code;

            console.log(`[Code] Chưa có code, thử lại (${attempt}/${maxRetries})...`);
            await sleep(2000);
        } catch (err) {
            console.error(`[Code] Lỗi: ${err.message}`);
            await sleep(2000);
        }
    }
    return null;
}

async function updatePhoneInSheet(gmail, phoneNumber) {
    try {
        const res = await fetch(`${API_BASE}/api/sheet/update-phone`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gmail, phone: phoneNumber }),
        });
        if (res.ok) {
            console.log(`[Sheet] Đã cập nhật SĐT ${phoneNumber} cho ${gmail}`);
        } else {
            console.warn(`[Sheet] Không cập nhật được cho ${gmail}`);
        }
    } catch (err) {
        console.error(`[Sheet] Lỗi: ${err.message}`);
    }
}

module.exports = { name: 'check-phone-verify', run };
