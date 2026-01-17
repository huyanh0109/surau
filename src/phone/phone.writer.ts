import { sheets_v4 } from 'googleapis';

export class PhoneSheetWriter {
    constructor(
        private readonly sheets: sheets_v4.Sheets,
        private readonly spreadsheetId: string,
        private readonly sheetName: string,
    ) { }

    /**
     * Update LastUse (column D) for a specific row
     */
    async updateLastUse(rowIndex: number, datetime: string): Promise<void> {
        await this.sheets.spreadsheets.values.update({
            spreadsheetId: this.spreadsheetId,
            range: `${this.sheetName}!D${rowIndex}`,
            valueInputOption: 'RAW',
            requestBody: {
                values: [[datetime]],
            },
        });
    }
}
