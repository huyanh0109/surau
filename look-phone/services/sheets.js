const { google } = require('googleapis');
require('dotenv').config();

// Initialize Google Sheets API
// Support 2 modes:
// 1. Local: Use keyFile path from GOOGLE_APPLICATION_CREDENTIALS
// 2. Vercel/Cloud: Use JSON credentials from GOOGLE_CREDENTIALS_JSON env var
let authConfig;

if (process.env.GOOGLE_CREDENTIALS_JSON) {
    // Production mode: Parse JSON from environment variable
    try {
        const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
        authConfig = {
            credentials,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        };
    } catch (error) {
        console.error('Failed to parse GOOGLE_CREDENTIALS_JSON:', error.message);
        throw new Error('Invalid GOOGLE_CREDENTIALS_JSON format');
    }
} else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    // Local mode: Use keyFile path
    authConfig = {
        keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    };
} else {
    throw new Error('Missing Google credentials. Set either GOOGLE_CREDENTIALS_JSON or GOOGLE_APPLICATION_CREDENTIALS');
}

const auth = new google.auth.GoogleAuth(authConfig);

const sheets = google.sheets({ version: 'v4', auth });
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_NAME = process.env.GOOGLE_SHEET_NAME;

/**
 * Get all rows from Google Sheet
 * Columns: A=PhoneNumber, B=Api, C=DateTime, D=LastUse, E=Owner
 */
async function getAllRows() {
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_NAME}!A2:E5000`,
    });

    const values = res.data.values || [];
    return values.map((row, index) => ({
        rowIndex: index + 2,
        PhoneNumber: row[0] || '',
        Api: row[1] || '',
        DateTime: row[2] || '',
        LastUse: row[3] || '',
        Owner: row[4] || '',
    }));
}

/**
 * Update LastUse column (D) for a specific row
 */
async function updateLastUse(rowIndex, datetime) {
    await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_NAME}!D${rowIndex}`,
        valueInputOption: 'RAW',
        requestBody: { values: [[datetime]] },
    });
}

module.exports = { getAllRows, updateLastUse };
