import { Controller, Get, Post, Body } from '@nestjs/common';
import { GoogleSheetService } from './google-sheet.service';

@Controller('sheet')
export class GoogleSheetController {
    constructor(private readonly sheetService: GoogleSheetService) { }

    // Lấy tất cả rows (không filter)
    @Get('all')
    async getAllRows() {
        const rows = await this.sheetService.getAllRows();
        return {
            total: rows.length,
            rows,
        };
    }

    // Lấy rows có Note = 'on'
    @Get('rows')
    async getRows() {
        const rows = await this.sheetService.getRowsNoteOn();
        return {
            total: rows.length,
            rows,
        };
    }

    // Update Note (column F) by Gmail
    @Post('update-note')
    async updateNoteByGmail(@Body() body: { gmail: string; note: string }) {
        const { gmail, note } = body;

        if (!gmail || !note) {
            return {
                success: false,
                error: 'Missing gmail or note in request body',
            };
        }

        const updated = await this.sheetService.updateNoteByGmail(gmail, note);

        if (!updated) {
            return {
                success: false,
                error: `Gmail ${gmail} not found in sheet`,
            };
        }

        return {
            success: true,
            gmail,
            note,
        };
    }

    // Update Note (column F) and DateRestore (column I) by Gmail
    @Post('update-note-and-date')
    async updateNoteAndDate(
        @Body() body: { gmail: string; note: string; dateRestore: string },
    ) {
        const { gmail, note, dateRestore } = body;

        if (!gmail || !note || !dateRestore) {
            return {
                success: false,
                error: 'Missing gmail, note, or dateRestore in request body',
            };
        }

        const updated = await this.sheetService.updateNoteAndDateRestoreByGmail(
            gmail,
            note,
            dateRestore,
        );

        if (!updated) {
            return {
                success: false,
                error: `Gmail ${gmail} not found in sheet`,
            };
        }

        return {
            success: true,
            gmail,
            note,
            dateRestore,
        };
    }

    // Update Note (column F) and DateAppeal (column H) by Gmail
    @Post('update-note-and-appeal')
    async updateNoteAndAppeal(
        @Body() body: { gmail: string; note: string; dateAppeal: string },
    ) {
        const { gmail, note, dateAppeal } = body;

        if (!gmail || !note || !dateAppeal) {
            return {
                success: false,
                error: 'Missing gmail, note, or dateAppeal in request body',
            };
        }

        const updated = await this.sheetService.updateNoteAndDateAppealByGmail(
            gmail,
            note,
            dateAppeal,
        );

        if (!updated) {
            return {
                success: false,
                error: `Gmail ${gmail} not found in sheet`,
            };
        }

        return {
            success: true,
            gmail,
            note,
            dateAppeal,
        };
    }

    // Update Phone (column D) by Gmail
    @Post('update-phone')
    async updatePhone(@Body() body: { gmail: string; phone: string }) {
        const { gmail, phone } = body;

        if (!gmail || !phone) {
            return {
                success: false,
                error: 'Missing gmail or phone in request body',
            };
        }

        const updated = await this.sheetService.updatePhoneByGmail(gmail, phone);

        if (!updated) {
            return {
                success: false,
                error: `Gmail ${gmail} not found in sheet`,
            };
        }

        return {
            success: true,
            gmail,
            phone,
        };
    }
}
