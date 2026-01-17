import { sheets_v4 } from 'googleapis';
import { PhoneRow } from './phone.types';

export class PhoneSheetReader {
    constructor(
        private readonly sheets: sheets_v4.Sheets,
        private readonly spreadsheetId: string,
        private readonly sheetName: string,
    ) { }

    async getAllRows(): Promise<PhoneRow[]> {
        const res = await this.sheets.spreadsheets.values.get({
            spreadsheetId: this.spreadsheetId,
            // Sử dụng range cụ thể để đọc tất cả rows, kể cả dòng trống
            range: `${this.sheetName}!A2:E1000`,
        });

        const values = res.data.values || [];
        // console.log(`📊 Google Sheets API returned ${values.length} rows from range ${this.sheetName}!A2:E1000`);

        const mapped = values.map((row, index) => ({
            rowIndex: index + 2,
            PhoneNumber: row[0] || '',
            Api: row[1] || '',
            DateTime: row[2] || '',
            LastUse: row[3] || '',
            Owner: row[4] || '',
        }));

        // Count phones with non-empty PhoneNumber
        const nonEmpty = mapped.filter(p => p.PhoneNumber && p.PhoneNumber.trim() !== '');
        // console.log(`📱 Found ${nonEmpty.length} phones with non-empty PhoneNumber`);

        return mapped;
    }

    async findByPhone(phoneNumber: string): Promise<PhoneRow | null> {
        const rows = await this.getAllRows();
        return rows.find(r => r.PhoneNumber === phoneNumber) || null;
    }
}
