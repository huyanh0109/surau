const { sleep } = require('./helpers');

const API_BASE = `http://localhost:${process.env.API_PORT || 3333}`;

/**
 * Selector cho ô nhập SĐT — hỗ trợ cả 2 trang Google:
 *   - Trang tạo tài khoản / signup:          #phoneNumberId
 *   - Trang "Verify that it's you" challenge: input[type="tel"]
 */
const PHONE_INPUT_SELECTORS = [
    '#phoneNumberId',
    'input[type="tel"]',
    'input[name="phoneNumber"]',
];

/**
 * Tìm ô nhập SĐT hiện đang visible trên trang, trả về { locator, selector } hoặc null.
 */
async function findPhoneInput(page) {
    for (const sel of PHONE_INPUT_SELECTORS) {
        try {
            const el = page.locator(sel).first();
            if (await el.isVisible({ timeout: 500 })) return { locator: el, selector: sel };
        } catch { }
    }
    return null;
}

/**
 * Tìm đúng tab trong context có trang nhập SĐT của Google.
 * Manager có thể trả về tab sai (tab cuối) khi profile có nhiều tab mở.
 * Trả về { page, phoneInputInfo } hoặc null nếu không tìm thấy.
 */
async function findCorrectPageInContext(page) {
    try {
        const context = page.context();
        const allPages = context.pages();
        // Ưu tiên tìm tab có accounts.google.com với input SĐT
        for (const p of allPages) {
            try {
                const url = p.url();
                if (!url.includes('accounts.google.com')) continue;
                const info = await findPhoneInput(p);
                if (info) return { page: p, phoneInputInfo: info };
            } catch { }
        }
        // Nếu không tìm thấy theo URL, thử tất cả tab
        for (const p of allPages) {
            try {
                const info = await findPhoneInput(p);
                if (info) return { page: p, phoneInputInfo: info };
            } catch { }
        }
    } catch { }
    return null;
}

/**
 * Lấy số điện thoại từ queue, check từng số với Google, trả về số hợp lệ + xác minh.
 * Hỗ trợ cả trang signup (#phoneNumberId) và trang challenge (Verify that it's you).
 */
async function run(page, job, signal, logger) {
    const log = (msg) => { logger?.(msg); console.log(`[P${job.profileId}] ${msg}`); };

    try {
        if (signal?.aborted) return { profileId: job.profileId, success: false, error: 'Stopped' };

        // 0. Auto-load queue nếu chưa có SĐT
        await ensureQueueLoaded(log);

        // 1. Tìm đúng tab đang ở trang nhập SĐT (tối đa 30s)
        //    Manager.launchProfile có thể trả về tab sai nếu browser có nhiều tab.
        log(`Đang tìm tab có trang nhập SĐT (URL tab hiện tại: ${page.url()})...`);
        let activePage = page;
        let phoneInputInfo = null;
        const deadline = Date.now() + 30000;
        while (Date.now() < deadline) {
            const found = await findCorrectPageInContext(activePage);
            if (found) {
                activePage = found.page;
                phoneInputInfo = found.phoneInputInfo;
                if (activePage !== page) {
                    log(`⚠️  Tab ban đầu sai! Chuyển sang tab đúng: ${activePage.url()}`);
                    try { await activePage.bringToFront(); } catch { }
                }
                break;
            }
            await sleep(500);
        }
        // Gán lại page để phần còn lại của script dùng đúng tab
        page = activePage;
        if (!phoneInputInfo) {
            throw new Error('Không tìm thấy ô nhập SĐT sau 30 giây trên bất kỳ tab nào');
        }
        log(`Tìm thấy ô nhập SĐT: ${phoneInputInfo.selector} | Tab: ${page.url()}`);

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
            if (!phoneData?.phoneNumber?.trim()) {
                log('Không còn SĐT trong queue. Thử load thêm...');
                // Thử load lại queue một lần nữa khi hết
                const reloaded = await loadQueue();
                if (!reloaded || reloaded.total === 0) {
                    log('Queue vẫn trống sau khi reload. Dừng lại.');
                    break;
                }
                log(`Reload thành công: ${reloaded.total} SĐT. Thử lấy lại...`);
                continue;
            }

            const phone = phoneData.phoneNumber;
            log(`Checking: ${phone}`);

            // Nhập SĐT vào ô hiện tại
            await phoneInputInfo.locator.click({ clickCount: 3 });
            await page.keyboard.press('Control+A');
            await page.keyboard.press('Backspace');
            await phoneInputInfo.locator.type(phone, { delay: 10 });
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
                // Chờ ô nhập SĐT quay lại (trang có thể reload hoặc chuyển trạng thái)
                phoneInputInfo = null;
                const d2 = Date.now() + 5000;
                while (Date.now() < d2) {
                    phoneInputInfo = await findPhoneInput(page);
                    if (phoneInputInfo) break;
                    await sleep(300);
                }
                if (!phoneInputInfo) { log('Mất ô nhập SĐT, dừng vòng lặp.'); break; }
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
                phoneInputInfo = null;
                const d3 = Date.now() + 5000;
                while (Date.now() < d3) {
                    phoneInputInfo = await findPhoneInput(page);
                    if (phoneInputInfo) break;
                    await sleep(300);
                }
                if (!phoneInputInfo) { log('Mất ô nhập SĐT, dừng vòng lặp.'); break; }
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

        // Lấy Gmail: ưu tiên từ sheetRow, fallback từ profile data
        let gmail = job.sheetRow?.Gmail || null;
        if (!gmail) {
            try {
                const profileRes = await fetch(`${API_BASE}/api/profiles/${job.profileId}`);
                const profileData = await profileRes.json();
                gmail = profileData?.gmail || profileData?.email || null;
            } catch { }
        }

        if (gmail) {
            const updateOk = await updatePhoneInSheet(gmail, usablePhone);
            log(updateOk ? `📋 Đã ghi SĐT "${usablePhone}" vào sheet cho Gmail "${gmail}"` : `⚠️ Không tìm thấy Gmail "${gmail}" trong sheet`);
        } else {
            log(`⚠️ Không có Gmail để ghi SĐT vào sheet. Hãy sync sheet trước khi chạy.`);
        }

        log('✅ Xác minh SĐT thành công!');
        return { profileId: job.profileId, success: true, data: { phone: usablePhone, code: verificationCode, gmail } };
    } catch (error) {
        return { profileId: job.profileId, success: false, error: error.message };
    }
}

// ============ HELPERS ============

/**
 * Kiểm tra queue có SĐT không, nếu không thì tự load.
 * Dùng biến module-level để tránh nhiều profile cùng load cùng lúc.
 */
let _queueLoadPromise = null;

async function ensureQueueLoaded(log) {
    try {
        const res = await fetch(`${API_BASE}/api/phone/queue/status`);
        const status = await res.json();
        if (status.total > 0) {
            log(`Queue đã có sẵn ${status.total} SĐT (available: ${status.available})`);
            return;
        }
    } catch { }

    // Queue trống — load (dùng Promise chung để tránh race condition giữa các profile)
    if (!_queueLoadPromise) {
        log('Queue trống, đang load SĐT từ sheet...');
        _queueLoadPromise = loadQueue().finally(() => { _queueLoadPromise = null; });
    } else {
        log('Đang chờ profile khác load queue xong...');
    }

    const result = await _queueLoadPromise;
    if (result) log(`Load queue xong: ${result.total} SĐT`);
}

async function loadQueue() {
    try {
        const res = await fetch(`${API_BASE}/api/phone/queue/load`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ days: 5, limit: 70 }),
        });
        return await res.json();
    } catch { return null; }
}

async function getNextPhoneFromQueue(profileId) {
    try {
        const res = await fetch(`${API_BASE}/api/phone/queue/next?profileId=${profileId}`);
        const data = await res.json();
        if (data.error) return null;
        return data;
    } catch { return null; }
}

async function markPhoneInQueue(phoneNumber, profileId, isValid) {
    try {
        await fetch(`${API_BASE}/api/phone/queue/mark`, {
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
    const apiUrl = `${API_BASE}/api/phone/lookup?number=${encodeURIComponent(phoneNumber)}`;
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
        const res = await fetch(`${API_BASE}/api/sheet/update-phone`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gmail, phone: phoneNumber }),
        });
        const data = await res.json();
        return data.success === true;
    } catch { return false; }
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
