const { sleep } = require('./helpers');

const API_BASE = `http://127.0.0.1:${process.env.API_PORT || 3334}`;

// Helper function to click buttons robustly by filtering out back buttons, email/language selectors, etc.
async function clickAppealButton(page, allowedTexts) {
    const clicked = await page.evaluate((texts) => {
        const buttons = Array.from(document.querySelectorAll('button'));
        for (const btn of buttons) {
            const style = window.getComputedStyle(btn);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
                continue;
            }
            if (btn.disabled) {
                continue;
            }
            const txt = (btn.textContent || '').trim().toLowerCase();
            // Skip email selection button and language selection buttons
            if (txt.includes('@') || txt.includes('english') || txt.includes('tiếng việt') || txt.includes('help') || txt.includes('trợ giúp')) {
                continue;
            }
            // Skip back buttons
            if (txt === 'back' || txt === 'quay lại' || txt.includes('back') || txt.includes('quay lại')) {
                continue;
            }
            for (const target of texts) {
                if (txt === target.toLowerCase() || txt.includes(target.toLowerCase())) {
                    btn.click();
                    return true;
                }
            }
        }
        return false;
    }, allowedTexts);

    if (clicked) return true;

    // Playwright locator fallback
    for (const text of allowedTexts) {
        try {
            const locator = page.locator(`button:has-text("${text}")`).first();
            if (await locator.isVisible({ timeout: 1000 })) {
                await locator.click();
                return true;
            }
        } catch (e) {
            // ignore
        }
    }
    return false;
}

/** Appeal (khiếu nại) tài khoản Google bị disable */
async function run(page, job, signal, logger) {
    const log = (msg) => { logger?.(msg); console.log(`[P${job.profileId}] ${msg}`); };

    const getRandomElement = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const generateAppealText = () => {
        const a = getRandomElement(['Dear Gmail Support Team!','Dear Google Support Team!','Dear Google Support!','Dear Google!','Dear Support Team!','Dear Admin!']);
        const b = getRandomElement(['I logged in and used the account normally, fully complying with all of Google\'s policies.','I have been accessing and using my account regularly without violating any of Google\'s regulations.','I was using the account as usual and did not breach any of Google\'s rules.']);
        const c = getRandomElement(['I use the account to upload and store data for my work.','I utilize the account for uploading and storing data necessary for my job.','I use the account for uploading and saving data related to my work tasks.']);
        const d = getRandomElement(['I hope Google will review the issue of my account being locked and unlock it for me.','I trust that Google will reconsider the situation with my locked account and help me regain access.','I kindly ask Google to re-evaluate my account\'s locked status and assist in unlocking it.']);
        const f = getRandomElement(['I always comply with Google\'s rules and policies. I do not use third-party software or anything that would violate these regulations.','I adhere strictly to Google\'s guidelines and policies. I never use third-party software or engage in activities that breach these rules.']);
        const e = getRandomElement(['Thank you for your time and consideration!','Thanks!','Thank You!','Thank you for your support!']);
        return `${a} ${b} ${c} ${d} ${f} ${e}`;
    };
    const generateRandomEmail = () => {
        const names = ['john','jane','mike','sarah','david','emily','robert','lisa','james','maria'];
        const surnames = ['smith','johnson','brown','williams','jones','davis','miller','wilson','moore','taylor'];
        const domains = ['gmail.com','yahoo.com','outlook.com','hotmail.com'];
        const randomNum = Math.floor(Math.random() * 9999);
        return `${getRandomElement(names)}.${getRandomElement(surnames)}${randomNum}@${getRandomElement(domains)}`;
    };

    try {
        if (signal?.aborted) return { profileId: job.profileId, success: false, error: 'Stopped' };
        
        let appealText = '';
        let contactEmail = '';
        let pageContent = await page.content();
        const hasText = (t) => pageContent.toLowerCase().includes(t.toLowerCase());
        
        // Nhận diện các trang/bước của Google Appeal
        const isRequestReviewPage = hasText('Request a review') || hasText('review of your account') || hasText('Step 1 of 3') || hasText('Step 1/') || hasText('Bước 1/') || hasText('Yêu cầu xem xét') || hasText('xem xét tài khoản');
        const isOnStep2 = hasText('Step 2 of 3') || hasText('Step 2/') || hasText('Bước 2/') || hasText('Enter appeal reason') || hasText('Nhập lý do khiếu nại') || (await page.$('textarea')) !== null;
        const isOnStep3 = hasText('Step 3 of 3') || hasText('Step 3/') || hasText('Bước 3/') || hasText('contactEmailAddress') || (await page.$('[name="contactEmailAddress"]')) !== null;
        const isInitialDisabledPage = hasText('Your account has been disabled') || hasText('account was disabled') || hasText('Start appeal') || hasText('Bắt đầu khiếu nại') || hasText('tài khoản đã bị vô hiệu') || hasText('tài khoản bị vô hiệu') || hasText('vô hiệu hóa');

        const isAppealPage = isInitialDisabledPage || isRequestReviewPage || isOnStep2 || isOnStep3;
        if (!isAppealPage) return { profileId: job.profileId, success: false, error: 'Không phải trang appeal' };

        // --- BƯỚC 1: NHẤN "START APPEAL" ---
        // Chỉ nhấn nếu chưa ở bất cứ trang Request a Review nào (Step 1, Step 2, Step 3)
        if (!isRequestReviewPage && !isOnStep2 && !isOnStep3) {
            log('Đang ở trang thông báo bị vô hiệu hóa. Tìm nút Start Appeal...');
            const startBtn = await page.$('button[jsaction*="click:cOuCgd"][jsaction*="mousedown:UX7yZ"]');
            let clickedStart = false;
            if (startBtn) {
                await startBtn.click();
                clickedStart = true;
            } else {
                clickedStart = await clickAppealButton(page, ['Start appeal', 'Bắt đầu khiếu nại', 'Bắt đầu']);
            }

            if (!clickedStart) {
                // Kiểm tra xem trang có tự chuyển sang review page không
                await sleep(2000);
                pageContent = await page.content();
                const nowOnReview = hasText('Request a review') || hasText('Step 1 of 3') || hasText('Bước 1/') || hasText('Yêu cầu xem xét');
                if (!nowOnReview) {
                    return { profileId: job.profileId, success: false, error: 'Không tìm thấy nút Start appeal' };
                }
            } else {
                await sleep(2000);
            }
        }

        // --- BƯỚC 2: CLICK NEXT Ở BƯỚC 1 (Request a Review) ---
        pageContent = await page.content();
        const currentlyOnStep1 = hasText('Request a review') || hasText('Step 1 of 3') || hasText('Bước 1/') || hasText('Yêu cầu xem xét') || hasText('xem xét tài khoản');
        const currentlyOnStep2 = hasText('Step 2 of 3') || hasText('Step 2/') || hasText('Bước 2/') || hasText('Enter appeal reason') || hasText('Nhập lý do khiếu nại') || (await page.$('textarea')) !== null;
        const currentlyOnStep3 = hasText('Step 3 of 3') || hasText('Step 3/') || hasText('Bước 3/') || hasText('contactEmailAddress') || (await page.$('[name="contactEmailAddress"]')) !== null;

        if (currentlyOnStep1 && !currentlyOnStep2 && !currentlyOnStep3) {
            log('Đang ở trang Request a review (Bước 1). Nhấn Next...');
            const clickedNext1 = await clickAppealButton(page, ['Next', 'Tiếp theo', 'Tiếp tục', 'Continue']);
            if (!clickedNext1) return { profileId: job.profileId, success: false, error: 'Không tìm thấy nút Next ở Bước 1' };
            await sleep(2000);
        }

        // --- BƯỚC 3: NHẬP LÝ DO APPEAL Ở BƯỚC 2 ---
        pageContent = await page.content();
        const nowOnStep2 = hasText('Step 2 of 3') || hasText('Step 2/') || hasText('Bước 2/') || hasText('Enter appeal reason') || hasText('Nhập lý do khiếu nại') || (await page.$('textarea')) !== null;
        const nowOnStep3 = hasText('Step 3 of 3') || hasText('Step 3/') || hasText('Bước 3/') || hasText('contactEmailAddress') || (await page.$('[name="contactEmailAddress"]')) !== null;

        if (nowOnStep2 && !nowOnStep3) {
            log('Đang ở trang nhập lý do khiếu nại (Bước 2)...');
            let textarea = await page.$('[aria-label="Enter appeal reason"]');
            if (!textarea) {
                textarea = await page.$('textarea');
            }
            if (!textarea) return { profileId: job.profileId, success: false, error: 'Không tìm thấy ô nhập lý do' };

            appealText = generateAppealText();
            await textarea.click();
            await textarea.type(appealText, { delay: 3 });
            await sleep(1000);

            log('Nhấn Next ở Bước 2...');
            const clickedNext2 = await clickAppealButton(page, ['Next', 'Tiếp theo', 'Tiếp tục', 'Continue']);
            if (!clickedNext2) return { profileId: job.profileId, success: false, error: 'Không tìm thấy nút Next ở Bước 2' };
            await sleep(2000);
        }

        // --- BƯỚC 4: NHẬP CONTACT EMAIL VÀ SUBMIT Ở BƯỚC 3 ---
        pageContent = await page.content();
        const nowOnStep3Final = hasText('Step 3 of 3') || hasText('Step 3/') || hasText('Bước 3/') || hasText('contactEmailAddress') || (await page.$('[name="contactEmailAddress"]')) !== null;

        if (nowOnStep3Final) {
            log('Đang ở trang cung cấp email liên hệ (Bước 3)...');
            let emailInput = await page.$('[name="contactEmailAddress"]');
            if (!emailInput) {
                emailInput = await page.$('input[type="email"]');
            }
            if (!emailInput) return { profileId: job.profileId, success: false, error: 'Không tìm thấy ô email liên hệ' };

            contactEmail = generateRandomEmail();
            await emailInput.click();
            await emailInput.type(contactEmail, { delay: 10 });
            await sleep(1000);

            log('Nhấn nút gửi (Submit)...');
            const clickedSubmit = await clickAppealButton(page, ['Submit', 'Gửi', 'Hoàn tất', 'Done']);
            if (!clickedSubmit) return { profileId: job.profileId, success: false, error: 'Không tìm thấy nút Submit' };
            await sleep(5000);
        }

        // Kiểm tra thành công
        try {
            await page.waitForFunction(() => {
                const text = document.body.innerText || '';
                return text.includes('Your appeal was submitted') || 
                       text.includes('appeal was submitted') || 
                       text.includes('khiếu nại của bạn đã được gửi') || 
                       text.includes('đã được gửi');
            }, { timeout: 10000 });
        } catch {
            const html = await page.content();
            const lowerHtml = html.toLowerCase();
            const success = lowerHtml.includes('appeal was submitted') || 
                            lowerHtml.includes('khiếu nại của bạn đã được gửi') || 
                            lowerHtml.includes('đã được gửi');
            if (!success) return { profileId: job.profileId, success: false, error: 'Không thấy trang xác nhận appeal' };
        }

        // Cập nhật Google Sheet nếu có Gmail
        const gmail = job.sheetRow?.Gmail;
        let sheetUpdateResult = null;
        if (gmail) {
            try {
                const now = new Date();
                const gmt7 = new Date(now.getTime() + 7 * 3600000);
                const currentDate = `${gmt7.getUTCDate()}/${gmt7.getUTCMonth() + 1}/${String(gmt7.getUTCFullYear()).slice(-2)}`;
                const customNote = job.outputValues?.Note || job.sheetRow?._outputValues?.Note || 'appealing';
                const resp = await fetch(`${API_BASE}/api/sheet/update-note-and-appeal`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ gmail, note: customNote, dateAppeal: currentDate, automationName: 'appeal-google' }),
                });
                sheetUpdateResult = await resp.json();
                log(sheetUpdateResult?.success ? `📋 Sheet đã cập nhật: Gmail "${gmail}" → note=${customNote}, date=${currentDate}` : `⚠️ Sheet không tìm thấy Gmail "${gmail}"`);
            } catch (e) {
                sheetUpdateResult = { success: false, error: e.message };
                log(`❌ Lỗi ghi sheet: ${e.message}`);
            }
        } else {
            log('⚠️ Không có Gmail trong sheetRow (hãy sync sheet trước khi chạy để ghi kết quả appeal).');
        }

        log('✅ Appeal đã gửi thành công!');
        return { profileId: job.profileId, success: true, data: { message: 'Appeal submitted!', appealText, contactEmail, sheetUpdateResult } };
    } catch (error) {
        return { profileId: job.profileId, success: false, error: error.message };
    }
}

module.exports = { name: 'appeal-google', run };
