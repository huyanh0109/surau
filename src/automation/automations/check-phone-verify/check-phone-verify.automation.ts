import { Page } from 'puppeteer-core';
import { AutomationEngine } from '../../engines/automation.engine';
import { AutomationJob, AutomationResult } from '../../types/automation-job';
import { LogStreamService } from '../../../log-stream/log-stream.service';

export class CheckPhoneVerifyAutomation implements AutomationEngine {
    name = 'check-phone-verify';

    async run(page: Page, job: AutomationJob, signal?: AbortSignal, logger?: LogStreamService): Promise<AutomationResult> {
        logger?.log(`[P${job.profileId}] Starting phone check...`, 'info');
        try {
            if (signal?.aborted) {
                return { profileId: job.profileId, success: false, error: 'Stopped' };
            }

            // 1. Kiểm tra xem ô nhập số điện thoại có tồn tại không
            console.log(`🔍 [Profile ${job.profileId}] Checking for phone input field...`);
            const phoneInputSelector = '#phoneNumberId';
            const phoneInputExists = await page.$(phoneInputSelector);

            if (!phoneInputExists) {
                console.error(`❌ [Profile ${job.profileId}] Phone input field does not exist`);
                throw new Error('Phone input field does not exist');
            }
            console.log(`✅ [Profile ${job.profileId}] Phone input field found`);


            // 2. Loop để lấy và check phone cho đến khi tìm được số valid
            console.log(`🔄 [Profile ${job.profileId}] Starting phone validation loop (max 70 attempts)`);
            let usablePhone: string | null = null;
            const maxAttempts = 70 // Giới hạn số lần thử
            let attempt = 0;

            while (attempt < maxAttempts && !usablePhone) {
                if (signal?.aborted) {
                    console.log(`⏹️ [Profile ${job.profileId}] Loop stopped by signal at attempt ${attempt}`);
                    return { profileId: job.profileId, success: false, error: 'Stopped' };
                }

                attempt++;
                console.log(`
🔄 [Profile ${job.profileId}] ========== Attempt ${attempt}/${maxAttempts} ==========`);

                // Lấy số tiếp theo từ queue
                console.log(`📞 [Profile ${job.profileId}] Getting next phone from queue...`);
                const phoneData = await this.getNextPhoneFromQueue(job.profileId);

                if (!phoneData || !phoneData.phoneNumber || phoneData.phoneNumber.trim() === '') {
                    console.log(`⚠️ [Profile ${job.profileId}] No valid phone available. Stopping check loop.`);
                    break; // Dừng loop nếu không còn số
                }

                const phone = phoneData.phoneNumber;
                logger?.log(`[P${job.profileId}] Checking: ${phone}`, 'info');

                // Xóa nội dung cũ trong input
                console.log(`🧹 [Profile ${job.profileId}] Clearing phone input field...`);
                await page.click(phoneInputSelector, { clickCount: 3 });
                await page.keyboard.press('Backspace');

                // Nhập số điện thoại
                console.log(`⌨️ [Profile ${job.profileId}] Typing phone: ${phone}`);
                await page.type(phoneInputSelector, phone, { delay: 10 });

                // Đợi 500ms sau khi nhập xong
                console.log(`⏱️ [Profile ${job.profileId}] Waiting 500ms after typing...`);
                await new Promise(resolve => setTimeout(resolve, 500));

                // Click nút Next để trigger validation
                console.log(`🖱️ [Profile ${job.profileId}] Looking for Next button (1st click)...`);
                try {
                    // Tìm button Next - có thể là button hoặc div clickable
                    const nextButton = await page.waitForSelector('button:not([disabled])', { visible: true, timeout: 5000 });

                    if (nextButton) {
                        console.log(`✅ [Profile ${job.profileId}] Next button found, scrolling into view...`);
                        // Scroll vào view để đảm bảo visible
                        await nextButton.evaluate(el => el.scrollIntoView({ block: 'center' }));
                        await new Promise(resolve => setTimeout(resolve, 200));

                        // Click
                        console.log(`🖱️ [Profile ${job.profileId}] Clicking Next button (1st time)...`);
                        await nextButton.click();
                        console.log(`✅ [Profile ${job.profileId}] Next button clicked successfully`);
                    }
                } catch (err: any) {
                    console.warn(`⚠️ [Profile ${job.profileId}] Could not click Next button: ${err.message}`);
                }

                // Đợi 2 giây để Google hiển thị error (nếu có)
                console.log(`⏱️ [Profile ${job.profileId}] Waiting 2s for error messages...`);
                await new Promise(resolve => setTimeout(resolve, 2000));

                // Kiểm tra xem có lỗi không
                console.log(`🔍 [Profile ${job.profileId}] Checking for error messages after 1st click...`);
                const isInvalid = await this.checkIfPhoneInvalid(page);

                if (isInvalid) {
                    logger?.log(`[P${job.profileId}] ✗ ${phone} (Invalid)`, 'error');
                    await this.markPhoneInQueue(phone, job.profileId, false);
                    console.log(`➡️ [Profile ${job.profileId}] Continuing to next phone...`);
                    continue; // Thử số tiếp theo
                }
                console.log(`✅ [Profile ${job.profileId}] No error found after 1st click, proceeding...`);

                // Nếu không có lỗi sau click Next lần 1, tiếp tục với các bước verification
                try {
                    // 3. Click nút tiếp tục lần 2 để chuyển sang trang nhập code
                    console.log(`📲 [Profile ${job.profileId}] Proceeding to get verification code for ${phone}`);

                    console.log(`🖱️ [Profile ${job.profileId}] Looking for Next button (2nd click)...`);
                    const nextButton2 = await page.waitForSelector('button[type="button"]', { visible: true, timeout: 10000 });
                    if (nextButton2) {
                        console.log(`🖱️ [Profile ${job.profileId}] Clicking Next button (2nd time)...`);
                        await nextButton2.click();
                        console.log(`✅ [Profile ${job.profileId}] Next button (2nd) clicked successfully`);
                    }

                    // Chờ 2 giây
                    console.log(`⏱️ [Profile ${job.profileId}] Waiting 2s after 2nd click...`);
                    await new Promise(resolve => setTimeout(resolve, 2000));

                    if (signal?.aborted) {
                        return { profileId: job.profileId, success: false, error: 'Stopped' };
                    }

                    // 4. Kiểm tra xem có lỗi đỏ không SAU KHI CLICK NEXT LẦN 2
                    console.log(`🔍 [Profile ${job.profileId}] Checking for errors after 2nd click...`);
                    const hasErrorAfterClick = await this.checkIfPhoneInvalid(page);
                    if (hasErrorAfterClick) {
                        console.log(`❌ [Profile ${job.profileId}] Phone ${phone} has error after clicking Next (2nd), trying next phone...`);
                        console.log(`📝 [Profile ${job.profileId}] Marking phone ${phone} as invalid...`);
                        await this.markPhoneInQueue(phone, job.profileId, false);
                        usablePhone = null; // Reset
                        console.log(`➡️ [Profile ${job.profileId}] Continuing to next phone...`);
                        continue; // Quay lại lấy số tiếp theo
                    }
                    console.log(`✅ [Profile ${job.profileId}] No error found after 2nd click`);

                    // 5. Đọc text trên trang để lấy số điện thoại Google gửi code tới
                    console.log(`📖 [Profile ${job.profileId}] Reading page to extract phone number...`);
                    const actualPhoneFromPage = await page.evaluate(() => {
                        // Tìm text chứa số điện thoại, ví dụ: "(708) 745-7967"
                        const bodyText = document.body.innerText || '';

                        // Pattern để match số điện thoại có format (XXX) XXX-XXXX hoặc tương tự
                        const phonePattern = /\((\d{3})\)\s*(\d{3})-(\d{4})/;
                        const match = bodyText.match(phonePattern);

                        if (match) {
                            // Trả về số không có format: 7087457967
                            return match[1] + match[2] + match[3];
                        }

                        return null;
                    });

                    // Nếu không tìm thấy text có số điện thoại → quay lại check số tiếp
                    if (!actualPhoneFromPage) {
                        console.log(`⚠️ [Profile ${job.profileId}] No phone number text found on page for ${phone}, trying next phone...`);
                        console.log(`📝 [Profile ${job.profileId}] Marking phone ${phone} as invalid...`);
                        await this.markPhoneInQueue(phone, job.profileId, false);
                        usablePhone = null; // Reset
                        console.log(`➡️ [Profile ${job.profileId}] Continuing to next phone...`);
                        continue; // Quay lại lấy số tiếp theo
                    }
                    console.log(`📱 [Profile ${job.profileId}] Extracted phone from page: ${actualPhoneFromPage}`);

                    // Phone này đã pass hết các bước, sử dụng số từ trang
                    usablePhone = actualPhoneFromPage;
                    logger?.log(`[P${job.profileId}] ✓ ${usablePhone} (Valid)`, 'success');

                    // Thoát loop vì đã tìm được số hợp lệ
                    console.log(`🎯 [Profile ${job.profileId}] Valid phone found, exiting loop`);
                    break;

                } catch (error: any) {
                    console.error(`❌ [Profile ${job.profileId}] Error during verification for ${phone}: ${error.message}`);
                    console.log(`📝 [Profile ${job.profileId}] Marking phone ${phone} as invalid due to error...`);
                    await this.markPhoneInQueue(phone, job.profileId, false);
                    usablePhone = null; // Reset
                    console.log(`➡️ [Profile ${job.profileId}] Continuing to next phone after error...`);
                    continue; // Thử số tiếp theo
                }
            }

            // Nếu usablePhone vẫn null sau loop, nghĩa là không tìm được số hợp lệ
            if (!usablePhone) {
                console.error(`❌ [Profile ${job.profileId}] Could not find valid phone after ${attempt} attempts`);
                throw new Error(`Could not find valid phone after ${attempt} attempts`);
            }

            if (signal?.aborted) {
                console.log(`⏹️ [Profile ${job.profileId}] Stopped by signal before getting verification code`);
                return { profileId: job.profileId, success: false, error: 'Stopped' };
            }

            // 6. Gọi API để lấy verification code từ số điện thoại chính xác
            console.log(`📞 [Profile ${job.profileId}] Calling API to get verification code for ${usablePhone}...`);
            const verificationCode = await this.getVerificationCode(usablePhone, job.profileId.toString());

            if (!verificationCode) {
                console.error(`❌ [Profile ${job.profileId}] Failed to get verification code`);
                throw new Error('Failed to get verification code');
            }
            logger?.log(`[P${job.profileId}] Code: ${verificationCode}`, 'success');

            // 7. Điền verification code vào input
            console.log(`⌨️ [Profile ${job.profileId}] Waiting for code input field...`);
            await page.waitForSelector('[aria-label="Enter code"]', { visible: true, timeout: 30000 });
            console.log(`⌨️ [Profile ${job.profileId}] Typing verification code: ${verificationCode}`);
            await page.type('[aria-label="Enter code"]', verificationCode, { delay: 20 });

            // Delay 1 giây
            console.log(`⏱️ [Profile ${job.profileId}] Waiting 1s after typing code...`);
            await new Promise(resolve => setTimeout(resolve, 1000));

            if (signal?.aborted) {
                console.log(`⏹️ [Profile ${job.profileId}] Stopped by signal before submit`);
                return { profileId: job.profileId, success: false, error: 'Stopped' };
            }

            // 8. Click nút submit - thử nhiều cách để tìm button
            console.log(`🖱️ [Profile ${job.profileId}] Looking for submit button...`);
            let submitButton: any = null;
            let clickMethod = '';

            // Thử cách 1: Tìm button có text "Next"
            try {
                console.log(`🔍 [Profile ${job.profileId}] Method 1: Looking for button with text "Next"...`);
                submitButton = await page.waitForSelector('button::-p-text(Next)', { visible: true, timeout: 3000 });
                clickMethod = 'text-selector';
                console.log(`✅ [Profile ${job.profileId}] Found button with text "Next"`);
            } catch (err) {
                console.log(`⚠️ [Profile ${job.profileId}] Method 1 failed, trying next method...`);
            }

            // Thử cách 2: Tìm button bằng jsname="V67Aae"
            if (!submitButton) {
                try {
                    console.log(`🔍 [Profile ${job.profileId}] Method 2: Looking for button with jsname="V67Aae"...`);
                    submitButton = await page.waitForSelector('button[jsname="V67Aae"]', { visible: true, timeout: 3000 });
                    clickMethod = 'jsname-selector';
                    console.log(`✅ [Profile ${job.profileId}] Found button with jsname="V67Aae"`);
                } catch (err) {
                    console.log(`⚠️ [Profile ${job.profileId}] Method 2 failed, trying next method...`);
                }
            }

            // Thử cách 3: Tìm bất kỳ button nào không disabled
            if (!submitButton) {
                try {
                    console.log(`🔍 [Profile ${job.profileId}] Method 3: Looking for any enabled button...`);
                    submitButton = await page.waitForSelector('button:not([disabled])', { visible: true, timeout: 3000 });
                    clickMethod = 'enabled-button';
                    console.log(`✅ [Profile ${job.profileId}] Found enabled button`);
                } catch (err) {
                    console.log(`⚠️ [Profile ${job.profileId}] Method 3 failed, trying next method...`);
                }
            }

            // Thử cách 4: Tìm button bằng evaluate và click trực tiếp
            if (!submitButton) {
                try {
                    console.log(`🔍 [Profile ${job.profileId}] Method 4: Looking for button using evaluate...`);
                    const clicked = await page.evaluate(() => {
                        // Tìm tất cả button có text "Next"
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
                        console.log(`✅ [Profile ${job.profileId}] Clicked button using evaluate`);
                    } else {
                        console.log(`⚠️ [Profile ${job.profileId}] Method 4 failed - no button found`);
                    }
                } catch (err) {
                    console.log(`⚠️ [Profile ${job.profileId}] Method 4 failed with error: ${err.message}`);
                }
            }

            // Nếu tìm thấy submitButton (cách 1, 2, hoặc 3), click nó
            if (submitButton && !clickMethod.includes('evaluate')) {
                try {
                    console.log(`🖱️ [Profile ${job.profileId}] Clicking submit button using ${clickMethod}...`);
                    await submitButton.click();
                    console.log(`✅ [Profile ${job.profileId}] Submit button clicked successfully`);
                } catch (err) {
                    console.warn(`⚠️ [Profile ${job.profileId}] Failed to click button: ${err.message}`);
                    // Thử click bằng evaluate làm fallback
                    console.log(`🔍 [Profile ${job.profileId}] Trying evaluate click as fallback...`);
                    await page.evaluate(() => {
                        const buttons = Array.from(document.querySelectorAll('button'));
                        const nextButton = buttons.find(btn => btn.textContent?.trim().toLowerCase() === 'next' && !btn.disabled);
                        if (nextButton) nextButton.click();
                    });
                }
            } else if (!clickMethod) {
                console.error(`❌ [Profile ${job.profileId}] Could not find or click submit button with any method`);
                throw new Error('Could not find submit button');
            }

            // Chờ xác minh thành công
            console.log(`⏱️ [Profile ${job.profileId}] Waiting 2s for verification...`);
            await new Promise(resolve => setTimeout(resolve, 2000));

            // 9. Mark phone as valid và update Google Sheet
            await this.markPhoneInQueue(usablePhone, job.profileId, true);
            logger?.log(`[P${job.profileId}] Verified!`, 'success');

            // 10. Cập nhật cột D (Phone) trong Google Sheet nếu có Gmail
            if (job.sheetRow?.Gmail) {
                console.log(`📊 [Profile ${job.profileId}] Updating phone in Google Sheet for Gmail: ${job.sheetRow.Gmail}`);
                await this.updatePhoneInSheet(job.sheetRow.Gmail, usablePhone);
            } else {
                console.log(`⚠️ [Profile ${job.profileId}] No Gmail found in sheetRow, skipping sheet update`);
            }

            console.log(`🎉 [Profile ${job.profileId}] Phone verification completed successfully!`);
            return {
                profileId: job.profileId,
                success: true,
                data: {
                    phone: usablePhone,
                    code: verificationCode,
                    message: 'Phone verified successfully!'
                },
            };
        } catch (error: any) {
            console.error(`💥 [Profile ${job.profileId}] Automation failed with error: ${error?.message}`);
            console.error(`💥 [Profile ${job.profileId}] Error stack:`, error?.stack);
            return {
                profileId: job.profileId,
                success: false,
                error: error?.message,
            };
        }
    }

    /**
     * Lấy số tiếp theo từ queue
     */
    private async getNextPhoneFromQueue(profileId: number): Promise<{ phoneNumber: string } | null> {
        try {
            const apiUrl = `http://localhost:3500/phone/queue/next?profileId=${profileId}`;
            console.log(`🌐 [Profile ${profileId}] Calling API: ${apiUrl}`);
            const response = await fetch(apiUrl);
            const data = await response.json();
            console.log(`📦 [Profile ${profileId}] API response:`, data);

            if (data.error) {
                console.log(`⚠️ [Profile ${profileId}] No more phones: ${data.error}`);
                return null;
            }

            console.log(`✅ [Profile ${profileId}] Got phone from queue: ${data.phoneNumber}`);
            return data;
        } catch (error: any) {
            console.error(`❌ [Profile ${profileId}] Failed to get next phone from queue:`, error.message);
            return null;
        }
    }

    /**
     * Mark kết quả check phone trong queue
     */
    private async markPhoneInQueue(phoneNumber: string, profileId: number, isValid: boolean): Promise<void> {
        try {
            const apiUrl = `http://localhost:3500/phone/queue/mark`;
            console.log(`🌐 [Profile ${profileId}] Marking phone ${phoneNumber} as ${isValid ? 'VALID' : 'INVALID'}`);
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phoneNumber, profileId, isValid }),
            });
            console.log(`✅ [Profile ${profileId}] Phone marked successfully (status: ${response.status})`);
        } catch (error: any) {
            console.error(`❌ [Profile ${profileId}] Failed to mark phone in queue:`, error.message);
        }
    }

    /**
     * Kiểm tra xem có error message nào trên page không
     */
    private async checkIfPhoneInvalid(page: Page): Promise<boolean> {
        try {
            // Kiểm tra toàn bộ page body cho error message
            const hasError = await page.evaluate(() => {
                // Lấy toàn bộ text visible trên page
                const bodyText = document.body.innerText || '';

                // Các error keywords chính xác
                const errorKeywords = [
                    'can\'t be used for verification',
                    'cannot be used for verification',
                    'too many unsuccessful attempts',
                    'Use another phone number',
                ];

                // Check từng keyword
                for (const keyword of errorKeywords) {
                    if (bodyText.includes(keyword)) {
                        console.log(`✓ Found error: "${keyword}"`);
                        return true;
                    }
                }

                // Không tìm thấy error
                return false;
            });

            if (hasError) {
                console.log(`🔴 Error message detected on page`);
            } else {
                console.log(`✅ No error message detected on page`);
            }
            return hasError;
        } catch (error: any) {
            console.error(`❌ Error checking phone validity:`, error.message);
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
                console.log(`📡 [Profile ${profileId}] Fetching verification code from API...`);
                const response = await fetch(apiUrl);
                console.log(`📊 [Profile ${profileId}] API response status: ${response.status}`);

                if (response.status === 500) {
                    console.warn(`⚠️ [Profile ${profileId}] API returned 500 (attempt ${attempt}/${maxRetries})`);
                    lastError = new Error('API returned 500 error');

                    if (attempt < maxRetries) {
                        console.log(`🔄 [Profile ${profileId}] Retrying in 2 seconds...`);
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        continue;
                    }
                    break;
                }

                // Đọc response body
                const responseText = await response.text();
                console.log(`📦 [Profile ${profileId}] API raw response: ${responseText}`);

                let data;
                try {
                    data = JSON.parse(responseText);
                    console.log(`📋 [Profile ${profileId}] Parsed JSON:`, JSON.stringify(data));
                } catch (parseError) {
                    console.error(`❌ [Profile ${profileId}] Failed to parse JSON response:`, parseError);
                    lastError = new Error(`Invalid JSON response: ${responseText}`);
                    if (attempt < maxRetries) {
                        console.log(`🔄 [Profile ${profileId}] Retrying in 2 seconds...`);
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        continue;
                    }
                    break;
                }

                // Kiểm tra xem có code không
                if (data.code) {
                    console.log(`✅ [Profile ${profileId}] Got verification code: ${data.code}`);
                    return data.code;
                } else {
                    console.warn(`⚠️ [Profile ${profileId}] No code field in response. Available fields: ${Object.keys(data).join(', ')}`);
                    lastError = new Error(`API response missing code field. Response keys: ${Object.keys(data).join(', ')}`);

                    if (attempt < maxRetries) {
                        console.log(`🔄 [Profile ${profileId}] Retrying in 2 seconds...`);
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        continue;
                    }
                }
            } catch (error: any) {
                lastError = error;
                console.error(`❌ [Profile ${profileId}] API call failed: ${error.message}`);
                console.error(`❌ [Profile ${profileId}] Error stack:`, error.stack);

                if (attempt >= maxRetries) {
                    break;
                }
                console.log(`🔄 [Profile ${profileId}] Retrying in 2 seconds...`);
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }

        const errorMsg = lastError?.message || 'Unknown error';
        console.error(`💥 [Profile ${profileId}] All ${maxRetries} attempts failed. Last error: ${errorMsg}`);
        throw new Error(`Failed to get verification code after ${maxRetries} attempts: ${errorMsg}`);
    }

    /**
     * Update phone number in Google Sheet column D by Gmail
     */
    private async updatePhoneInSheet(gmail: string, phoneNumber: string): Promise<void> {
        try {
            const apiUrl = `http://localhost:3500/sheet/update-phone`;

            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    gmail,
                    phone: phoneNumber,
                }),
            });

            if (response.ok) {
                console.log(`✅ Updated phone ${phoneNumber} in sheet for ${gmail}`);
            } else {
                console.warn(`⚠️ Failed to update phone in sheet for ${gmail}`);
            }
        } catch (error: any) {
            console.error(`❌ Error updating phone in sheet: ${error.message}`);
        }
    }
}
