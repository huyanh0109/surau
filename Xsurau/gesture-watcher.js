/**
 * gesture-watcher.js
 *
 * Auto-attach gesture captcha solver khi profile được launch với fake camera.
 * Solver chạy nền liên tục — không cần user bấm nút thủ công.
 *
 * PAUSE hoạt động ngay lập tức bằng cách reject Promise đang chờ.
 *
 * API:
 *   attachGestureWatcher(page, profileId, { manager, signal })
 *   stopGestureWatcher(profileId)
 *   getActiveWatchers()
 */

// Map: profileId -> { aborter, profileId, stopNow }
const activeWatchers = new Map();

/**
 * Gắn gesture captcha watcher vào page.
 */
function attachGestureWatcher(page, profileId, options = {}) {
    const { manager, signal: externalSignal } = options;

    if (!manager) {
        console.log(`[GestureWatcher] ⚠️ Bỏ qua profile [${profileId}] — không có manager.`);
        return;
    }

    // Dừng watcher cũ nếu đang chạy
    stopGestureWatcher(profileId);

    const aborter = new AbortController();
    // stopNow: function được gọi để cancel ngay lập tức bất kỳ await nào trong solver
    let stopNow = () => {};

    activeWatchers.set(profileId, { aborter, profileId, stop: () => { aborter.abort(); stopNow(); } });

    console.log(`[GestureWatcher] 🔌 Auto-watcher khởi động cho profile [${profileId}]`);

    _runBackground(page, profileId, manager, aborter.signal, externalSignal, (fn) => { stopNow = fn; })
        .catch(e => {
            const msg = e?.message || '';
            if (!msg.includes('Target closed') && !msg.includes('Session closed') && !msg.includes('context destroyed') && !msg.includes('STOPPED')) {
                console.log(`[GestureWatcher] ⚠️ [${profileId}] ${msg}`);
            }
        })
        .finally(() => {
            activeWatchers.delete(profileId);
            console.log(`[GestureWatcher] ⏹️ Watcher đã dừng cho profile [${profileId}]`);
        });
}

/**
 * Dừng watcher NGAY LẬP TỨC cho một profile.
 * Không cần chờ setTimeout 500ms kết thúc.
 */
function stopGestureWatcher(profileId) {
    const entry = activeWatchers.get(profileId);
    if (entry) {
        entry.stop(); // abort + cancel any pending sleep
        activeWatchers.delete(profileId);
        console.log(`[GestureWatcher] ✋ Đã dừng watcher cho profile [${profileId}]`);
    }
}

/**
 * Lấy danh sách profileId đang được watcher theo dõi
 */
function getActiveWatchers() {
    return [...activeWatchers.keys()];
}

// ─── Internal ─────────────────────────────────────────────────────────────────

/**
 * Tạo abortable sleep: bị cancel ngay khi signal bị abort
 */
function abortableSleep(ms, signal) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('STOPPED'));
        }, { once: true });
    });
}

async function _runBackground(page, profileId, manager, watcherSignal, externalSignal, registerStopNow) {
    // Lazy require để tránh circular dependency
    const solver = require('./automations/solve-gesture-captcha');

    const combinedAborter = new AbortController();
    const onAbort = () => combinedAborter.abort();
    watcherSignal.addEventListener('abort', onAbort, { once: true });
    externalSignal?.addEventListener('abort', onAbort, { once: true });

    // Đăng ký hàm dừng ngay: khi stop() được gọi, reject bất kỳ abortableSleep nào
    registerStopNow(onAbort);

    const job = {
        profileId,
        fakeCamActive: true,
        manager,
        sheetRow: {},
    };

    const log = (msg) => {
        if (!combinedAborter.signal.aborted) {
            console.log(`[GestureWatcher] [${profileId}] ${msg}`);
        }
    };

    try {
        await solver.run(page, job, combinedAborter.signal, log, {
            watchMode: true,
            sleep: (ms) => abortableSleep(ms, combinedAborter.signal),
        });
    } finally {
        watcherSignal.removeEventListener('abort', onAbort);
        externalSignal?.removeEventListener('abort', onAbort);
    }
}

module.exports = { attachGestureWatcher, stopGestureWatcher, getActiveWatchers };
