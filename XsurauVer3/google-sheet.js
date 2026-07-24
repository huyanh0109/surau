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

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

// ============================================================
// HELPERS
// ============================================================

function colLetterToIndex(col) {
    if (!col) return -1;
    let temp = col.toUpperCase().trim();
    let index = 0;
    for (let i = 0; i < temp.length; i++) {
        index = index * 26 + (temp.charCodeAt(i) - 64);
    }
    return index - 1;
}

function indexToColLetter(index) {
    let col = '';
    let temp = index + 1;
    while (temp > 0) {
        let rem = (temp - 1) % 26;
        col = String.fromCharCode(65 + rem) + col;
        temp = Math.floor((temp - rem) / 26);
    }
    return col;
}

function getMaxColLetter(columns, defaultMax = 'I') {
    let maxIndex = colLetterToIndex(defaultMax);
    for (const val of Object.values(columns)) {
        const idx = colLetterToIndex(val);
        if (idx > maxIndex) maxIndex = idx;
    }
    return indexToColLetter(maxIndex);
}

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
    let spreadsheetId = process.env.GOOGLE_SHEET_ID;
    let sheetName = process.env.GOOGLE_SHEET_NAME2; // FactoryAccount
    let columns = {
        Gmail: 'A',
        PassWord: 'B',
        Recover: 'C',
        Phone: 'D',
        Owner: 'E',
        Note: 'F',
        DateAppeal: 'H',
        DateRestore: 'I'
    };

    const settingsPath = 'G:\\XsurauDataVer3\\settings.json';
    if (fs.existsSync(settingsPath)) {
        try {
            const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
            if (settings.googleSheetId) spreadsheetId = settings.googleSheetId;
            if (settings.googleSheetName2) sheetName = settings.googleSheetName2;
            if (settings.columns?.account) {
                columns = { ...columns, ...settings.columns.account };
            }
        } catch (e) {
            console.error('[GoogleSheet] Lỗi đọc settings.json:', e.message);
        }
    }

    if (!spreadsheetId || !sheetName) throw new Error('Missing GOOGLE_SHEET_ID or GOOGLE_SHEET_NAME2');
    return { spreadsheetId, sheetName, columns };
}

// ============================================================
// READER
// ============================================================

/**
 * Lấy tất cả rows từ sheet (A2:maxCol).
 * @returns {Promise<SheetRow[]>}
 */
async function getAllRows() {
    const sheets = createSheetsClient();
    const { spreadsheetId, sheetName, columns } = getSheetConfig();
    const maxCol = getMaxColLetter(columns, 'I');

    const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${sheetName}'!A2:${maxCol}`,
    });

    const values = res.data.values || [];
    return values.map((row, index) => {
        const getVal = (colLetter) => {
            const idx = colLetterToIndex(colLetter);
            return (idx !== -1 && idx < row.length) ? row[idx] || '' : '';
        };

        return {
            rowIndex: index + 2, // row 1 là header
            Gmail:       getVal(columns.Gmail),
            PassWord:    getVal(columns.PassWord),
            Recover:     getVal(columns.Recover),
            Phone:       getVal(columns.Phone),
            Owner:       getVal(columns.Owner),
            Note:        getVal(columns.Note),
            DateAppeal:  getVal(columns.DateAppeal),
            DateRestore: getVal(columns.DateRestore),
        };
    });
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
// DYNAMIC TABS & WRITERS
// ============================================================

async function getRowsFromTab(tabName, sheetId = null) {
    const sheets = createSheetsClient();
    const settingsPath = 'G:\\XsurauDataVer3\\settings.json';
    if (!fs.existsSync(settingsPath)) throw new Error('Cần cấu hình Google Sheet trong cài đặt trước.');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    
    let spreadsheetId = settings.googleSheetId;
    let tab = settings.tabs?.find(t => t.name === tabName);

    if (sheetId && settings.sheets) {
        const foundSheet = settings.sheets.find(s => s.id === sheetId);
        if (foundSheet) {
            spreadsheetId = foundSheet.spreadsheetId || spreadsheetId;
            const foundTab = foundSheet.tabs?.find(t => t.name === tabName);
            if (foundTab) tab = foundTab;
        }
    }
    
    if (!spreadsheetId) throw new Error('Thiếu Google Sheet ID trong cài đặt.');
    if (!tab) tab = { name: tabName, columns: {} };
    
    const cacheKey = `${spreadsheetId}|${tabName}`;
    if (!global._tabRowsCache) global._tabRowsCache = new Map();
    if (!global._pendingTabFetches) global._pendingTabFetches = new Map();

    const cachedEntry = global._tabRowsCache.get(cacheKey);
    const now = Date.now();

    if (cachedEntry && (now - cachedEntry.time < 5000)) {
        return cachedEntry.data;
    }

    if (global._pendingTabFetches.has(cacheKey)) {
        return await global._pendingTabFetches.get(cacheKey);
    }

    const fetchPromise = (async () => {
        try {
            const columns = tab.columns || {};
            const maxCol = getMaxColLetter(columns, 'I');
            
            const res = await sheets.spreadsheets.values.get({
                spreadsheetId,
                range: `'${tabName}'!A2:${maxCol}5000`,
            });
            
            const values = res.data.values || [];
            const result = values.map((row, index) => {
                const obj = { rowIndex: index + 2, _sheetId: sheetId, _spreadsheetId: spreadsheetId, _tabName: tabName };
                for (const [colName, colLetter] of Object.entries(columns)) {
                    const idx = colLetterToIndex(colLetter);
                    obj[colName] = (idx !== -1 && idx < row.length) ? row[idx] || '' : '';
                }
                return obj;
            });

            global._tabRowsCache.set(cacheKey, { time: Date.now(), data: result });
            return result;
        } catch (e) {
            if (cachedEntry && cachedEntry.data) {
                console.warn(`[GoogleSheet] API Quota/Error for tab [${tabName}], serving cached data:`, e.message);
                return cachedEntry.data;
            }
            if (e.message && (e.message.includes('Unable to parse range') || e.message.includes('not found') || e.message.includes('400'))) {
                throw new Error(`Không tìm thấy Tab tên là "${tabName}" trong Google Sheet của bạn.`);
            }
            throw e;
        } finally {
            global._pendingTabFetches.delete(cacheKey);
        }
    })();

    global._pendingTabFetches.set(cacheKey, fetchPromise);
    return await fetchPromise;
}

async function updateTabFieldByMatch(matchField, matchValue, targetField, targetValue, dateFormat = false, automationName = null) {
    const settingsPath = 'G:\\XsurauDataVer3\\settings.json';
    if (!fs.existsSync(settingsPath)) return false;
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    
    let spreadsheetId = settings.googleSheetId;
    if (!spreadsheetId) return false;

    let targetSources = [];
    if (automationName && settings.automations?.[automationName]) {
        const autoConfig = settings.automations[automationName];
        if (autoConfig.sources && Array.isArray(autoConfig.sources) && autoConfig.sources.length > 0) {
            targetSources = [...autoConfig.sources];
        } else if (autoConfig.tab) {
            targetSources = [{ sheetId: null, tab: autoConfig.tab, mapping: autoConfig.mapping || {} }];
        }
    }

    // Bổ sung tất cả các Tab từ tất cả các Sheet vào danh sách để tìm kiếm hàng chứa Gmail
    const allSheets = settings.sheets && settings.sheets.length > 0 ? settings.sheets : [{ id: 'default', spreadsheetId: settings.googleSheetId, tabs: settings.tabs || [] }];
    for (const s of allSheets) {
        if (s.tabs && Array.isArray(s.tabs)) {
            for (const t of s.tabs) {
                const tabName = typeof t === 'string' ? t : t.name;
                if (!targetSources.some(ts => ts.tab === tabName)) {
                    targetSources.push({ sheetId: s.id, tab: tabName });
                }
            }
        }
    }

    for (const src of targetSources) {
        let curSpreadsheetId = spreadsheetId;
        let curTabObj = null;
        let activeTabName = src.tab;

        // Xử lý Target Output Tab nếu được cài đặt ở Step 03
        if (src.outputTab) {
            const parts = src.outputTab.split('|');
            if (parts.length === 2) {
                const outputSheetId = parts[0];
                activeTabName = parts[1];
                const foundOutputSheet = settings.sheets?.find(s => s.id === outputSheetId || s.spreadsheetId === outputSheetId);
                if (foundOutputSheet && foundOutputSheet.spreadsheetId) {
                    curSpreadsheetId = foundOutputSheet.spreadsheetId;
                    curTabObj = foundOutputSheet.tabs?.find(t => (typeof t === 'string' ? t === activeTabName : t.name === activeTabName));
                }
            }
        }

        if (!curTabObj && settings.sheets && settings.sheets.length > 0) {
            let foundSheet = settings.sheets.find(s => s.id === src.sheetId || s.spreadsheetId === src.sheetId);
            if (!foundSheet) {
                foundSheet = settings.sheets.find(s => s.tabs && Array.isArray(s.tabs) && s.tabs.some(t => (typeof t === 'string' ? t === activeTabName : t.name === activeTabName)));
            }
            if (foundSheet && foundSheet.spreadsheetId) {
                curSpreadsheetId = foundSheet.spreadsheetId;
                curTabObj = foundSheet.tabs?.find(t => (typeof t === 'string' ? t === activeTabName : t.name === activeTabName));
            }
        }

        if (!curTabObj && settings.tabs) {
            curTabObj = settings.tabs.find(t => t.name === activeTabName);
        }

        if (!curTabObj) {
            curTabObj = { name: activeTabName, columns: {} };
        }

        const columns = curTabObj.columns || {};
        
        let mappedMatchField = src.mapping?.[matchField] || matchField;
        let mappedTargetField = src.outputMapping?.[targetField] || src.mapping?.[targetField] || targetField;

        if (automationName && settings.automations?.[automationName]?.mapping) {
            const globalMapping = settings.automations[automationName].mapping;
            if (!src.mapping?.[matchField] && globalMapping[matchField]) mappedMatchField = globalMapping[matchField];
            if (!src.mapping?.[targetField] && globalMapping[targetField]) mappedTargetField = globalMapping[targetField];
        }

        const matchedKey = Object.keys(columns).find(k => k.toLowerCase() === mappedMatchField.toLowerCase()) || mappedMatchField;
        const targetKey = Object.keys(columns).find(k => k.toLowerCase() === mappedTargetField.toLowerCase()) || mappedTargetField;

        // Fallback mặc định cho các cột phổ biến nếu chưa scan được chữ cái cột
        const DEFAULT_COLUMNS = { Note: 'F', DateRestore: 'I', DateAppeal: 'H', Phone: 'D', Gmail: 'A', PassWord: 'B', Recover: 'C' };
        const targetColLetter = columns[targetKey] || columns[targetField] || DEFAULT_COLUMNS[targetField] || 'F';

        if (targetColLetter) {
            const rows = await getRowsFromTab(activeTabName, src.sheetId);
            const matchedKeyInRows = Object.keys(rows[0] || {}).find(k => k.toLowerCase() === matchedKey.toLowerCase()) || 'Gmail';
            const row = rows.find(r => String(r[matchedKeyInRows] || '').trim().toLowerCase() === String(matchValue).trim().toLowerCase());

            if (row) {
                let finalTargetValue = targetValue;
                if (targetField === 'Note' && automationName) {
                    const autoConfig = settings.automations?.[automationName];
                    const configuredNote = src.outputValues?.Note || autoConfig?.outputValues?.Note || autoConfig?.sources?.[0]?.outputValues?.Note;
                    if (configuredNote) finalTargetValue = configuredNote;
                }

                const sheets = createSheetsClient();
                await sheets.spreadsheets.values.update({
                    spreadsheetId: curSpreadsheetId,
                    range: `'${activeTabName}'!${targetColLetter}${row.rowIndex}`,
                    valueInputOption: dateFormat ? 'USER_ENTERED' : 'RAW',
                    requestBody: { values: [[finalTargetValue]] },
                });
                
                if (global._tabRowsCache) {
                    const cacheKey = `${curSpreadsheetId}|${src.tab}`;
                    global._tabRowsCache.delete(cacheKey);
                }

                console.log(`[GoogleSheet] ✅ Đã ghi "${targetValue}" vào cột ${targetColLetter}${row.rowIndex} trên Tab [${src.tab}] của Sheet ID [${curSpreadsheetId}]`);
                return true;
            }
        }
    }
    return false;
}

async function updateCell(rowIndex, col, value, dateFormat = false) {
    const sheets = createSheetsClient();
    const { spreadsheetId, sheetName } = getSheetConfig();

    await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${sheetName}'!${col}${rowIndex}`,
        valueInputOption: dateFormat ? 'USER_ENTERED' : 'RAW',
        requestBody: { values: [[value]] },
    });
}

/** Update Note theo Gmail */
async function updateNoteByGmail(gmail, note, automationName = null) {
    return await updateTabFieldByMatch('Gmail', gmail, 'Note', note, false, automationName);
}

/** Update Note + DateRestore */
async function updateNoteAndDateRestore(gmail, note, dateRestore, automationName = null) {
    const ok1 = await updateTabFieldByMatch('Gmail', gmail, 'Note', note, false, automationName);
    const ok2 = await updateTabFieldByMatch('Gmail', gmail, 'DateRestore', dateRestore, true, automationName);
    return ok1 || ok2;
}

/** Update Note + DateAppeal */
async function updateNoteAndDateAppeal(gmail, note, dateAppeal, automationName = null) {
    const ok1 = await updateTabFieldByMatch('Gmail', gmail, 'Note', note, false, automationName);
    const ok2 = await updateTabFieldByMatch('Gmail', gmail, 'DateAppeal', dateAppeal, true, automationName);
    return ok1 || ok2;
}

/** Update Phone */
async function updatePhone(gmail, phone, automationName = null) {
    return await updateTabFieldByMatch('Gmail', gmail, 'Phone', phone, false, automationName);
}

/** Update Recover / 2FA key */
async function update2FAKey(gmail, secretKey, automationName = null) {
    return await updateTabFieldByMatch('Gmail', gmail, 'Recover', secretKey, false, automationName);
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

    function getSpreadsheetId(settings, reqParam) {
        const sId = reqParam?.sheetId || reqParam?.spreadsheetId;
        if (sId) {
            if (settings.sheets) {
                const found = settings.sheets.find(s => s.id === sId || s.spreadsheetId === sId);
                if (found && found.spreadsheetId) return found.spreadsheetId;
            }
            return sId;
        }
        if (settings.activeSheetId && settings.sheets) {
            const active = settings.sheets.find(s => s.id === settings.activeSheetId);
            if (active && active.spreadsheetId) return active.spreadsheetId;
        }
        if (settings.sheets && settings.sheets[0] && settings.sheets[0].spreadsheetId) {
            return settings.sheets[0].spreadsheetId;
        }
        return settings.googleSheetId || '';
    }

    /**
     * GET /api/sheet/meta/tabs — Lấy danh sách tên các Tab trong Google Sheet
     */
    app.get('/api/sheet/meta/tabs', async (req, res) => {
        try {
            const settingsPath = 'G:\\XsurauDataVer3\\settings.json';
            if (!fs.existsSync(settingsPath)) {
                return res.status(400).json({ error: 'Cần cấu hình Google Sheet trong cài đặt trước.' });
            }
            const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
            
            const spreadsheetId = getSpreadsheetId(settings, req.query);
            if (!spreadsheetId) {
                return res.status(400).json({ error: 'Thiếu Google Sheet ID' });
            }
            
            const sheets = createSheetsClient();
            const response = await sheets.spreadsheets.get({
                spreadsheetId,
            });
            
            const tabNames = response.data.sheets.map(s => s.properties.title);
            res.json({ success: true, tabs: tabNames, spreadsheetId });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    /**
     * GET /api/sheet/meta/columns — Lấy danh sách cột từ hàng 1 của tab cụ thể
     */
    app.get('/api/sheet/meta/columns', async (req, res) => {
        try {
            const settingsPath = 'G:\\XsurauDataVer3\\settings.json';
            if (!fs.existsSync(settingsPath)) {
                return res.status(400).json({ error: 'Cần cấu hình Google Sheet trong cài đặt trước.' });
            }
            const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
            const spreadsheetId = getSpreadsheetId(settings, req.query);
            const tabName = req.query.tabName;

            if (!spreadsheetId) return res.status(400).json({ error: 'Thiếu Google Sheet ID' });
            if (!tabName) return res.status(400).json({ error: 'Thiếu tên Tab' });

            const sheets = createSheetsClient();
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId,
                range: `'${tabName}'!1:1`,
            });

            const rows = response.data.values;
            const columns = {};
            
            // Hàm tiện ích đổi chỉ số (0 -> A, 1 -> B)
            function getColLetter(index) {
                let temp = index;
                let letter = '';
                while (temp >= 0) {
                    letter = String.fromCharCode((temp % 26) + 65) + letter;
                    temp = Math.floor(temp / 26) - 1;
                }
                return letter;
            }

            if (rows && rows.length > 0) {
                const headers = rows[0];
                for (let i = 0; i < headers.length; i++) {
                    const val = headers[i]?.trim();
                    if (val) {
                        columns[val] = getColLetter(i);
                    }
                }
            }

            res.json({ success: true, columns });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    /**
     * GET /api/sheet/rows/:tabName — Lấy rows từ Tab cụ thể
     */
    app.get('/api/sheet/rows/:tabName', async (req, res) => {
        try {
            const { tabName } = req.params;
            const { note, sheetId, limit } = req.query;
            let rows = await getRowsFromTab(tabName, sheetId);
            
            if (note && note.trim() !== '' && note.trim() !== '*' && note.trim().toLowerCase() !== 'all') {
                const settingsPath = 'G:\\XsurauDataVer3\\settings.json';
                if (fs.existsSync(settingsPath)) {
                    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
                    let tab = null;
                    if (sheetId && settings.sheets) {
                        const s = settings.sheets.find(x => x.id === sheetId || x.spreadsheetId === sheetId);
                        if (s) tab = s.tabs?.find(t => t.name === tabName);
                    }
                    if (!tab && settings.tabs) {
                        tab = settings.tabs.find(t => t.name === tabName);
                    }
                    if (tab) {
                        const noteKey = Object.keys(tab.columns || {}).find(k => k.toLowerCase().includes('note') || k.toLowerCase().includes('status'));
                        if (noteKey) {
                            rows = rows.filter(r => String(r[noteKey] || '').trim().toLowerCase() === String(note).trim().toLowerCase());
                        }
                    }
                }
            }

            if (limit && parseInt(limit, 10) > 0) {
                rows = rows.slice(0, parseInt(limit, 10));
            }

            res.json({ total: rows.length, rows });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    /**
     * GET /api/sheet/rows — Lấy rows có Note = 'on' (giống Surau) từ tab mặc định đầu tiên
     */
    app.get('/api/sheet/rows', async (req, res) => {
        try {
            const { note } = req.query;
            const settingsPath = 'G:\\XsurauDataVer3\\settings.json';
            let tabName = 'FactoryAccount';
            if (fs.existsSync(settingsPath)) {
                const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
                if (settings.tabs && settings.tabs[0]) tabName = settings.tabs[0].name;
            }
            
            let rows = await getRowsFromTab(tabName);
            if (note) {
                const settingsPath = 'G:\\XsurauDataVer3\\settings.json';
                if (fs.existsSync(settingsPath)) {
                    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
                    const tab = settings.tabs?.find(t => t.name === tabName);
                    if (tab) {
                        const noteKey = Object.keys(tab.columns || {}).find(k => k.toLowerCase().includes('note') || k.toLowerCase().includes('status'));
                        if (noteKey) {
                            rows = rows.filter(r => String(r[noteKey] || '').trim().toLowerCase() === String(note).trim().toLowerCase());
                        }
                    }
                }
            }
            res.json({ total: rows.length, rows });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    /**
     * POST /api/sheet/update-note
     * Body: { gmail, note, automationName }
     */
    app.post('/api/sheet/update-note', async (req, res) => {
        try {
            const { gmail, note, automationName } = req.body;
            if (!gmail || !note) return res.status(400).json({ error: 'Thiếu gmail hoặc note' });
            const ok = await updateNoteByGmail(gmail, note, automationName);
            res.json({ success: ok, gmail, note });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    /**
     * POST /api/sheet/update-note-and-date
     * Body: { gmail, note, dateRestore, automationName }
     */
    app.post('/api/sheet/update-note-and-date', async (req, res) => {
        try {
            const { gmail, note, dateRestore, automationName } = req.body;
            if (!gmail || !note || !dateRestore) return res.status(400).json({ error: 'Thiếu tham số' });
            const ok = await updateNoteAndDateRestore(gmail, note, dateRestore, automationName);
            res.json({ success: ok, gmail, note, dateRestore });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    /**
     * POST /api/sheet/update-note-and-appeal
     * Body: { gmail, note, dateAppeal, automationName }
     */
    app.post('/api/sheet/update-note-and-appeal', async (req, res) => {
        try {
            const { gmail, note, dateAppeal, automationName } = req.body;
            if (!gmail || !note || !dateAppeal) return res.status(400).json({ error: 'Thiếu tham số' });
            const ok = await updateNoteAndDateAppeal(gmail, note, dateAppeal, automationName);
            res.json({ success: ok, gmail, note, dateAppeal });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    /**
     * POST /api/sheet/update-phone
     * Body: { gmail, phone, automationName }
     */
    app.post('/api/sheet/update-phone', async (req, res) => {
        try {
            const { gmail, phone, automationName } = req.body;
            if (!gmail || !phone) return res.status(400).json({ error: 'Thiếu gmail hoặc phone' });
            const ok = await updatePhone(gmail, phone, automationName);
            res.json({ success: ok, gmail, phone });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    /**
     * POST /api/sheet/update-2fa-key
     * Body: { gmail, secretKey, automationName }
     */
    app.post('/api/sheet/update-2fa-key', async (req, res) => {
        try {
            const { gmail, secretKey, automationName } = req.body;
            if (!gmail || !secretKey) return res.status(400).json({ error: 'Thiếu gmail hoặc secretKey' });
            const ok = await update2FAKey(gmail, secretKey, automationName);
            res.json({ success: ok, gmail, secretKey });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    /**
     * POST /api/sheet/columns/update
     * Body: { tabName, colLetter, value }
     */
    app.post('/api/sheet/columns/update', async (req, res) => {
        try {
            const { tabName, colLetter, value } = req.body;
            if (!tabName || !colLetter) return res.status(400).json({ error: 'Thiếu tabName hoặc colLetter' });

            const settingsPath = 'G:\\XsurauDataVer3\\settings.json';
            if (!fs.existsSync(settingsPath)) return res.status(400).json({ error: 'Cần cấu hình Google Sheet trước.' });
            const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
            const spreadsheetId = getSpreadsheetId(settings, req.body);
            if (!spreadsheetId) return res.status(400).json({ error: 'Thiếu Google Sheet ID trong cài đặt.' });

            const sheets = createSheetsClient();
            await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: `'${tabName}'!${colLetter.toUpperCase()}1`,
                valueInputOption: 'USER_ENTERED',
                requestBody: {
                    values: [[value || '']]
                }
            });
            res.json({ success: true, message: `Đã cập nhật cột ${colLetter} của tab "${tabName}" thành "${value}" trên Google Sheet.` });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    /**
     * POST /api/sheet/tabs/create
     * Body: { tabName }
     */
    app.post('/api/sheet/tabs/create', async (req, res) => {
        try {
            const { tabName } = req.body;
            if (!tabName) return res.status(400).json({ error: 'Thiếu tabName' });

            const settingsPath = 'G:\\XsurauDataVer3\\settings.json';
            if (!fs.existsSync(settingsPath)) return res.status(400).json({ error: 'Cần cấu hình Google Sheet trước.' });
            const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
            const spreadsheetId = getSpreadsheetId(settings, req.body);
            if (!spreadsheetId) return res.status(400).json({ error: 'Thiếu Google Sheet ID trong cài đặt.' });

            const sheets = createSheetsClient();
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId,
                requestBody: {
                    requests: [
                        {
                            addSheet: {
                                properties: {
                                    title: tabName,
                                }
                            }
                        }
                    ]
                }
            });
            res.json({ success: true, message: `Đã tạo tab "${tabName}" trên Google Sheet.` });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    /**
     * POST /api/sheet/tabs/delete
     * Body: { tabName }
     */
    app.post('/api/sheet/tabs/delete', async (req, res) => {
        try {
            const { tabName } = req.body;
            if (!tabName) return res.status(400).json({ error: 'Thiếu tabName' });

            const settingsPath = 'G:\\XsurauDataVer3\\settings.json';
            if (!fs.existsSync(settingsPath)) return res.status(400).json({ error: 'Cần cấu hình Google Sheet trước.' });
            const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
            const spreadsheetId = getSpreadsheetId(settings, req.body);
            if (!spreadsheetId) return res.status(400).json({ error: 'Thiếu Google Sheet ID trong cài đặt.' });

            const sheets = createSheetsClient();
            const doc = await sheets.spreadsheets.get({ spreadsheetId });
            const sheet = doc.data.sheets?.find(s => s.properties.title === tabName);
            
            if (!sheet) {
                return res.status(404).json({ error: `Không tìm thấy tab "${tabName}" trên Google Sheet.` });
            }

            const sheetId = sheet.properties.sheetId;
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId,
                requestBody: {
                    requests: [
                        {
                            deleteSheet: {
                                sheetId: sheetId
                            }
                        }
                    ]
                }
            });
            res.json({ success: true, message: `Đã xóa tab "${tabName}" trên Google Sheet.` });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
}

module.exports = {
    getAllRows,
    getRowsNoteOn,
    getRowsByNote,
    getRowsFromTab,
    updateTabFieldByMatch,
    updateNoteByGmail,
    updateNoteAndDateRestore,
    updateNoteAndDateAppeal,
    updatePhone,
    update2FAKey,
    registerSheetRoutes,
};
