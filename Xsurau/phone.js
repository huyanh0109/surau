/**
 * XSURAU PHONE MODULE
 *
 * Y hệt Surau phone service — đọc trực tiếp sheet "RentPhone" từ Google Sheets.
 *
 * Sheet RentPhone columns (A:E):
 *   A = PhoneNumber
 *   B = Api           ← URL để gọi lấy OTP/SMS code
 *   C = DateTime
 *   D = LastUse
 *   E = Owner
 *
 * Luồng check-phone-verify:
 *   1. Load phones từ sheet vào RAM (queue)
 *   2. Automation gọi getNextPhone(profileId) → nhận SĐT
 *   3. Automation check SĐT với Google
 *   4. Automation gọi markPhone(phone, profileId, isValid)
 *   5. Nếu valid → gọi lookupCode(phone) → gọi API từ cột B → trích xuất code
 *   6. Cập nhật LastUse trong sheet
 */

// require('dotenv') removed - loaded in server.js
const { google } = require('googleapis');

// ============================================================
// GOOGLE SHEETS CLIENT
// ============================================================

function createSheetsClient() {
    const raw = process.env.GOOGLE_CREDENTIALS_JSON;
    if (!raw) throw new Error('Missing GOOGLE_CREDENTIALS_JSON in .env');
    const credentials = JSON.parse(raw);
    const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    return google.sheets({ version: 'v4', auth });
}

function getPhoneSheetConfig() {
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    const sheetName = process.env.GOOGLE_SHEET_NAME; // RentPhone
    if (!spreadsheetId || !sheetName) throw new Error('Missing GOOGLE_SHEET_ID or GOOGLE_SHEET_NAME in .env');
    return { spreadsheetId, sheetName };
}

// ============================================================
// READER — Đọc sheet RentPhone
// ============================================================

async function getAllPhoneRows() {
    const sheets = createSheetsClient();
    const { spreadsheetId, sheetName } = getPhoneSheetConfig();

    const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${sheetName}!A2:E3000`,
    });

    const values = res.data.values || [];
    return values.map((row, index) => ({
        rowIndex: index + 2,
        PhoneNumber: row[0] || '',
        Api:         row[1] || '',
        DateTime:    row[2] || '',
        LastUse:     row[3] || '',
        Owner:       row[4] || '',
    }));
}

async function findPhoneRow(phoneNumber) {
    const normalize = (p) => p.replace(/\D/g, '');
    const rows = await getAllPhoneRows();
    const norm = normalize(phoneNumber);
    return rows.find(r => normalize(r.PhoneNumber) === norm) || null;
}

// ============================================================
// WRITER — Cập nhật LastUse
// ============================================================

async function updateLastUse(rowIndex, dateTimeStr) {
    const sheets = createSheetsClient();
    const { spreadsheetId, sheetName } = getPhoneSheetConfig();
    await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!D${rowIndex}`,
        valueInputOption: 'RAW',
        requestBody: { values: [[dateTimeStr]] },
    });
}

function getCurrentDateTimeGMT7() {
    const now = new Date();
    const gmt7 = new Date(now.getTime() + 7 * 3600000);
    const pad = (n) => String(n).padStart(2, '0');
    return `${gmt7.getUTCFullYear()}-${pad(gmt7.getUTCMonth() + 1)}-${pad(gmt7.getUTCDate())} ` +
           `${pad(gmt7.getUTCHours())}:${pad(gmt7.getUTCMinutes())}:${pad(gmt7.getUTCSeconds())}`;
}

// ============================================================
// LOOKUP — Gọi API từ cột B để lấy OTP code
// ============================================================

function extractCode(text) {
    if (!text || text === 'No code') return null;
    
    // G-XXXXXX format (Google) - find all and get the last one
    const googleMatches = text.match(/G-(\d{6})/g);
    if (googleMatches && googleMatches.length > 0) {
        const lastMatch = googleMatches[googleMatches.length - 1];
        const m = lastMatch.match(/G-(\d{6})/);
        if (m) return m[1];
    }
    
    // 6-digit code - find all and get the last one
    const sixDigitMatches = text.match(/\b(\d{6})\b/g);
    if (sixDigitMatches && sixDigitMatches.length > 0) {
        return sixDigitMatches[sixDigitMatches.length - 1];
    }
    
    // 4-8 digit fallback - find all and get the last one
    const anyCodeMatches = text.match(/\b(\d{4,8})\b/g);
    if (anyCodeMatches && anyCodeMatches.length > 0) {
        return anyCodeMatches[anyCodeMatches.length - 1];
    }
    
    return null;
}

async function lookupAndCallApi(phoneNumber) {
    const normalize = (p) => p.replace(/\D/g, '');
    const normalizedPhone = normalize(phoneNumber);
    const row = await findPhoneRow(normalizedPhone);

    if (!row) throw new Error(`Phone not found: ${normalizedPhone}`);
    if (!row.Api) throw new Error(`No API configured for phone: ${phoneNumber}`);

    const response = await fetch(row.Api);
    const responseText = await response.text();

    // Kiểm tra lỗi từ API
    if (responseText.includes('"status":"fail"') || responseText.includes('"message":"error"')) {
        throw new Error('API returned error or no code yet');
    }

    let data = {};
    try { data = JSON.parse(responseText); } catch { data = { text: responseText }; }

    const code = data.text ? extractCode(data.text) : (data.code || '');
    data.code = code || '';

    // Cập nhật LastUse nếu có code
    if (code) {
        await updateLastUse(row.rowIndex, getCurrentDateTimeGMT7());
    }

    return data;
}

// ============================================================
// PHONE QUEUE — In-memory, y hệt PhoneQueueService của Surau
// ============================================================

class PhoneQueue {
    constructor() {
        /** @type {Array<{phoneNumber: string, assignedToProfile: string|null, checkedByProfiles: Set<string>, isValid: boolean|null}>} */
        this.phones = [];
        this.loadedAt = null;
    }

    /**
     * Load phones có LastUse > daysSinceLastUse ngày từ Google Sheet vào RAM
     */
    async load(daysSinceLastUse = 5, limit = 70) {
        const allRows = await getAllPhoneRows();
        const now = new Date();

        const available = allRows.filter(row => {
            if (!row.PhoneNumber?.trim()) return false;
            if (!row.LastUse?.trim()) return true; // Chưa dùng bao giờ → available

            try {
                const dateStr = row.LastUse.trim();
                let lastUseDate;

                // Parse DD/MM/YYYY hoặc YYYY-MM-DD
                const dmyMatch = dateStr.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
                if (dmyMatch) {
                    const [, day, month, year, h = 0, m = 0, s = 0] = dmyMatch;
                    lastUseDate = new Date(Number(year), Number(month) - 1, Number(day), Number(h), Number(m), Number(s));
                } else {
                    lastUseDate = new Date(dateStr);
                }

                if (isNaN(lastUseDate.getTime())) return false;
                const diffDays = (now - lastUseDate) / (1000 * 60 * 60 * 24);
                return diffDays > daysSinceLastUse;
            } catch { return false; }
        });

        this.phones = available.slice(0, limit).map(row => ({
            phoneNumber: row.PhoneNumber.trim(),
            assignedToProfile: null,
            checkedByProfiles: new Set(),
            isValid: null,
        }));
        this.loadedAt = new Date();

        return { success: true, total: this.phones.length, message: `Loaded ${this.phones.length} phones` };
    }

    /** Lấy số tiếp theo cho profile (profile là string ID của Xsurau) */
    getNext(profileId) {
        const available = this.phones.find(
            p => p.assignedToProfile === null && !p.checkedByProfiles.has(String(profileId))
        );
        if (!available || !available.phoneNumber?.trim()) return null;

        available.assignedToProfile = String(profileId);
        return { phoneNumber: available.phoneNumber };
    }

    /** Mark kết quả check của profile */
    mark(phoneNumber, profileId, isValid) {
        const phone = this.phones.find(p => p.phoneNumber === phoneNumber);
        if (!phone) return { success: false, message: `Phone ${phoneNumber} not in queue` };

        phone.checkedByProfiles.add(String(profileId));
        phone.isValid = isValid;
        phone.assignedToProfile = null; // Release để profile khác có thể check

        return { success: true, message: `Marked ${phoneNumber} as ${isValid ? 'valid' : 'invalid'}` };
    }

    reset() {
        this.phones = [];
        this.loadedAt = null;
    }

    getStatus() {
        return {
            total: this.phones.length,
            assigned: this.phones.filter(p => p.assignedToProfile !== null).length,
            available: this.phones.filter(p => p.assignedToProfile === null && p.isValid === null).length,
            valid: this.phones.filter(p => p.isValid === true).length,
            invalid: this.phones.filter(p => p.isValid === false).length,
            loadedAt: this.loadedAt?.toISOString() || null,
            phones: this.phones.map(p => ({
                phoneNumber: p.phoneNumber,
                assignedToProfile: p.assignedToProfile,
                checkedByCount: p.checkedByProfiles.size,
                isValid: p.isValid,
            })),
        };
    }
}

// Singleton queue instance
const phoneQueue = new PhoneQueue();

// ============================================================
// EXPRESS ROUTES — Y hệt PhoneController của Surau
// ============================================================

function registerPhoneRoutes(app) {
    /**
     * GET /api/phone/lookup?number=xxx
     * Tìm SĐT trong sheet, gọi API cột B, trả về code
     */
    app.get('/api/phone/lookup', async (req, res) => {
        const { number } = req.query;
        if (!number) return res.status(400).json({ error: 'Thiếu ?number=xxx' });
        try {
            const result = await lookupAndCallApi(number);
            res.json(result);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    /**
     * GET /api/phone/all
     * Lấy toàn bộ SĐT trong sheet
     */
    app.get('/api/phone/all', async (req, res) => {
        try {
            const phones = await getAllPhoneRows();
            res.json({ total: phones.length, phones });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    /**
     * GET /api/phone/available?days=5&limit=70
     * Lấy SĐT có LastUse > X ngày
     */
    app.get('/api/phone/available', async (req, res) => {
        try {
            const days = parseInt(req.query.days) || 5;
            const limit = parseInt(req.query.limit) || 70;
            const allRows = await getAllPhoneRows();
            const now = new Date();
            const available = allRows.filter(row => {
                if (!row.PhoneNumber?.trim()) return false;
                if (!row.LastUse?.trim()) return true;
                try {
                    const d = new Date(row.LastUse);
                    if (isNaN(d.getTime())) return false;
                    return (now - d) / (1000 * 60 * 60 * 24) > days;
                } catch { return false; }
            }).slice(0, limit);
            res.json({ total: available.length, phones: available });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ===== QUEUE ROUTES =====

    /**
     * POST /api/phone/queue/load
     * Load SĐT từ sheet vào RAM queue
     */
    app.post('/api/phone/queue/load', async (req, res) => {
        try {
            const { days = 5, limit = 70 } = req.body || {};
            const result = await phoneQueue.load(Number(days), Number(limit));
            res.json(result);
        } catch (e) { res.status(500).json({ success: false, error: e.message }); }
    });

    /**
     * GET /api/phone/queue/next?profileId=xxx
     * Lấy SĐT tiếp theo cho profile
     */
    app.get('/api/phone/queue/next', (req, res) => {
        const { profileId } = req.query;
        if (!profileId) return res.status(400).json({ error: 'Thiếu profileId' });
        const phone = phoneQueue.getNext(profileId);
        if (!phone) return res.json({ error: 'No more phones available for this profile' });
        res.json(phone);
    });

    /**
     * POST /api/phone/queue/mark
     * Mark kết quả check
     * Body: { phoneNumber, profileId, isValid }
     */
    app.post('/api/phone/queue/mark', (req, res) => {
        const { phoneNumber, profileId, isValid } = req.body;
        if (!phoneNumber || profileId === undefined || isValid === undefined)
            return res.status(400).json({ success: false, message: 'Thiếu phoneNumber, profileId hoặc isValid' });
        res.json(phoneQueue.mark(phoneNumber, String(profileId), isValid));
    });

    /**
     * POST /api/phone/queue/reset
     * Reset queue và load lại
     */
    app.post('/api/phone/queue/reset', async (req, res) => {
        try {
            phoneQueue.reset();
            const { days = 5, limit = 70 } = req.body || {};
            const result = await phoneQueue.load(Number(days), Number(limit));
            res.json(result);
        } catch (e) { res.status(500).json({ success: false, error: e.message }); }
    });

    /**
     * GET /api/phone/queue/status
     * Xem trạng thái queue
     */
    app.get('/api/phone/queue/status', (req, res) => {
        res.json(phoneQueue.getStatus());
    });
}

module.exports = { phoneQueue, registerPhoneRoutes, lookupAndCallApi, getAllPhoneRows, findPhoneRow };
