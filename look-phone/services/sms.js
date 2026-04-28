const { getAllRows, updateLastUse } = require('./sheets');

/**
 * Normalize phone number - remove all non-digit characters
 */
function normalizePhone(phone) {
    return phone.replace(/\D/g, '');
}

/**
 * Check if owner matches (support multiple owners separated by |)
 */
function isOwnerMatch(rowOwner, requestedOwner) {
    if (!rowOwner) return false;

    const owners = rowOwner.split('|').map(o => o.trim());
    return owners.includes(requestedOwner);
}

/**
 * Extract verification code from text
 */
function extractCode(text) {
    if (!text || text === 'No code') return '';

    // Pattern 1: G-XXXXXX (Google format)
    const match1 = text.match(/G-(\d{6})/);
    if (match1) return match1[1];

    // Pattern 2: 6 digits
    const match2 = text.match(/\b(\d{6})\b/);
    if (match2) return match2[1];

    // Pattern 3: 4-8 digits
    const match3 = text.match(/\b(\d{4,8})\b/);
    if (match3) return match3[1];

    return '';
}

/**
 * Get current datetime in GMT+7 format
 */
function getCurrentDateTimeGMT7() {
    const now = new Date();
    const gmt7 = new Date(now.getTime() + (7 * 60 * 60 * 1000));

    const year = gmt7.getUTCFullYear();
    const month = String(gmt7.getUTCMonth() + 1).padStart(2, '0');
    const day = String(gmt7.getUTCDate()).padStart(2, '0');
    const hours = String(gmt7.getUTCHours()).padStart(2, '0');
    const minutes = String(gmt7.getUTCMinutes()).padStart(2, '0');
    const seconds = String(gmt7.getUTCSeconds()).padStart(2, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * Main SMS lookup function
 * @param {string} phone - Phone number to lookup
 * @param {string} owner - Owner identifier
 * @returns {Promise<object>} API response with code field
 */
async function lookupSMS(phone, owner) {
    // 1. Normalize phone number
    const normalizedPhone = normalizePhone(phone);

    // 2. Find phone in sheet
    const rows = await getAllRows();
    const row = rows.find(r => normalizePhone(r.PhoneNumber) === normalizedPhone);

    if (!row) {
        const error = new Error('Phone number not found');
        error.status = 404;
        throw error;
    }

    // 3. Check Owner
    if (!isOwnerMatch(row.Owner, owner)) {
        const error = new Error('Owner mismatch. Phone exists but not owned by you.');
        error.status = 403;
        throw error;
    }

    // 4. Check API configured
    if (!row.Api) {
        const error = new Error('No API configured for this phone');
        error.status = 400;
        throw error;
    }

    // 5. Call API
    const response = await fetch(row.Api);
    let originalText = await response.text();
    let expirationDate = null;
    let daysRemaining = null;

    // Tách chuỗi ngày hết hạn ở cuối (nếu có dấu |YYYY-MM-DD)
    const pipeIndex = originalText.lastIndexOf('|');
    if (pipeIndex !== -1) {
        const possibleDate = originalText.substring(pipeIndex + 1).trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(possibleDate)) {
            expirationDate = possibleDate;
            originalText = originalText.substring(0, pipeIndex).trim();

            const exp = new Date(expirationDate);
            const now = new Date();
            exp.setUTCHours(0, 0, 0, 0);
            now.setUTCHours(0, 0, 0, 0);
            const diffTime = exp.getTime() - now.getTime();
            daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        }
    }

    let data = {};
    let isError = false;

    try {
        // Cố gắng parse JSON sau khi đã tách đuôi ngày
        data = JSON.parse(originalText);
    } catch (e) {
        // Nếu không phải JSON, check xem có phải chuỗi lỗi đặc thù không
        if (originalText.includes('error') && originalText.includes('fail')) {
            isError = true;
        } else {
            // Xem như đây là text trả về thành công chuẩn
            data = { text: originalText };
        }
    }

    // Kiểm tra fail status
    if (isError || (data.status && data.status === 'fail')) {
        const error = new Error('API returned error or no code yet');
        error.status = 500;
        error.details = originalText;
        if (daysRemaining !== null) {
            error.daysRemaining = daysRemaining;
        }
        throw error;
    }

    // 6. Extract code
    const code = extractCode(data.text || '');
    data.code = code;

    // Gắn thêm ngày hết hạn vào data nếu có
    if (daysRemaining !== null) {
        data.daysRemaining = daysRemaining;
    }

    // 7. Update LastUse if code received
    if (code) {
        const datetime = getCurrentDateTimeGMT7();
        await updateLastUse(row.rowIndex, datetime);
    }

    return data;
}

module.exports = { lookupSMS };
