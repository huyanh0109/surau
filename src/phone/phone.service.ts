import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { GoogleSheetClient } from '../google-sheet/google-sheet.client';
import { PhoneSheetReader } from './phone.reader';
import { PhoneSheetWriter } from './phone.writer';

@Injectable()
export class PhoneService {
    private readonly reader: PhoneSheetReader;
    private readonly writer: PhoneSheetWriter;

    constructor() {
        const sheets = GoogleSheetClient.create();
        const spreadsheetId = process.env.GOOGLE_SHEET_ID!;
        const sheetName = process.env.GOOGLE_SHEET_NAME!; // RentPhone

        this.reader = new PhoneSheetReader(sheets, spreadsheetId, sheetName);
        this.writer = new PhoneSheetWriter(sheets, spreadsheetId, sheetName);
    }

    /**
     * Get current datetime in GMT+7
     */
    private getCurrentDateTimeGMT7(): string {
        const now = new Date();
        // Convert to GMT+7
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
     * Extract verification code from text
     */
    private extractCode(text: string): string | null {
        if (!text || text === 'No code') return null;

        // Pattern 1: G-XXXXXX format (Google)
        const googlePattern = /G-(\d{6})/;
        const googleMatch = text.match(googlePattern);
        if (googleMatch) return googleMatch[1];

        // Pattern 2: 6-digit code anywhere in text
        const digitPattern = /\b(\d{6})\b/;
        const digitMatch = text.match(digitPattern);
        if (digitMatch) return digitMatch[1];

        // Pattern 3: 4-8 digit code patterns
        const codePattern = /\b(\d{4,8})\b/;
        const codeMatch = text.match(codePattern);
        if (codeMatch) return codeMatch[1];

        return null;
    }

    /**
     * Normalize phone number by removing all non-digit characters
     * Example: (440) 378-2789 -> 4403782789
     */
    private normalizePhoneNumber(phoneNumber: string): string {
        return phoneNumber.replace(/\D/g, '');
    }

    /**
     * Tìm số điện thoại trong sheet và gọi API từ cột B
     */
    async lookupAndCallApi(phoneNumber: string): Promise<any> {
        // Normalize phone number (remove spaces, dashes, parentheses, etc.)
        const normalizedPhone = this.normalizePhoneNumber(phoneNumber);
        const row = await this.reader.findByPhone(normalizedPhone);

        if (!row) {
            throw new HttpException(
                { error: 'Phone number not found', phone: normalizedPhone },
                HttpStatus.NOT_FOUND,
            );
        }

        if (!row.Api) {
            throw new HttpException(
                { error: 'No API configured for this phone', phone: phoneNumber },
                HttpStatus.BAD_REQUEST,
            );
        }

        // Gọi API từ cột B
        try {
            const response = await fetch(row.Api, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
            });

            // Check if response is JSON
            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                const text = await response.text();

                throw new HttpException(
                    {
                        statusCode: 500,
                        message: 'API returned invalid response, try again',
                    },
                    HttpStatus.INTERNAL_SERVER_ERROR,
                );
            }

            const data = await response.json();

            // Extract code from text if available
            let code = '';
            if (data.text) {
                code = this.extractCode(data.text) || '';
            }

            // Always include code field
            data.code = code;

            // Update LastUse if code is received
            if (code) {
                const currentDateTime = this.getCurrentDateTimeGMT7();
                await this.writer.updateLastUse(row.rowIndex, currentDateTime);
            }

            return data;
        } catch (error: any) {
            // If already HttpException, rethrow it
            if (error instanceof HttpException) {
                throw error;
            }

            // Other errors
            throw new HttpException(
                {
                    error: 'Failed to call API',
                    phone: phoneNumber,
                    api: row.Api,
                    message: error?.message
                },
                HttpStatus.INTERNAL_SERVER_ERROR,
            );
        }
    }

    /**
     * Lấy tất cả rows
     */
    async getAllPhones() {
        return this.reader.getAllRows();
    }

    /**
     * Lấy danh sách số điện thoại có thể dùng
     * - Chỉ lấy số có LastUse > X ngày
     * - Tối đa Y số
     */
    async getAvailablePhones(daysSinceLastUse: number = 5, limit: number = 50) {
        const allPhones = await this.reader.getAllRows();
        const now = new Date();

        // console.log(`📋 [getAvailablePhones] Total phones from sheet: ${allPhones.length}, looking for ${limit} phones with LastUse > ${daysSinceLastUse} days`);

        // Filter phones by LastUse date
        const available = allPhones.filter(phone => {
            // Skip if PhoneNumber is empty
            if (!phone.PhoneNumber || phone.PhoneNumber.trim() === '') {
                return false;
            }

            if (!phone.LastUse) {
                // If no LastUse, consider it available
                return true;
            }

            try {
                // Parse LastUse date (format: YYYY-MM-DD HH:mm:ss)
                const lastUseDate = new Date(phone.LastUse);
                const diffTime = now.getTime() - lastUseDate.getTime();
                const diffDays = diffTime / (1000 * 60 * 60 * 24);

                return diffDays > daysSinceLastUse;
            } catch (error) {
                // If parsing fails, consider it available
                return true;
            }
        });

        // console.log(`✅ Available phones after filter: ${available.length}`);
        // console.log(`📦 Returning top ${Math.min(limit, available.length)} phones:`);

        const result = available.slice(0, limit);
        // result.forEach((phone, idx) => {
        //     console.log(`  ${idx + 1}. ${phone.PhoneNumber} (LastUse: ${phone.LastUse || 'empty'})`);
        // });

        // Return max limit phones
        return result;
    }
}
