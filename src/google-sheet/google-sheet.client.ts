import { google, sheets_v4 } from 'googleapis';

export class GoogleSheetClient {
    static create(): sheets_v4.Sheets {
        const raw = process.env.GOOGLE_CREDENTIALS_JSON;
        if (!raw) {
            throw new Error('Missing GOOGLE_CREDENTIALS_JSON');
        }

        const credentials = JSON.parse(raw);

        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        return google.sheets({ version: 'v4', auth });
    }
}
