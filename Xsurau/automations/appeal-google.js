const { sleep } = require('./helpers');

const API_BASE = `http://localhost:${process.env.API_PORT || 3333}`;

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
        const pageContent = await page.content();
        const isAppealPage = pageContent.includes('Your account has been disabled') || pageContent.includes('account was disabled') || pageContent.includes('Start appeal');
        if (!isAppealPage) return { profileId: job.profileId, success: false, error: 'Không phải trang appeal' };

        // Click Start Appeal
        const startBtn = await page.$('button[jsaction*="click:cOuCgd"][jsaction*="mousedown:UX7yZ"]');
        if (!startBtn) return { profileId: job.profileId, success: false, error: 'Không tìm thấy nút Start appeal' };
        await startBtn.click();
        await sleep(2000);

        // Click Next
        const nextBtn1 = await page.$('[type="button"]');
        if (!nextBtn1) return { profileId: job.profileId, success: false, error: 'Không tìm thấy nút Next' };
        await nextBtn1.click();
        await sleep(2000);

        // Nhập lý do appeal
        const textarea = await page.$('[aria-label="Enter appeal reason"]');
        if (!textarea) return { profileId: job.profileId, success: false, error: 'Không tìm thấy ô nhập lý do' };
        const appealText = generateAppealText();
        await textarea.click();
        await textarea.type(appealText, { delay: 3 });
        await sleep(1000);

        // Click Next lần 2
        const nextBtn2 = await page.$('[type="button"]');
        if (!nextBtn2) return { profileId: job.profileId, success: false, error: 'Không tìm thấy nút Next lần 2' };
        await nextBtn2.click();
        await sleep(2000);

        // Nhập contact email
        const emailInput = await page.$('[name="contactEmailAddress"]');
        if (!emailInput) return { profileId: job.profileId, success: false, error: 'Không tìm thấy ô email liên hệ' };
        const contactEmail = generateRandomEmail();
        await emailInput.click();
        await emailInput.type(contactEmail, { delay: 10 });
        await sleep(1000);

        // Submit
        const submitBtn = await page.$('button[jsaction*="click:cOuCgd"]');
        if (!submitBtn) return { profileId: job.profileId, success: false, error: 'Không tìm thấy nút Submit' };
        await submitBtn.click();
        await sleep(5000);

        // Kiểm tra thành công
        try {
            await page.waitForFunction(() => {
                return document.body.innerText.includes('Your appeal was submitted') || document.body.innerText.includes('appeal was submitted');
            }, { timeout: 10000 });
        } catch {
            const html = await page.content();
            if (!html.includes('appeal was submitted')) return { profileId: job.profileId, success: false, error: 'Không thấy trang xác nhận appeal' };
        }

        // Cập nhật Google Sheet nếu có Gmail
        const gmail = job.sheetRow?.Gmail;
        let sheetUpdateResult = null;
        if (gmail) {
            try {
                const now = new Date();
                const gmt7 = new Date(now.getTime() + 7 * 3600000);
                const currentDate = `${gmt7.getUTCDate()}/${gmt7.getUTCMonth() + 1}/${String(gmt7.getUTCFullYear()).slice(-2)}`;
                const resp = await fetch(`${API_BASE}/api/sheet/update-note-and-appeal`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ gmail, note: 'appealing', dateAppeal: currentDate }),
                });
                sheetUpdateResult = await resp.json();
                log(sheetUpdateResult?.success ? `📋 Sheet đã cập nhật: Gmail "${gmail}" → note=appealing, date=${currentDate}` : `⚠️ Sheet không tìm thấy Gmail "${gmail}"`);
            } catch (e) {
                sheetUpdateResult = { success: false, error: e.message };
                log(`❌ Lỗi ghi sheet: ${e.message}`);
            }
        } else {
            log('⚠️ Không có Gmail trong sheetRow. Hãy sync sheet trước khi chạy để ghi kết quả appeal.');
        }

        log('✅ Appeal đã gửi thành công!');
        return { profileId: job.profileId, success: true, data: { message: 'Appeal submitted!', appealText, contactEmail, sheetUpdateResult } };
    } catch (error) {
        return { profileId: job.profileId, success: false, error: error.message };
    }
}

module.exports = { name: 'appeal-google', run };
