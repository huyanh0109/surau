/** Test đơn giản: mở Google và gõ thử */
async function run(page, job, signal, logger) {
    const log = (msg) => { logger?.(msg); console.log(`[test-simple][${job.profileId}] ${msg}`); };
    try {
        log('🌐 Đang mở google.com...');
        await page.goto('https://www.google.com', { waitUntil: 'domcontentloaded', timeout: 30000 });

        log('⌨️  Đang nhập từ khóa...');
        await page.waitForSelector('textarea[name="q"], input[name="q"]', { timeout: 10000 });
        await page.locator('textarea[name="q"], input[name="q"]').first().type('xsurau test ok', { delay: 80 });

        await page.waitForTimeout(1500);
        log('✅ Test thành công!');
        return { profileId: job.profileId, success: true, data: { message: 'Test OK' } };
    } catch (err) {
        log(`❌ Lỗi: ${err.message}`);
        return { profileId: job.profileId, success: false, error: err.message };
    }
}

module.exports = { name: 'test-simple', run };
