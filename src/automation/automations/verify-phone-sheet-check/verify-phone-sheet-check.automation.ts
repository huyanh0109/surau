import { Page } from 'puppeteer-core';
import { AutomationEngine } from '../../engines/automation.engine';
import { AutomationJob, AutomationResult } from '../../types/automation-job';
import { LogStreamService } from '../../../log-stream/log-stream.service';
import axios from '../../../axios-fetch';

export class VerifyPhoneSheetCheckAutomation implements AutomationEngine {
    name = 'verify-phone-sheet-check';

    async run(page: Page, job: AutomationJob, signal?: AbortSignal, logger?: LogStreamService): Promise<AutomationResult> {
        console.log(`🚀[Profile ${job.profileId}] Starting verify - phone - sheet - check automation`);
        try {
            if (signal?.aborted) {
                console.log(`⏹️[Profile ${job.profileId}] Automation stopped by signal`);
                return { profileId: job.profileId, success: false, error: 'Stopped' };
            }

            const { sheetRow } = job;

            if (!sheetRow?.Phone) {
                console.error(`❌[Profile ${job.profileId}] Missing Phone in sheetRow`);
                throw new Error('Missing Phone in sheetRow');
            }

            // 1. Kiểm tra xem ô nhập số điện thoại có tồn tại không
            console.log(`🔍[Profile ${job.profileId}] Checking for phone input field...`);
            const phoneInputSelector = '#phoneNumberId';
            const phoneInputExists = await page.$(phoneInputSelector);

            if (!phoneInputExists) {
                console.error(`❌[Profile ${job.profileId}] Phone input field does not exist`);
                throw new Error('Phone input field does not exist');
            }
            console.log(`✅[Profile ${job.profileId}] Phone input field found`);

            const phone = sheetRow.Phone;
            console.log(`🔍[Profile ${job.profileId}] Checking phone: ${phone} `);

            // Xóa nội dung cũ trong input
            console.log(`🧹[Profile ${job.profileId}] Clearing phone input field...`);
            await page.click(phoneInputSelector, { clickCount: 3 });
            await page.keyboard.press('Backspace');

            // Nhập số điện thoại
            console.log(`⌨️[Profile ${job.profileId}] Typing phone: ${phone} `);
            await page.type(phoneInputSelector, phone, { delay: 10 });

            // Đợi 100ms sau khi nhập xong
            console.log(`⏱️[Profile ${job.profileId}] Waiting 100ms after typing...`);
            await new Promise(resolve => setTimeout(resolve, 100));

            // Click nút Next để trigger validation
            console.log(`🖱️[Profile ${job.profileId}] Looking for Next button(1st click)...`);
            try {
                // Tìm button Next - có thể là button hoặc div clickable
                const nextButton = await page.waitForSelector('button:not([disabled])', { visible: true, timeout: 5000 });

                if (nextButton) {
                    console.log(`✅[Profile ${job.profileId}] Next button found, scrolling into view...`);
                    // Scroll vào view để đảm bảo visible
                    await nextButton.evaluate(el => el.scrollIntoView({ block: 'center' }));
                    await new Promise(resolve => setTimeout(resolve, 200));

                    // Click
                    console.log(`🖱️[Profile ${job.profileId}] Clicking Next button(1st time)...`);
                    await nextButton.click();
                    console.log(`✅[Profile ${job.profileId}] Next button clicked successfully`);
                }
            } catch (err: any) {
                console.warn(`⚠️[Profile ${job.profileId}] Could not click Next button: ${err.message} `);
            }

            // Đợi 1 giây thay vì 2 giây để Google hiển thị error (nếu có)
            console.log(`⏱️[Profile ${job.profileId}] Waiting 1s for error messages...`);
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Kiểm tra xem có lỗi không
            console.log(`🔍[Profile ${job.profileId}] Checking for error messages after 1st click...`);
            const isInvalid = await this.checkIfPhoneInvalid(page);

            if (isInvalid) {
                console.log(`❌[Profile ${job.profileId}] Phone ${phone} is invalid(error detected after 1st click)`);
                return { profileId: job.profileId, success: false, error: 'Phone invalid based on Google check' };
            }
            console.log(`✅[Profile ${job.profileId}] No error found after 1st click, proceeding...`);

            // Nếu không có lỗi sau click Next lần 1, tiếp tục với các bước verification
            console.log(`📲[Profile ${job.profileId}] Proceeding to get verification code for ${phone}`);

            console.log(`🖱️[Profile ${job.profileId}] Looking for Next button(2nd click)...`);
            try {
                const nextButton2 = await page.waitForSelector('button[type="button"]', { visible: true, timeout: 5000 });
                if (nextButton2) {
                    console.log(`🖱️[Profile ${job.profileId}] Clicking Next button(2nd time)...`);
                    await nextButton2.click();
                    console.log(`✅[Profile ${job.profileId}] Next button(2nd) clicked successfully`);
                }
            } catch (err) {
                // Nếu không có nút bấm thứ 2 thì bỏ qua
            }

            // Chờ 1 giây
            console.log(`⏱️[Profile ${job.profileId}] Waiting 1s after 2nd click...`);
            await new Promise(resolve => setTimeout(resolve, 1000));

            if (signal?.aborted) {
                return { profileId: job.profileId, success: false, error: 'Stopped' };
            }

            // 4. Kiểm tra xem có lỗi đỏ không SAU KHI CLICK NEXT LẦN 2
            console.log(`🔍[Profile ${job.profileId}] Checking for errors after 2nd click...`);
            const hasErrorAfterClick = await this.checkIfPhoneInvalid(page);
            if (hasErrorAfterClick) {
                console.log(`❌[Profile ${job.profileId}] Phone ${phone} has error after clicking Next(2nd)`);
                return { profileId: job.profileId, success: false, error: 'Phone invalid after 2nd submit' };
            }
            console.log(`✅[Profile ${job.profileId}] No error found after 2nd click`);

            // 6. Gọi API để lấy verification code từ số điện thoại chính xác
            console.log(`📞[Profile ${job.profileId}] Calling API to get verification code for ${phone}...`);
            const verificationCode = await this.getVerificationCode(phone, job.profileId.toString());

            if (!verificationCode) {
                console.error(`❌[Profile ${job.profileId}] Failed to get verification code`);
                throw new Error('Failed to get verification code from API');
            }
            console.log(`✅[Profile ${job.profileId}] Got verification code: ${verificationCode} `);

            // 7. Điền verification code vào input
            console.log(`⌨️[Profile ${job.profileId}] Waiting for code input field...`);
            // verify-phone-sheet code form
            await page.waitForSelector('[aria-label="Enter code"], [aria-label="Enter the code"]', { visible: true, timeout: 30000 });
            console.log(`⌨️[Profile ${job.profileId}] Typing verification code: ${verificationCode} `);

            // Try typing into whichever code input matched
            let inputSelector = '[aria-label="Enter code"]';
            try {
                const elements = await page.$$('xpath///*[@aria-label="Enter the code"]');
                if (elements.length > 0) inputSelector = '[aria-label="Enter the code"]';
            } catch (e) { }

            await page.type(inputSelector, verificationCode, { delay: 20 });

            // Delay 1 giây
            console.log(`⏱️[Profile ${job.profileId}] Waiting 1s after typing code...`);
            await new Promise(resolve => setTimeout(resolve, 1000));

            if (signal?.aborted) {
                console.log(`⏹️[Profile ${job.profileId}] Stopped by signal before submit`);
                return { profileId: job.profileId, success: false, error: 'Stopped' };
            }

            // 8. Click nút submit
            console.log(`🖱️[Profile ${job.profileId}] Looking for submit button...`);
            let submitButton: any = null;
            let clickMethod = '';

            try {
                console.log(`🔍[Profile ${job.profileId}] Method 1: Using XPATH from verify - phone - sheet...`);
                submitButton = await page.waitForSelector('xpath///*[@id="idvPreregisteredPhoneNext"]/div/button', { visible: true, timeout: 3000 });
                clickMethod = 'xpath';
            } catch (err) {
            }

            if (!submitButton) {
                try {
                    console.log(`🔍[Profile ${job.profileId}] Method 2: Looking for button with jsname = "V67Aae"...`);
                    submitButton = await page.waitForSelector('button[jsname="V67Aae"]', { visible: true, timeout: 3000 });
                    clickMethod = 'jsname-selector';
                } catch (err) {
                }
            }

            if (!submitButton) {
                try {
                    console.log(`🔍[Profile ${job.profileId}] Method 3: Looking for any enabled button...`);
                    submitButton = await page.waitForSelector('button:not([disabled])', { visible: true, timeout: 3000 });
                    clickMethod = 'enabled-button';
                } catch (err) {
                    console.log(`⚠️[Profile ${job.profileId}] Method 3 failed, trying next method...`);
                }
            }

            if (!submitButton) {
                try {
                    console.log(`🔍[Profile ${job.profileId}] Method 4: Looking for button using evaluate...`);
                    const clicked = await page.evaluate(() => {
                        const buttons = Array.from(document.querySelectorAll('button'));
                        const nextButton = buttons.find(btn => {
                            const text = btn.textContent?.trim().toLowerCase();
                            return text === 'next' && !btn.disabled;
                        });

                        if (nextButton) {
                            nextButton.click();
                            return true;
                        }
                        return false;
                    });

                    if (clicked) {
                        clickMethod = 'evaluate-click';
                        console.log(`✅[Profile ${job.profileId}] Clicked button using evaluate`);
                    }
                } catch (err) {
                }
            }

            // Nếu tìm thấy submitButton, click nó
            if (submitButton && !clickMethod.includes('evaluate')) {
                try {
                    console.log(`🖱️[Profile ${job.profileId}] Clicking submit button using ${clickMethod}...`);
                    await submitButton.click();
                    console.log(`✅[Profile ${job.profileId}] Submit button clicked successfully`);
                } catch (err: any) {
                    console.warn(`⚠️[Profile ${job.profileId}] Failed to click button: ${err.message} `);
                    await page.evaluate(() => {
                        const buttons = Array.from(document.querySelectorAll('button'));
                        const nextButton = buttons.find(btn => btn.textContent?.trim().toLowerCase() === 'next' && !btn.disabled);
                        if (nextButton) nextButton.click();
                    });
                }
            } else if (!clickMethod) {
                console.error(`❌[Profile ${job.profileId}] Could not find or click submit button with any method`);
                throw new Error('Could not find submit button');
            }

            // Chờ xác minh thành công
            console.log(`⏱️[Profile ${job.profileId}] Waiting 2s for verification...`);
            await new Promise(resolve => setTimeout(resolve, 2000));

            // 10. (Đã bỏ theo yêu cầu: Không điền Note 'done' vào sheet nữa)
            // if (sheetRow?.Gmail) {
            //     console.log(`📊[Profile ${ job.profileId }] Updating sheet for Gmail: ${ sheetRow.Gmail } `);
            //     await this.updateSheetAfterVerification(sheetRow.Gmail);
            // } else {
            //     console.log(`⚠️[Profile ${ job.profileId }] No Gmail found in sheetRow, skipping sheet update`);
            // }

            console.log(`🎉[Profile ${job.profileId}] Phone verification check completed successfully!`);
            return {
                profileId: job.profileId,
                success: true,
                data: {
                    phone: phone,
                    code: verificationCode,
                    message: 'Phone verified and checked successfully!'
                },
            };
        } catch (error: any) {
            console.error(`💥[Profile ${job.profileId}] Automation failed with error: ${error?.message} `);
            return {
                profileId: job.profileId,
                success: false,
                error: error?.message,
            };
        }
    }

    /**
     * Kiểm tra xem có error message nào trên page không
     */
    private async checkIfPhoneInvalid(page: Page): Promise<boolean> {
        try {
            const hasError = await page.evaluate(() => {
                const bodyText = document.body.innerText || '';
                const errorKeywords = [
                    'can\'t be used for verification',
                    'cannot be used for verification',
                    'too many unsuccessful attempts',
                    'Use another phone number',
                ];
                for (const keyword of errorKeywords) {
                    if (bodyText.includes(keyword)) {
                        console.log(`✓ Found error: "${keyword}"`);
                        return true;
                    }
                }
                return false;
            });

            if (hasError) console.log(`🔴 Error message detected on page`);
            else console.log(`✅ No error message detected on page`);

            return hasError;
        } catch (error: any) {
            console.error(`❌ Error checking phone validity: `, error.message);
            return false;
        }
    }

    /**
     * Gọi API để lấy verification code với retry
     */
    private async getVerificationCode(phoneNumber: string, profileId: string): Promise<string> {
        const apiUrl = `http://localhost:3500/phone/lookup?number=${encodeURIComponent(phoneNumber)}`;
        console.log(`🌐 [Profile ${profileId}] API URL: ${apiUrl}`);
        const maxRetries = 5;
        let attempt = 0;
        let lastError: any = null;

        while (attempt < maxRetries) {
            attempt++;
            console.log(`🔄 [Profile ${profileId}] Verification code attempt ${attempt}/${maxRetries}`);
            try {
                const response = await fetch(apiUrl);

                if (response.status === 500) {
                    lastError = new Error('API returned 500 error');
                    if (attempt < maxRetries) {
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        continue;
                    }
                    break;
                }

                const responseText = await response.text();
                let data;
                try {
                    data = JSON.parse(responseText);
                } catch (parseError) {
                    lastError = new Error(`Invalid JSON response: ${responseText}`);
                    if (attempt < maxRetries) {
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        continue;
                    }
                    break;
                }

                if (data.code) {
                    return data.code;
                } else {
                    lastError = new Error(`API response missing code field. Response keys: ${Object.keys(data).join(', ')}`);
                    if (attempt < maxRetries) {
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        continue;
                    }
                }
            } catch (error: any) {
                lastError = error;
                if (attempt >= maxRetries) break;
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }

        const errorMsg = lastError?.message || 'Unknown error';
        throw new Error(`Failed to get verification code after ${maxRetries} attempts: ${errorMsg}`);
    }

    /**
     * Lấy ngày hiện tại GMT+7
     */
    private getCurrentDateGMT7(): string {
        const now = new Date();
        const gmt7 = new Date(now.getTime() + (7 * 60 * 60 * 1000));
        const day = gmt7.getUTCDate();
        const month = gmt7.getUTCMonth() + 1;
        const year = String(gmt7.getUTCFullYear()).slice(-2);
        return `${day}/${month}/${year}`;
    }

    /**
     * Update Google Sheet
     */
    private async updateSheetAfterVerification(gmail: string): Promise<void> {
        try {
            const currentDate = this.getCurrentDateGMT7();
            const apiUrl = `http://localhost:3500/sheet/update-note-and-date`;

            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    gmail,
                    note: 'done',
                    dateRestore: currentDate,
                }),
            });

            if (!response.ok) {
                console.warn(`⚠️ Failed to update sheet for ${gmail}`);
            }
        } catch (error: any) {
            console.error(`❌ Error updating sheet: ${error.message}`);
        }
    }
}
