const { sleep } = require('./helpers');

/** Logout khỏi Google */
async function run(page, job, signal, logger) {
    const log = (msg) => { logger?.(msg); console.log(`[P${job.profileId}] ${msg}`); };
    try {
        if (signal?.aborted) return { profileId: job.profileId, success: false, error: 'Stopped' };
        await page.goto('https://accounts.google.com/SignOutOptions?hl=vi&continue=https://one.google.com/settings', { waitUntil: 'domcontentloaded' });
        await sleep(2000);
        try {
            await page.waitForSelector('[name="signout"]', { state: 'visible', timeout: 10000 });
            await page.locator('[name="signout"]').click();
        } catch {
            return { profileId: job.profileId, success: false, error: 'Nút Signout không tìm thấy — có thể đã logout rồi' };
        }
        await sleep(2000);
        log('✅ Đã logout thành công!');
        return { profileId: job.profileId, success: true, data: { message: 'Logged out successfully!' } };
    } catch (error) {
        return { profileId: job.profileId, success: false, error: error.message };
    }
}

module.exports = { name: 'logout-google', run };
