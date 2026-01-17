import { sheets_v4 } from 'googleapis';
import { SheetRow } from './google-sheet.types';

export class GoogleSheetReader {
    constructor(
        private readonly sheets: sheets_v4.Sheets,
        private readonly spreadsheetId: string,
        private readonly sheetName: string,
    ) { }

    async getAllRows(): Promise<SheetRow[]> {
        const res = await this.sheets.spreadsheets.values.get({
            spreadsheetId: this.spreadsheetId,
            range: `${this.sheetName}!A2:F`,
        });

        const values = res.data.values || [];

        return values.map((row, index) => ({
            rowIndex: index + 2,
            Gmail: row[0] || '',
            PassWord: row[1] || '',
            Recover: row[2] || '',
            Phone: row[3] || '',
            Owner: row[4] || '',
            Note: row[5] || '',
        }));
    }

    async getRowsNoteOn(): Promise<SheetRow[]> {
        const rows = await this.getAllRows();

        return rows.filter(
            r => r.Note?.toString().trim().toLowerCase() === 'on',
        );
    }
}
