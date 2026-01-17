import { sheets_v4 } from 'googleapis';

export class GoogleSheetWriter {
    constructor(
        private readonly sheets: sheets_v4.Sheets,
        private readonly spreadsheetId: string,
        private readonly sheetName: string,
    ) { }

    async updateCell(row: number, col: string, value: string) {
        await this.sheets.spreadsheets.values.update({
            spreadsheetId: this.spreadsheetId,
            range: `${this.sheetName}!${col}${row}`,
            valueInputOption: 'RAW',
            requestBody: {
                values: [[value]],
            },
        });
    }

    async updateCellAsDate(row: number, col: string, value: string) {
        await this.sheets.spreadsheets.values.update({
            spreadsheetId: this.spreadsheetId,
            range: `${this.sheetName}!${col}${row}`,
            valueInputOption: 'USER_ENTERED', // Để Google Sheets tự parse date
            requestBody: {
                values: [[value]],
            },
        });
    }
}
