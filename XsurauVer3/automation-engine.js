/**
 * XSURAU AUTOMATION ENGINE
 *
 * Chạy automation trực tiếp trong cùng process với Manager.
 * Dùng thẳng page object của patchright — không cần debug port, không có network overhead.
 * Hỗ trợ concurrency (nhiều profile cùng lúc) và abort signal.
 */

const path = require('path');
const { EventEmitter } = require('events');

// ============================================================
// REGISTRY — Đăng ký tất cả automation scripts
// ============================================================
const automationRegistry = {
    'login-google':                require('./automations/login-google'),             // Ban goc, khong co Gesture Captcha
    'login-google-gesture':        require('./automations/login-google-gesture'),     // Co xu ly Gesture Captcha
    'logout-google':               require('./automations/logout-google'),
    'appeal-google':               require('./automations/appeal-google'),
    'solve-captcha-continuous':    require('./automations/solve-captcha-continuous'),
    'setup-2fa':                   require('./automations/setup-2fa'),
    'check-phone-verify':          require('./automations/check-phone-verify'),
    'verify-phone-sheet':          require('./automations/verify-phone-sheet'),
    'verify-phone-sheet-check':    require('./automations/verify-phone-sheet-check'),
    'solve-2fa':                   require('./automations/solve-2fa'),
    'solve-gesture-captcha':       require('./automations/solve-gesture-captcha'),
    'register-google-one':         require('./automations/register-google-one'),
};

class AutomationEngine extends EventEmitter {
    constructor(profileManager) {
        super();
        this.manager = profileManager;

        // Map: automationName -> AbortController
        this.controllers = new Map();
        // Map: automationName -> boolean
        this.runningStatus = new Map();
        // Log buffer: automationName -> [{time, msg, level}]
        this.logBuffers = new Map();
    }

    // ============================================================
    // PUBLIC API
    // ============================================================

    /** Lấy danh sách automation có sẵn */
    getAvailableAutomations() {
        return Object.keys(automationRegistry);
    }

    /** Trạng thái đang chạy */
    getStatus() {
        const running = {};
        for (const [name, status] of this.runningStatus.entries()) {
            running[name] = status;
        }
        return { running };
    }

    /** Lấy log của một automation */
    getLogs(automationName, limit = 200) {
        const buf = this.logBuffers.get(automationName) || [];
        return buf.slice(-limit);
    }

    /** Dừng một automation hoặc tất cả */
    stop(automationName) {
        if (automationName) {
            const ctrl = this.controllers.get(automationName);
            if (ctrl) { ctrl.abort(); this.controllers.delete(automationName); }
            this.runningStatus.set(automationName, false);
        } else {
            for (const ctrl of this.controllers.values()) ctrl.abort();
            this.controllers.clear();
            this.runningStatus.clear();
        }
        return { stopped: true };
    }

    /**
     * Chạy automation trên danh sách profileIds.
     * @param {string} automationName
     * @param {string[]} profileIds - Mảng ID profile Xsurau
     * @param {any[]} sheetData - Mảng data tương ứng cho từng profile
     * @param {object} options - { concurrency: number, blockImages: boolean }
     */
    async run(automationName, profileIds, sheetData = [], options = {}) {
        const engine = automationRegistry[automationName];
        if (!engine) throw new Error(`Automation "${automationName}" không tồn tại!`);

        // Dừng cái cũ nếu đang chạy
        if (this.controllers.has(automationName)) this.stop(automationName);

        const controller = new AbortController();
        this.controllers.set(automationName, controller);
        this.runningStatus.set(automationName, true);
        this.logBuffers.set(automationName, []);

        const concurrency = options.concurrency || 5;
        const results = [];
        const chunks = [];
        for (let i = 0; i < profileIds.length; i += concurrency) {
            chunks.push(profileIds.slice(i, i + concurrency));
        }

        const log = (msg, level = 'info') => {
            const entry = { time: new Date().toISOString(), msg, level };
            const buf = this.logBuffers.get(automationName) || [];
            buf.push(entry);
            if (buf.length > 1000) buf.shift(); // giới hạn buffer
            this.logBuffers.set(automationName, buf);
            this.emit('log', { automationName, ...entry });
        };

        log(`🚀 Bắt đầu [${automationName}] trên ${profileIds.length} profile (${concurrency} đồng thời)`);

        // Tự động tải dữ liệu Google Sheet theo ánh xạ của automation
        if (!sheetData || sheetData.length === 0) {
            try {
                const fs = require('fs');
                const settingsPath = 'G:\\XsurauDataVer3\\settings.json';
                const { getRowsFromTab } = require('./google-sheet');
                
                sheetData = [];

                if (fs.existsSync(settingsPath)) {
                    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
                    const autoConfig = settings.automations?.[automationName];
                    const sources = autoConfig?.sources && autoConfig.sources.length > 0
                        ? autoConfig.sources
                        : [{ sheetId: null, tab: autoConfig?.tab || 'FactoryAccount', matchKey: autoConfig?.matchKey || 'Gmail', mapping: autoConfig?.mapping || {} }];

                    for (const src of sources) {
                        const srcTab = src.tab || 'FactoryAccount';
                        const srcSheetId = src.sheetId || null;
                        const srcMapping = src.mapping || {};
                        const srcMatchKey = src.matchKey || 'Gmail';

                        try {
                            const rawRows = await getRowsFromTab(srcTab, srcSheetId);
                            const mappedRows = rawRows.map(rawRow => {
                                const mappedRow = { 
                                    rowIndex: rawRow.rowIndex, 
                                    _sheetId: srcSheetId, 
                                    _tabName: srcTab, 
                                    _matchKey: srcMatchKey,
                                    _outputMapping: { ...(autoConfig?.outputMapping || {}), ...(src.outputMapping || {}) },
                                    _outputValues: { ...(autoConfig?.outputValues || {}), ...(src.outputValues || {}) }
                                };
                                for (const [paramName, sourceFieldName] of Object.entries(srcMapping)) {
                                    mappedRow[paramName] = rawRow[sourceFieldName] || '';
                                }
                                return { ...rawRow, ...mappedRow };
                            });
                            sheetData = sheetData.concat(mappedRows);
                            log(`Tải ${rawRows.length} dòng từ Tab [${srcTab}] cho [${automationName}]`, 'info');
                        } catch (errSrc) {
                            log(`⚠️ Tải dữ liệu từ Tab [${srcTab}] thất bại: ${errSrc.message}`, 'warning');
                        }
                    }
                }
            } catch (e) {
                log(`⚠️ Tự động tải dữ liệu Google Sheet thất bại: ${e.message}`, 'warning');
            }
        }

        try {
            for (const chunk of chunks) {
                if (controller.signal.aborted) break;
                log(`⚡ Đang chạy nhóm [${results.length + 1} – ${results.length + chunk.length}] / ${profileIds.length}`);

                const chunkResults = await Promise.all(
                    chunk.map(async (profileId, idx) => {
                        const globalIdx = results.length + idx;
                        
                        // Tìm dòng trong Google Sheet khớp với profile này dựa trên cấu hình matchKey
                        let matchedRow = null;
                        const profileObj = this.manager.getProfile(profileId);
                        const profileName = profileObj ? profileObj.name : '';
                        
                        if (profileName && sheetData && sheetData.length > 0) {
                            const searchKey = profileName.toLowerCase().trim();
                            matchedRow = sheetData.find(row => {
                                const gmailMatch = row.Gmail && row.Gmail.toLowerCase().trim() === searchKey;
                                const keyField = row._matchKey || 'Gmail';
                                const val = row[keyField] || row['Gmail'] || row['PhoneNumber'] || '';
                                if (!val) return false;
                                const normVal = String(val).toLowerCase().trim();
                                return normVal === searchKey || (gmailMatch && normVal.includes(searchKey));
                            });
                        }
                        
                        if (!matchedRow) {
                            matchedRow = sheetData[globalIdx] || {};
                        }

                        const autoConfig = this.getSettings()?.automations?.[automationName];
                        const job = {
                            profileId,
                            sheetRow: matchedRow,
                            outputMapping: { ...(autoConfig?.outputMapping || {}), ...(matchedRow._outputMapping || {}) },
                            outputValues: { ...(autoConfig?.outputValues || {}), ...(matchedRow._outputValues || {}) },
                            blockImages: options.blockImages || false,
                            startUrl: options.startUrl || null,
                            manager: this.manager, // cho phép automation close/relaunch profile
                        };


                        let page = null;

                        try {
                            // Dùng lại layout đã lưu nếu có (từ lần "Mở tất cả" trước)
                            const savedLayout = this.manager.getLayoutFor(profileId);
                            const result = await this.manager.launchProfile(profileId, {
                                blockImages: job.blockImages,
                                startUrl: job.startUrl,
                                windowSize: savedLayout?.windowSize || null,
                                windowPosition: savedLayout?.windowPosition || null,
                                scaleFactor: savedLayout?.scaleFactor || null,
                            });
                            page = result.page;

                            // Đưa tab lên foreground để user thấy được automation đang làm gì
                            try { await page.bringToFront(); } catch { }

                            // Chạy kịch bản automation — zero latency!
                            const res = await engine.run(page, job, controller.signal, (msg) => log(`[${profileId}] ${msg}`));

                            log(`${res.success ? '✅' : '❌'} [${profileId}] ${res.success ? 'Thành công' : res.error}`);
                            return res;
                        } catch (err) {
                            log(`❌ [${profileId}] Lỗi: ${err.message}`, 'error');
                            return { profileId, success: false, error: err.message };
                        }
                        // Browser giữ nguyên sau khi chạy — user tự quản lý
                    })
                );
                results.push(...chunkResults);
            }

            this.runningStatus.set(automationName, false);
            this.controllers.delete(automationName);

            const successCount = results.filter(r => r.success).length;
            log(`🏁 Hoàn thành! ${successCount}/${results.length} thành công.`);

            return { success: results.every(r => r.success), results };
        } catch (error) {
            this.runningStatus.set(automationName, false);
            this.controllers.delete(automationName);
            if (controller.signal.aborted) return { success: false, results, stopped: true };
            throw error;
        }
    }
}

module.exports = AutomationEngine;
