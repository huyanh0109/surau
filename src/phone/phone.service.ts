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

        // Pattern 1: G-XXXXXX format (Google) - find all and get the last one
        const googleMatches = text.match(/G-(\d{6})/g);
        if (googleMatches && googleMatches.length > 0) {
            const lastMatch = googleMatches[googleMatches.length - 1];
            const m = lastMatch.match(/G-(\d{6})/);
            if (m) return m[1];
        }

        // Pattern 2: 6-digit code - find all and get the last one
        const sixDigitMatches = text.match(/\b(\d{6})\b/g);
        if (sixDigitMatches && sixDigitMatches.length > 0) {
            return sixDigitMatches[sixDigitMatches.length - 1];
        }

        // Pattern 3: 4-8 digit fallback - find all and get the last one
        const anyCodeMatches = text.match(/\b(\d{4,8})\b/g);
        if (anyCodeMatches && anyCodeMatches.length > 0) {
            return anyCodeMatches[anyCodeMatches.length - 1];
        }

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

            // Read response as text first to handle both JSON and plain text
            const responseText = await response.text();
            let data: any = {};
            let isError = false;

            try {
                // Try to parse as JSON (for existing API)
                data = JSON.parse(responseText);
            } catch (e) {
                // If not JSON, it might be the new API (text/plain)
                // Check for specific error format: {"message":"error","status":"fail"}|2026-03-04
                if (responseText.includes('{"message":"error"') && responseText.includes('"status":"fail"')) {
                    isError = true;
                    // Try to parse the JSON part if needed, or just handle as error
                } else {
                    // Assume it's a success text response
                    data = { text: responseText };
                }
            }

            // Check for error/fail status from JSON or identified error
            if (isError || (data.status && data.status === 'fail')) {
                throw new HttpException(
                    {
                        statusCode: 500,
                        message: 'API returned error or no code yet',
                        rawResponse: responseText
                    },
                    HttpStatus.INTERNAL_SERVER_ERROR,
                );
            }

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

            if (!phone.LastUse || phone.LastUse.trim() === '') {
                // If no LastUse, consider it available (never used)
                return true;
            }

            try {
                // Try to parse LastUse date
                // Handle formats: YYYY-MM-DD HH:mm:ss, DD/MM/YYYY HH:mm:ss, etc.
                let lastUseDate: Date;
                const dateStr = phone.LastUse.trim();

                // Check for DD/MM/YYYY format (common in sheets)
                // Regex for DD/MM/YYYY or D/M/YYYY
                const dmyMatch = dateStr.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);

                if (dmyMatch) {
                    // Extract parts
                    const day = parseInt(dmyMatch[1]);
                    const month = parseInt(dmyMatch[2]) - 1; // Month is 0-indexed in JS
                    const year = parseInt(dmyMatch[3]);
                    const hour = dmyMatch[4] ? parseInt(dmyMatch[4]) : 0;
                    const min = dmyMatch[5] ? parseInt(dmyMatch[5]) : 0;
                    const sec = dmyMatch[6] ? parseInt(dmyMatch[6]) : 0;

                    lastUseDate = new Date(year, month, day, hour, min, sec);
                } else {
                    // Try standard parser
                    lastUseDate = new Date(dateStr);
                }

                // Check if date is valid
                if (isNaN(lastUseDate.getTime())) {
                    console.warn(`⚠️ [Filter] Invalid LastUse date for ${phone.PhoneNumber}: "${phone.LastUse}" -> Treating as UNAVAILABLE to be safe`);
                    return false; // Skip invalid dates to avoid reusing recently used phones with bad format
                }

                const diffTime = now.getTime() - lastUseDate.getTime();
                const diffDays = diffTime / (1000 * 60 * 60 * 24);

                // Debug log for phones that are close to the limit (e.g. < 10 days)
                // if (diffDays < 10) {
                //     console.log(`ℹ️ [Filter] Phone ${phone.PhoneNumber}: LastUse=${phone.LastUse}, Diff=${diffDays.toFixed(2)} days`);
                // }

                return diffDays > daysSinceLastUse;
            } catch (error) {
                console.error(`❌ [Filter] Error parsing date for ${phone.PhoneNumber}: ${error}`);
                // If parsing fails definitely, consider it unavailable to be safe
                return false;
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
