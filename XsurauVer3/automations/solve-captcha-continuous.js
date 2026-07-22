const { sleep, waitForCapMonsterExtension, resetCaptchaWidget } = require('./helpers');

/** Vòng lặp liên tục quét và giải captcha khi trang đang ở Google login */
async function run(page, job, signal, logger) {
    const log = (msg) => { logger?.(msg); console.log(`[P${job.profileId}] ${msg}`); };
    let solvedCount = 0;
    try {
        log('Bắt đầu vòng lặp quét Captcha (Extension mode)...');
        while (true) {
            if (signal?.aborted) break;
            try {
                const currentUrl = page.url();
                if (!currentUrl.includes('accounts.google.com') && !currentUrl.includes('recaptcha')) {
                    await sleep(5000); continue;
                }
                await sleep(3000);
                const stillExists = await page.$('.g-recaptcha, iframe[src*="recaptcha"]');
                if (!stillExists) { await sleep(3000); continue; }

                const hasError = await page.evaluate(() => {
                    const errDiv = document.querySelector('.L0Zxb, .o6cuMc, [aria-live="assertive"]');
                    return errDiv ? errDiv.textContent?.includes('verify') || errDiv.textContent?.includes('wrong') : false;
                });
                if (hasError) { log('Có lỗi, reset widget...'); await resetCaptchaWidget(page); await sleep(3000); }

                const solved = await waitForCapMonsterExtension(page, job.profileId, signal, log);
                if (solved) {
                    solvedCount++;
                    log(`Extension đã giải xong! Đang bấm Next...`);
                    await sleep(2000);
                    await page.evaluate(() => {
                        const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
                        for (const btn of buttons) {
                            const text = btn.textContent?.trim().toLowerCase() || '';
                            if (text === 'next' || text === 'tiếp theo' || text === 'continue') { btn.click(); return; }
                        }
                    });
                } else if (!signal?.aborted) {
                    log('Timeout 120s. Reset widget...');
                    await resetCaptchaWidget(page);
                }
                await sleep(7000);
            } catch (err) {
                const msg = err?.message || '';
                log(`Error: ${msg}`);
                if (msg.includes('Target closed') || msg.includes('detached') || msg.includes('Session closed')) {
                    log('Trình duyệt đã đóng. Dừng vòng lặp.'); break;
                }
                await sleep(3000);
            }
        }
        return { profileId: job.profileId, success: true, data: { message: `Đã giải ${solvedCount} captcha.` } };
    } catch (error) {
        return { profileId: job.profileId, success: false, error: error.message };
    }
}

module.exports = { name: 'solve-captcha-continuous', run };
