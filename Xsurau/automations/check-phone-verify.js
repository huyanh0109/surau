const { sleep } = require('./helpers');

const API_BASE = `http://localhost:${process.env.API_PORT || 3333}`;

/**
 * Check Phone Verify — dựa trên script gốc TypeScript (Surau).
 *
 * 2 điều chỉnh cho Xsurau (không có trong script gốc vì Surau xử lý ở tầng server):
 *  A. Auto-load queue nếu trống (Surau tự load, Xsurau không)
 *  B. Tìm đúng tab có #phoneNumberId (Surau đảm bảo page đúng, Xsurau không)
 *
 * Core logic giữ nguyên 1-to-1 với script gốc.
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

        // A. Auto-load queue nếu trống (Xsurau cần, Surau không cần)
        await ensureQueueLoaded(log);

        if (signal?.aborted) {
            return { profileId: job.profileId, success: false, error: 'Stopped' };
        }

        // B. Tìm đúng tab có #phoneNumberId (tối đa 30s)
        //    Xsurau có thể trả về tab sai khi browser có nhiều tab mở
        const phoneInputSelector = '#phoneNumberId';
        log(`Tìm tab có ô nhập SĐT (${phoneInputSelector})...`);

        let activePage = page;
        const deadline = Date.now() + 30000;
        let found = false;

        while (Date.now() < deadline) {
            if (signal?.aborted) {
                return { profileId: job.profileId, success: false, error: 'Stopped' };
            }
            // Thử tất cả tab trong context
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
            log(`❌ Không có ô nhập số điện thoại (${phoneInputSelector})`);
            throw new Error(`Không có ô nhập số điện thoại (${phoneInputSelector})`);
        }
        log(`✅ Tìm thấy ô nhập SĐT`);

        // Dùng đúng tab từ đây trở đi
        page = activePage;

        // ============================================================
        // CORE LOGIC — giữ nguyên 1-to-1 với script gốc TypeScript
        // ============================================================

        let usablePhone = null;
        const maxAttempts = 70;
        let attempt = 0;

        while (attempt < maxAttempts && !usablePhone) {
            // Check abort signal (giống gốc: check đầu mỗi iteration)
            if (signal?.aborted) {
                log(`⏹️ Dừng lại theo signal tại lần thử ${attempt}`);
                return { profileId: job.profileId, success: false, error: 'Stopped' };
            }

            attempt++;
            log(`=== Lần thử ${attempt}/${maxAttempts} ===`);

            // Đầu mỗi vòng: kiểm tra #phoneNumberId còn visible không
            // (trang có thể đã điều hướng sang trang nhập code sau lần thử trước)
            const inputStillVisible = await page.locator(phoneInputSelector).isVisible({ timeout: 2000 }).catch(() => false);
            if (!inputStillVisible) {
                // Tìm lại qua tất cả tab trong context (timeout 5s)
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
                log(`✅ Tìm lại được ô nhập SĐT trên tab: ${page.url()}`);
            }

            // Lấy số tiếp theo từ queue
            const phoneData = await getNextPhoneFromQueue(job.profileId);

            if (!phoneData || !phoneData.phoneNumber || phoneData.phoneNumber.trim() === '') {
                log(`⚠️ Không còn SĐT trong queue. Dừng lại.`);
                break;
            }

            const phone = phoneData.phoneNumber;
            log(`Checking: ${phone}`);

            // Xóa input cũ & nhập SĐT mới (dùng locator để không bị treo)
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

            // Kiểm tra lỗi sau click 1
            const isInvalid = await checkIfPhoneInvalid(page);
            if (isInvalid) {
                log(`✗ ${phone} (Invalid sau click 1)`);
                await markPhoneInQueue(phone, job.profileId, false);
                continue;
            }

            // Bước tiếp: click Next lần 2 + đọc SĐT thực từ trang
            try {
                const nextBtn2 = await page.waitForSelector('button[type="button"]', { state: 'visible', timeout: 10000 });
                if (nextBtn2) await nextBtn2.click();

                await sleep(2000);

                if (signal?.aborted) {
                    return { profileId: job.profileId, success: false, error: 'Stopped' };
                }

                // Kiểm tra lỗi sau click 2
                const hasErrorAfterClick2 = await checkIfPhoneInvalid(page);
                if (hasErrorAfterClick2) {
                    log(`✗ ${phone} (Invalid sau click 2)`);
                    await markPhoneInQueue(phone, job.profileId, false);
                    usablePhone = null;
                    continue;
                }

                // Đọc SĐT thực tế Google gửi code đến (format: (XXX) XXX-XXXX)
                let actualPhone = await page.evaluate(() => {
                    const bodyText = document.body.innerText || '';
                    const match = bodyText.match(/\((\d{3})\)\s*(\d{3})-(\d{4})/);
                    return match ? match[1] + match[2] + match[3] : null;
                });

                if (!actualPhone) {
                    actualPhone = await page.evaluate((p) => {
                        const bodyText = document.body.innerText || '';
                        const cleanText = bodyText.replace(/[\s\-\(\)\+]/g, '');
                        if (cleanText.includes(p)) return p;
                        return null;
                    }, phone);
                }

                if (!actualPhone) {
                    log(`⚠️ Không đọc được SĐT từ trang. Sử dụng SĐT đã nhập: ${phone}`);
                    actualPhone = phone;
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

        if (!usablePhone) {
            throw new Error(`Không tìm được SĐT hợp lệ sau ${attempt} lần thử`);
        }

        if (signal?.aborted) {
            return { profileId: job.profileId, success: false, error: 'Stopped' };
        }

        // Lấy verification code
        log(`Lấy code cho ${usablePhone}...`);
        const verificationCode = await getVerificationCode(usablePhone, job.profileId);
        if (!verificationCode) throw new Error('Không lấy được verification code');
        log(`Code: ${verificationCode}`);

        // Điền code
        await page.waitForSelector('[aria-label="Enter code"], [aria-label="Enter the code"]', { state: 'visible', timeout: 30000 });
        let inputSel = '[aria-label="Enter code"]';
        const altInputs = await page.$$('[aria-label="Enter the code"]');
        if (altInputs.length > 0) inputSel = '[aria-label="Enter the code"]';
        await page.locator(inputSel).type(verificationCode, { delay: 20 });
        await sleep(1000);

        if (signal?.aborted) {
            return { profileId: job.profileId, success: false, error: 'Stopped' };
        }

        // Submit — XPath và các cách fallback giống script gốc
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

        // Mark valid
        await markPhoneInQueue(usablePhone, job.profileId, true);

        // Ghi sheet nếu có Gmail
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

// ============================================================
// HELPERS
// ============================================================

/**
 * Auto-load queue nếu trống.
 * Xsurau cần vì không có server tự quản lý queue như Surau.
 */
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
            body: JSON.stringify({ days: 5, limit: 70 }),
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
            const text = await res.text();
            let data;
            try { data = JSON.parse(text); } catch { await sleep(2000); continue; }
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
        await fetch(`${API_BASE}/api/sheet/update-phone`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gmail, phone: phoneNumber }),
        });
    } catch { }
}

module.exports = { name: 'check-phone-verify', run };
