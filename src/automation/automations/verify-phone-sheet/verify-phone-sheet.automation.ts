import { Page } from 'puppeteer-core';
import { AutomationEngine } from '../../engines/automation.engine';
import { AutomationJob, AutomationResult } from '../../types/automation-job';

export class VerifyPhoneSheetAutomation implements AutomationEngine {
    name = 'verify-phone-sheet';

    async run(page: Page, job: AutomationJob, signal?: AbortSignal): Promise<AutomationResult> {
        try {
            const { sheetRow } = job;

            if (!sheetRow?.Phone) {
                throw new Error('Missing Phone in sheetRow');
            }

            if (signal?.aborted) {
                return { profileId: job.profileId, success: false, error: 'Stopped' };
            }

            // 1. Tìm và click button[type="button"]
            await page.waitForSelector('button[type="button"]', { visible: true, timeout: 10000 });
            await page.click('button[type="button"]');

            // 2. Đợi 5 giây
            await new Promise(resolve => setTimeout(resolve, 5000));

            if (signal?.aborted) {
                return { profileId: job.profileId, success: false, error: 'Stopped' };
            }

            // 3. Gọi API phone để lấy verification code (với retry)
            const phoneNumber = sheetRow.Phone;
            const apiUrl = `http://localhost:3000/phone/lookup?number=${encodeURIComponent(phoneNumber)}`;
            let verificationCode = '';
            const maxRetries = 5;
            let attempt = 0;
            let lastError: any = null;

            while (attempt < maxRetries) {
                attempt++;
                try {
                    const response = await fetch(apiUrl);

                    // Nếu lỗi 500, retry
                    if (response.status === 500) {
                        console.warn(`⚠️ [Profile ${job.profileId}] API returned 500 (attempt ${attempt}/${maxRetries})`);
                        lastError = new Error('API returned 500 error');

                        if (attempt < maxRetries) {
                            console.log(`🔄 [Profile ${job.profileId}] Retrying in 2 seconds...`);
                            continue; // Retry
                        }
                        break; // Max retries reached
                    }

                    const data = await response.json();

                    if (data.code) {
                        verificationCode = data.code;
                        break; // Success, exit loop
                    } else {
                        throw new Error('No verification code received from API');
                    }
                } catch (error: any) {
                    lastError = error;
                    console.error(`❌ [Profile ${job.profileId}] API call failed: ${error.message}`);

                    // Nếu không phải lỗi 500 hoặc đã hết retry, throw error
                    if (attempt >= maxRetries) {
                        break;
                    }
                }
            }

            // Nếu sau tất cả retry vẫn không có code, throw error
            if (!verificationCode) {
                throw new Error(`Failed to get verification code after ${maxRetries} attempts: ${lastError?.message}`);
            }

            if (signal?.aborted) {
                return { profileId: job.profileId, success: false, error: 'Stopped' };
            }

            // 4. Điền verification code vào input
            await page.waitForSelector('[aria-label="Enter the code"]', { visible: true, timeout: 30000 });
            await page.type('[aria-label="Enter the code"]', verificationCode, { delay: 20 });

            // 5. Delay 1 giây
            await new Promise(resolve => setTimeout(resolve, 1000));

            if (signal?.aborted) {
                return { profileId: job.profileId, success: false, error: 'Stopped' };
            }

            // 6. Click nút submit bằng XPath
            const submitButton = await page.waitForSelector('xpath///*[@id="idvPreregisteredPhoneNext"]/div/button', { visible: true, timeout: 10000 });
            if (submitButton) {
                await submitButton.click();
            }

            // 7. Chờ xác minh thành công
            await new Promise(resolve => setTimeout(resolve, 2000));

            // 8. Update Google Sheet (Note và DateRestore)
            if (sheetRow?.Gmail) {
                await this.updateSheetAfterVerification(sheetRow.Gmail);
            }

            return {
                profileId: job.profileId,
                success: true,
                data: {
                    phone: phoneNumber,
                    code: verificationCode,
                    message: 'Phone verified!'
                },
            };
        } catch (error: any) {
            return {
                profileId: job.profileId,
                success: false,
                error: error?.message,
            };
        }
    }

    /**
     * Lấy ngày hiện tại theo định dạng D/M/YY (GMT+7)
     * Ví dụ: 6/1/26
     */
    private getCurrentDateGMT7(): string {
        const now = new Date();
        // Convert to GMT+7
        const gmt7 = new Date(now.getTime() + (7 * 60 * 60 * 1000));

        const day = gmt7.getUTCDate(); // Không padding, để tự nhiên như 6 thay vì 06
        const month = gmt7.getUTCMonth() + 1; // Tháng bắt đầu từ 0
        const year = String(gmt7.getUTCFullYear()).slice(-2); // Lấy 2 chữ số cuối của năm

        return `${day}/${month}/${year}`;
    }

    /**
     * Update Google Sheet sau khi verify thành công
     */
    private async updateSheetAfterVerification(gmail: string): Promise<void> {
        try {
            const currentDate = this.getCurrentDateGMT7();
            const apiUrl = `http://localhost:3000/sheet/update-note-and-date`;

            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    gmail,
                    note: 'done',
                    dateRestore: currentDate,
                }),
            });

            if (response.ok) {
                // console.log(`✅ Updated sheet for ${gmail}: Note=done, DateRestore=${currentDate}`);
            } else {
                console.warn(`⚠️ Failed to update sheet for ${gmail}`);
            }
        } catch (error: any) {
            console.error(`❌ Error updating sheet: ${error.message}`);
        }
    }
}
