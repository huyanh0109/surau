/**
 * AUTOMATION ENGINE BASE
 * Tất cả automation đều phải implement interface này
 * Page là Playwright Page object (patchright) — không cần puppeteer nữa
 */

/**
 * Thông tin một job automation
 */
class AutomationJob {
    constructor(data) {
        this.profileId = data.profileId;
        this.sheetRow = data.sheetRow || {};
        this.blockImages = data.blockImages || false;
        this.startUrl = data.startUrl || null;
        this.extra = data.extra || {};
    }
}

/**
 * Kết quả sau khi chạy automation
 */
class AutomationResult {
    constructor({ profileId, success, error, data }) {
        this.profileId = profileId;
        this.success = success;
        this.error = error || null;
        this.data = data || null;
    }
}

module.exports = { AutomationJob, AutomationResult };
