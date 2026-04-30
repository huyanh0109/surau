const { sleep, generate2FACode, isEmail, clickNextButton } = require('./helpers');

/** Login Google đơn giản (không retry, không captcha) */
async function run(page, job, signal, logger) {
    const log = (msg) => { logger?.(msg); console.log(`[P${job.profileId}] ${msg}`); };
    try {
        const { sheetRow } = job;
        if (!sheetRow?.Gmail || !sheetRow?.PassWord) return { profileId: job.profileId, success: false, error: 'Thiếu Gmail hoặc Password' };

        if (signal?.aborted) return { profileId: job.profileId, success: false, error: 'Stopped' };
        await page.goto('https://accounts.google.com/v3/signin/identifier?authuser=0&continue=https%3A%2F%2Fone.google.com%2F&hl=en_GB&flowName=GlifWebSignIn&flowEntry=AddSession', { waitUntil: 'domcontentloaded' });

        await page.waitForSelector('input[type="email"]', { timeout: 30000 });
        await page.locator('input[type="email"]').type(sheetRow.Gmail, { delay: 10 });
        await page.locator('#identifierNext').click();

        if (signal?.aborted) return { profileId: job.profileId, success: false, error: 'Stopped' };
        await page.waitForSelector('input[type="password"]', { state: 'visible', timeout: 300000 });
        await sleep(2000);
        await page.locator('input[type="password"]').type(sheetRow.PassWord, { delay: 10 });
        await sleep(500);
        await page.locator('#passwordNext').click({ clickCount: 2, delay: 100 });
        await sleep(2000);

        // Bỏ qua popup save password
        try {
            await page.evaluate(() => {
                const btn = Array.from(document.querySelectorAll('button')).find(b =>
                    b.textContent?.includes('Never') || b.textContent?.includes('No thanks') ||
                    b.textContent?.includes('Không bao giờ') || b.textContent?.includes('Không, cảm ơn')
                );
                if (btn) btn.click();
            });
        } catch { }

        if (signal?.aborted) return { profileId: job.profileId, success: false, error: 'Stopped' };

        // 2FA / Recovery
        try {
            if (isEmail(sheetRow.Recover)) {
                await page.waitForSelector('[data-challengetype="12"]', { state: 'visible', timeout: 10000 });
                await page.locator('[data-challengetype="12"]').click();
                await sleep(3000);
                await page.waitForSelector('[name="knowledgePreregisteredEmailResponse"]', { state: 'visible', timeout: 10000 });
                await page.locator('[name="knowledgePreregisteredEmailResponse"]').type(sheetRow.Recover, { delay: 10 });
                await sleep(500);
                await clickNextButton(page);
            } else {
                try {
                    await page.waitForSelector('[data-challengeid="3"]', { state: 'visible', timeout: 5000 });
                    await page.locator('[data-challengeid="3"]').click();
                    await sleep(2000);
                } catch { }
                await page.waitForSelector('[type="tel"]', { state: 'visible', timeout: 10000 });
                const code = generate2FACode(sheetRow.Recover);
                await page.locator('[type="tel"]').type(code, { delay: 10 });
                await sleep(500);
                await clickNextButton(page);
            }
        } catch { }

        try { await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 60000 }); } catch { }
        log('✅ Đăng nhập xong!');
        return { profileId: job.profileId, success: true, data: { gmail: sheetRow.Gmail, message: 'Done!' } };
    } catch (error) {
        return { profileId: job.profileId, success: false, error: error.message };
    }
}

module.exports = { name: 'login-google', run };
