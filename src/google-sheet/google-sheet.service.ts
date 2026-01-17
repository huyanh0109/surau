import { Injectable } from '@nestjs/common';
import { GoogleSheetClient } from './google-sheet.client';
import { GoogleSheetReader } from './google-sheet.reader';
import { GoogleSheetWriter } from './google-sheet.writer';
import { SheetRow } from './google-sheet.types';
import { ProfileStateService } from '../profile/profile-state.service';

@Injectable()
export class GoogleSheetService {
    private readonly reader: GoogleSheetReader;
    private readonly writer: GoogleSheetWriter;

    constructor(private readonly profileState: ProfileStateService) {
        const sheets = GoogleSheetClient.create();

        const spreadsheetId = process.env.GOOGLE_SHEET_ID!;
        const sheetName = process.env.GOOGLE_SHEET_NAME2!; // FactoryAccount

        this.reader = new GoogleSheetReader(
            sheets,
            spreadsheetId,
            sheetName,
        );

        this.writer = new GoogleSheetWriter(
            sheets,
            spreadsheetId,
            sheetName,
        );
    }

    /** Lấy tất cả rows */
    getAllRows(): Promise<SheetRow[]> {
        return this.reader.getAllRows();
    }

    /** Lấy rows có Note = 'on' và cache vào RAM */
    async getRowsNoteOn(): Promise<SheetRow[]> {
        const rows = await this.reader.getRowsNoteOn();
        // 💾 Lưu vào cache
        this.profileState.setSheetRows(rows);
        return rows;
    }

    markRunning(row: SheetRow) {
        return this.writer.updateCell(row.rowIndex, 'E', 'RUNNING');
    }

    markDone(row: SheetRow) {
        return this.writer.updateCell(row.rowIndex, 'E', 'DONE');
    }

    markError(row: SheetRow) {
        return this.writer.updateCell(row.rowIndex, 'E', 'ERROR');
    }

    /** Update Note (column F) by Gmail */
    async updateNoteByGmail(gmail: string, note: string): Promise<boolean> {
        const rows = await this.reader.getAllRows();
        const row = rows.find((r) => r.Gmail === gmail);

        if (!row) {
            return false;
        }

        await this.writer.updateCell(row.rowIndex, 'F', note);
        return true;
    }

    /** Update Note (column F) and DateRestore (column I) by Gmail */
    async updateNoteAndDateRestoreByGmail(
        gmail: string,
        note: string,
        dateRestore: string,
    ): Promise<boolean> {
        const rows = await this.reader.getAllRows();
        const row = rows.find((r) => r.Gmail === gmail);

        if (!row) {
            return false;
        }

        // Update both columns
        await this.writer.updateCell(row.rowIndex, 'F', note);
        await this.writer.updateCellAsDate(row.rowIndex, 'I', dateRestore); // Dùng USER_ENTERED cho date
        return true;
    }

    /** Update Note (column F) and DateAppeal (column H) by Gmail */
    async updateNoteAndDateAppealByGmail(
        gmail: string,
        note: string,
        dateAppeal: string,
    ): Promise<boolean> {
        const rows = await this.reader.getAllRows();
        const row = rows.find((r) => r.Gmail === gmail);

        if (!row) {
            return false;
        }

        // Update both columns
        await this.writer.updateCell(row.rowIndex, 'F', note);
        await this.writer.updateCellAsDate(row.rowIndex, 'H', dateAppeal); // Dùng USER_ENTERED cho date
        return true;
    }

    /** Update Phone (column D) by Gmail */
    async updatePhoneByGmail(gmail: string, phone: string): Promise<boolean> {
        const rows = await this.reader.getAllRows();
        const row = rows.find((r) => r.Gmail === gmail);

        if (!row) {
            return false;
        }

        await this.writer.updateCell(row.rowIndex, 'D', phone);
        return true;
    }
}
