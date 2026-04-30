/**
 * XSURAU GOOGLE SHEET MODULE
 *
 * Đọc/ghi Google Sheets trực tiếp qua googleapis (y hệt Surau).
 * Columns layout (A:I):
 *   A = Gmail
 *   B = PassWord
 *   C = Recover (2FA key)
 *   D = Phone
 *   E = Owner
 *   F = Note        ← filter theo cột này
 *   G = (reserved)
 *   H = DateAppeal
 *   I = DateRestore
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { google } = require('googleapis');

// ============================================================
// CLIENT
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

function getSheetConfig() {
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    const sheetName = process.env.GOOGLE_SHEET_NAME2; // FactoryAccount
    if (!spreadsheetId || !sheetName) throw new Error('Missing GOOGLE_SHEET_ID or GOOGLE_SHEET_NAME2 in .env');
    return { spreadsheetId, sheetName };
}

// ============================================================
// READER
// ============================================================

/**
 * Lấy tất cả rows từ sheet (A2:I).
 * @returns {Promise<SheetRow[]>}
 */
async function getAllRows() {
    const sheets = createSheetsClient();
    const { spreadsheetId, sheetName } = getSheetConfig();

    const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${sheetName}!A2:I`,
    });

    const values = res.data.values || [];
    return values.map((row, index) => ({
        rowIndex: index + 2, // row 1 là header
        Gmail:       row[0] || '',
        PassWord:    row[1] || '',
        Recover:     row[2] || '',
        Phone:       row[3] || '',
        Owner:       row[4] || '',
        Note:        row[5] || '',
        // col G bỏ qua
        DateAppeal:  row[7] || '',
        DateRestore: row[8] || '',
    }));
}

/**
 * Lấy rows có Note = 'on' (y hệt getRowsNoteOn trong Surau).
 */
async function getRowsNoteOn() {
    const rows = await getAllRows();
    return rows.filter(r => r.Note?.trim().toLowerCase() === 'on');
}

/**
 * Filter rows theo Note value.
 * @param {string} noteValue - VD: 'on', 'disable', 'done', 'appealing'
 */
async function getRowsByNote(noteValue) {
    const rows = await getAllRows();
    if (!noteValue) return rows;
    return rows.filter(r => r.Note?.trim().toLowerCase() === noteValue.trim().toLowerCase());
}

// ============================================================
// WRITER
// ============================================================

async function updateCell(rowIndex, col, value, dateFormat = false) {
    const sheets = createSheetsClient();
    const { spreadsheetId, sheetName } = getSheetConfig();

    await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!${col}${rowIndex}`,
        valueInputOption: dateFormat ? 'USER_ENTERED' : 'RAW',
        requestBody: { values: [[value]] },
    });
}

/** Update Note (col F) theo Gmail */
async function updateNoteByGmail(gmail, note) {
    const rows = await getAllRows();
    const row = rows.find(r => r.Gmail?.trim().toLowerCase() === gmail.trim().toLowerCase());
    if (!row) return false;
    await updateCell(row.rowIndex, 'F', note);
    return true;
}

/** Update Note (col F) + DateRestore (col I) */
async function updateNoteAndDateRestore(gmail, note, dateRestore) {
    const rows = await getAllRows();
    const row = rows.find(r => r.Gmail?.trim().toLowerCase() === gmail.trim().toLowerCase());
    if (!row) return false;
    await updateCell(row.rowIndex, 'F', note);
    await updateCell(row.rowIndex, 'I', dateRestore, true);
    return true;
}

/** Update Note (col F) + DateAppeal (col H) */
async function updateNoteAndDateAppeal(gmail, note, dateAppeal) {
    const rows = await getAllRows();
    const row = rows.find(r => r.Gmail?.trim().toLowerCase() === gmail.trim().toLowerCase());
    if (!row) return false;
    await updateCell(row.rowIndex, 'F', note);
    await updateCell(row.rowIndex, 'H', dateAppeal, true);
    return true;
}

/** Update Phone (col D) */
async function updatePhone(gmail, phone) {
    const rows = await getAllRows();
    const row = rows.find(r => r.Gmail?.trim().toLowerCase() === gmail.trim().toLowerCase());
    if (!row) return false;
    await updateCell(row.rowIndex, 'D', phone);
    return true;
}

/** Update Recover / 2FA key (col C) */
async function update2FAKey(gmail, secretKey) {
    const rows = await getAllRows();
    const row = rows.find(r => r.Gmail?.trim().toLowerCase() === gmail.trim().toLowerCase());
    if (!row) return false;
    await updateCell(row.rowIndex, 'C', secretKey);
    return true;
}

// ============================================================
// EXPRESS ROUTES
// ============================================================

function registerSheetRoutes(app) {
    /**
     * GET /api/sheet/all — Lấy toàn bộ rows
     */
    app.get('/api/sheet/all', async (req, res) => {
        try {
            const rows = await getAllRows();
            res.json({ total: rows.length, rows });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    /**
     * GET /api/sheet/rows — Lấy rows có Note = 'on' (giống Surau)
     */
    app.get('/api/sheet/rows', async (req, res) => {
        try {
            const { note } = req.query;
            const rows = note ? await getRowsByNote(note) : await getRowsNoteOn();
            res.json({ total: rows.length, rows });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    /**
     * POST /api/sheet/update-note
     * Body: { gmail, note }
     */
    app.post('/api/sheet/update-note', async (req, res) => {
        try {
            const { gmail, note } = req.body;
            if (!gmail || !note) return res.status(400).json({ error: 'Thiếu gmail hoặc note' });
            const ok = await updateNoteByGmail(gmail, note);
            res.json({ success: ok, gmail, note });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    /**
     * POST /api/sheet/update-note-and-date
     * Body: { gmail, note, dateRestore }
     */
    app.post('/api/sheet/update-note-and-date', async (req, res) => {
        try {
            const { gmail, note, dateRestore } = req.body;
            if (!gmail || !note || !dateRestore) return res.status(400).json({ error: 'Thiếu tham số' });
            const ok = await updateNoteAndDateRestore(gmail, note, dateRestore);
            res.json({ success: ok, gmail, note, dateRestore });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    /**
     * POST /api/sheet/update-note-and-appeal
     * Body: { gmail, note, dateAppeal }
     */
    app.post('/api/sheet/update-note-and-appeal', async (req, res) => {
        try {
            const { gmail, note, dateAppeal } = req.body;
            if (!gmail || !note || !dateAppeal) return res.status(400).json({ error: 'Thiếu tham số' });
            const ok = await updateNoteAndDateAppeal(gmail, note, dateAppeal);
            res.json({ success: ok, gmail, note, dateAppeal });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    /**
     * POST /api/sheet/update-phone
     * Body: { gmail, phone }
     */
    app.post('/api/sheet/update-phone', async (req, res) => {
        try {
            const { gmail, phone } = req.body;
            if (!gmail || !phone) return res.status(400).json({ error: 'Thiếu gmail hoặc phone' });
            const ok = await updatePhone(gmail, phone);
            res.json({ success: ok, gmail, phone });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    /**
     * POST /api/sheet/update-2fa-key
     * Body: { gmail, secretKey }
     */
    app.post('/api/sheet/update-2fa-key', async (req, res) => {
        try {
            const { gmail, secretKey } = req.body;
            if (!gmail || !secretKey) return res.status(400).json({ error: 'Thiếu gmail hoặc secretKey' });
            const ok = await update2FAKey(gmail, secretKey);
            res.json({ success: ok, gmail, secretKey });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });
}

module.exports = {
    getAllRows,
    getRowsNoteOn,
    getRowsByNote,
    updateNoteByGmail,
    updateNoteAndDateRestore,
    updateNoteAndDateAppeal,
    updatePhone,
    update2FAKey,
    registerSheetRoutes,
};
