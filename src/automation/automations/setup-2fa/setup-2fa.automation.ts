import { Page } from 'puppeteer-core';
import { AutomationEngine } from '../../engines/automation.engine';
import { AutomationJob, AutomationResult } from '../../types/automation-job';
import { LogStreamService } from '../../../log-stream/log-stream.service';
import { generateSync } from 'otplib';
import { GoogleSheetClient } from '../../../google-sheet/google-sheet.client';
import { GoogleSheetReader } from '../../../google-sheet/google-sheet.reader';
import { GoogleSheetWriter } from '../../../google-sheet/google-sheet.writer';

export class Setup2FAAutomation implements AutomationEngine {
    name = 'setup-2fa';

    async run(page: Page, job: AutomationJob, signal?: AbortSignal, logger?: LogStreamService): Promise<AutomationResult> {
        try {
            if (signal?.aborted) {
                return { profileId: job.profileId, success: false, error: 'Stopped' };
            }

            // 1. Mở trang setup 2FA authenticator
            await page.goto('https://myaccount.google.com/two-step-verification/authenticator', {
                waitUntil: 'networkidle2',
                timeout: 30000,
            });

            if (signal?.aborted) {
                return { profileId: job.profileId, success: false, error: 'Stopped' };
            }

            // Chờ trang load
            await new Promise(resolve => setTimeout(resolve, 2000));

            // 2. Click vào button "Set up authenticator"
            // Có thể có nhiều cách để tìm button này, thử nhiều selector
            try {
                // Thử tìm button có text "Set up"
                const setupButton = await page.waitForSelector('button, [role="button"]', {
                    visible: true,
                    timeout: 10000
                });

                // Tìm button chứa text "Set up" hoặc "Thiết lập"
                await page.evaluate(() => {
                    const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
                    const setupBtn = buttons.find(btn =>
                        btn.textContent?.includes('Set up') ||
                        btn.textContent?.includes('Thiết lập') ||
                        btn.textContent?.includes('GET STARTED') ||
                        btn.textContent?.includes('BẮT ĐẦU')
                    );
                    if (setupBtn) {
                        (setupBtn as HTMLElement).click();
                    }
                });

                await new Promise(resolve => setTimeout(resolve, 2000));
            } catch (error: any) {
                throw new Error(`Không tìm thấy button "Set up authenticator": ${error.message}`);
            }

            if (signal?.aborted) {
                return { profileId: job.profileId, success: false, error: 'Stopped' };
            }

            // 3. Click vào "Can't scan it?"
            try {
                await new Promise(resolve => setTimeout(resolve, 500));

                let clicked = false;

                // Cách 1: Dùng XPath (do user cung cấp) - HIGHEST PRIORITY
                try {
                    const xpath = '/html/body/div[12]/div/div[2]/span/div/div/div/div[2]/center/div';

                    let elementFound = await page.evaluate((xpathExpression) => {
                        const result = document.evaluate(
                            xpathExpression,
                            document,
                            null,
                            XPathResult.FIRST_ORDERED_NODE_TYPE,
                            null
                        );
                        const element = result.singleNodeValue as HTMLElement;

                        if (element) {
                            element.scrollIntoView({ block: 'center', behavior: 'smooth' });
                            return true;
                        }
                        return false;
                    }, xpath);

                    if (elementFound) {
                        // Wait 5 giây ở phía Node.js để tránh lỗi Protocol Error
                        await new Promise(resolve => setTimeout(resolve, 5000));

                        await page.evaluate((xpathExpression) => {
                            const result = document.evaluate(
                                xpathExpression,
                                document,
                                null,
                                XPathResult.FIRST_ORDERED_NODE_TYPE,
                                null
                            );
                            const element = result.singleNodeValue as HTMLElement;

                            if (element) {
                                // Trigger mousedown/mouseup
                                element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
                                element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));

                                // Click event
                                element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));

                                // Double click
                                element.click();
                                element.click();

                                // dblclick event
                                element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window }));
                            }
                        }, xpath);

                        clicked = true;
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    }


                } catch (e) {
                }

                // Cách 2: Thử click bằng jsname attribute
                if (!clicked) {
                    try {
                        const cantScanByJsname = await page.$('[jsname="VdrAGc"]');
                        if (cantScanByJsname) {
                            await cantScanByJsname.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'smooth' }));
                            await new Promise(resolve => setTimeout(resolve, 500));
                            await cantScanByJsname.click();
                            clicked = true;
                        }
                    } catch (e) {
                    }
                }

                // Cách 3: Tìm span chứa text "Can't scan"
                if (!clicked) {
                    try {
                        const spans = await page.$$('span');
                        for (const span of spans) {
                            const text = await span.evaluate(el => el.textContent);
                            if (text && text.includes("Can't scan")) {
                                await span.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'smooth' }));
                                await new Promise(resolve => setTimeout(resolve, 500));
                                await span.click();
                                clicked = true;
                                break;
                            }
                        }
                    } catch (e) {
                    }
                }

                // Cách 4: Dùng evaluate để click trực tiếp
                if (!clicked) {
                    try {
                        const clickedViaEval = await page.evaluate(() => {
                            // Thử tìm bằng jsname
                            const byJsname = document.querySelector('[jsname="VdrAGc"]');
                            if (byJsname) {
                                (byJsname as HTMLElement).scrollIntoView({ block: 'center' });
                                (byJsname as HTMLElement).click();
                                return true;
                            }

                            // Thử tìm bằng text content
                            const allElements = Array.from(document.querySelectorAll('span, a, button, [role="button"]'));
                            const cantScanElement = allElements.find(el =>
                                el.textContent?.includes("Can't scan") ||
                                el.textContent?.includes("Không thể quét") ||
                                el.textContent?.includes("can't scan it")
                            );

                            if (cantScanElement) {
                                (cantScanElement as HTMLElement).scrollIntoView({ block: 'center' });
                                (cantScanElement as HTMLElement).click();
                                return true;
                            }

                            return false;
                        });

                        if (clickedViaEval) {
                            clicked = true;
                        }
                    } catch (e) {
                    }
                }

                if (!clicked) {
                    throw new Error('Không thể click vào "Can\'t scan it?" sau khi thử tất cả các phương pháp');
                }

                await new Promise(resolve => setTimeout(resolve, 2000));
            } catch (error: any) {
                throw new Error(`Không tìm thấy hoặc không thể click "Can't scan it?": ${error.message}`);
            }

            if (signal?.aborted) {
                return { profileId: job.profileId, success: false, error: 'Stopped' };
            }

            // 4. Copy lấy key 2FA ở mục số 2
            let secretKey = '';
            try {
                // Chờ cho secret key hiển thị - tăng delay lên 5 giây
                await new Promise(resolve => setTimeout(resolve, 5000));

                // Tìm secret key - thường nằm trong một text element hoặc code block
                secretKey = await page.evaluate(() => {

                    // Method 0: Ưu tiên dùng XPath user cung cấp
                    try {
                        const xpath = '/html/body/div[12]/div/div[2]/span/div/div/ol/li[2]/div/strong';
                        const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                        const element = result.singleNodeValue as HTMLElement;
                        if (element && element.textContent) {
                            const text = element.textContent.trim().replace(/\s/g, '');
                            // Secret key thường dài >= 16 ký tự
                            if (text.length >= 16) {
                                return text;
                            }
                        }
                    } catch (e) {
                    }

                    // Method 1: Thử tìm trong các element có chứa key
                    const selectors = [
                        'code',
                        'pre',
                        'span[data-key]',
                        'div[data-key]',
                        'div[jsname]',
                        'span.X0o8Tb', // Google's class for code
                        'div.XO8yef', // Another possible class
                        '[role="code"]'
                    ];

                    for (const selector of selectors) {
                        const elements = Array.from(document.querySelectorAll(selector));
                        for (const el of elements) {
                            const text = el.textContent?.trim();
                            // Secret key thường là chuỗi base32 (chỉ chứa A-Z và 2-7)
                            if (text && text.length >= 16 && /^[A-Z2-7\s]+$/.test(text)) {
                                return text.replace(/\s/g, ''); // Loại bỏ khoảng trắng
                            }
                        }
                    }

                    // Method 2: Tìm tất cả elements có text dài
                    const allElements = Array.from(document.querySelectorAll('*'));
                    for (const el of allElements) {
                        const text = el.textContent?.trim();
                        if (text && text.length >= 16 && text.length <= 40 && /^[A-Z2-7\s]+$/.test(text)) {
                            // Check xem có phải là element riêng lẻ không (không phải parent có nhiều children)
                            if (el.children.length === 0) {
                                return text.replace(/\s/g, '');
                            }
                        }
                    }

                    // Method 3: Fallback - tìm trong tất cả text
                    const allText = document.body.innerText;

                    const matches = allText.match(/\b([A-Z2-7]{16,})\b/);
                    if (matches && matches[1]) {
                        return matches[1];
                    }

                    return '';
                });

                if (!secretKey) {
                    throw new Error('Không tìm thấy 2FA secret key trên trang');
                }

            } catch (error: any) {
                throw new Error(`Không thể lấy 2FA secret key: ${error.message}`);
            }

            if (signal?.aborted) {
                return { profileId: job.profileId, success: false, error: 'Stopped' };
            }

            // 5. Ấn Next
            try {
                await this.clickNextButton(page);
                await new Promise(resolve => setTimeout(resolve, 2000));
            } catch (error: any) {
                throw new Error(`Không thể click Next button: ${error.message}`);
            }

            if (signal?.aborted) {
                return { profileId: job.profileId, success: false, error: 'Stopped' };
            }

            // 6. Giải key 2FA thành code rồi điền vào phần Enter Code
            try {
                // Generate TOTP code từ secret key
                const code = this.generate2FACode(secretKey);

                // Chờ ô nhập code xuất hiện
                await page.waitForSelector('input[type="tel"], input[type="text"]', {
                    visible: true,
                    timeout: 10000
                });

                // Tìm và điền code vào input
                await page.type('input[type="tel"], input[type="text"]', code, { delay: 100 });
                await new Promise(resolve => setTimeout(resolve, 1000));

                // Click Next/Submit
                await this.clickNextButton(page);
                await new Promise(resolve => setTimeout(resolve, 3000));

            } catch (error: any) {
                throw new Error(`Không thể điền hoặc submit 2FA code: ${error.message}`);
            }

            if (signal?.aborted) {
                return { profileId: job.profileId, success: false, error: 'Stopped' };
            }

            // 7. Chờ setup hoàn tất và Click "Turn on" nếu có
            try {
                await new Promise(resolve => setTimeout(resolve, 3000));

                console.log('Searching for "Turn on" button...');
                let turnOnClicked = false;

                // Cách 1: Thử tìm trực tiếp bằng selector có aria-label
                try {
                    const turnOnSelector = '[aria-label="Turn on"], [aria-label="Bật"]';
                    const turnOnBtn = await page.waitForSelector(turnOnSelector, { visible: true, timeout: 5000 });
                    if (turnOnBtn) {
                        await turnOnBtn.click();
                        turnOnClicked = true;
                        console.log('✅ Clicked "Turn on" button using aria-label selector');
                    }
                } catch (e) {
                    console.log('⚠️ Could not find "Turn on" by selector, trying fallback loop...');
                }

                // Cách 2: Fallback tìm duyệt qua tất cả buttons
                if (!turnOnClicked) {
                    turnOnClicked = await page.evaluate(() => {
                        const buttons = Array.from(document.querySelectorAll('button, [role="button"], div[role="button"]'));
                        const turnOnBtn = buttons.find(btn => {
                            const text = btn.textContent?.trim() || '';
                            const ariaLabel = btn.getAttribute('aria-label') || '';

                            return text === 'Turn on' ||
                                text === 'Bật' ||
                                ariaLabel === 'Turn on' ||
                                ariaLabel === 'Bật';
                        });

                        if (turnOnBtn) {
                            (turnOnBtn as HTMLElement).click();
                            return true;
                        }
                        return false;
                    });
                }

                if (turnOnClicked) {
                    await new Promise(resolve => setTimeout(resolve, 3000));

                    // Step 7b: Click tiếp vào "Turn on 2-Step Verification" sau khi đã bật cái trước
                    // User request: đợi 2s rồi kéo xuống ấn vào aria-label="Turn on 2-Step Verification"
                    await new Promise(resolve => setTimeout(resolve, 2000));

                    try {
                        const finalTurnOnSelector = '[aria-label="Turn on 2-Step Verification"], [aria-label="Bật tính năng Xác minh 2 bước"]';
                        const finalBtn = await page.waitForSelector(finalTurnOnSelector, { timeout: 5000 });
                        if (finalBtn) {
                            await finalBtn.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'smooth' }));
                            await new Promise(resolve => setTimeout(resolve, 1000));
                            await finalBtn.click();
                        }
                    } catch (e) {
                    }

                    // Step 7c: Click "Skip" sau khi turn on
                    // User request: ấn aria-label="Skip"
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    try {
                        const skipSelector = '[aria-label="Skip"], [aria-label="Bỏ qua"]';
                        const skipBtn = await page.waitForSelector(skipSelector, { timeout: 5000 });
                        if (skipBtn) {
                            await skipBtn.click();
                        }
                    } catch (e) {
                    }
                } else {
                    console.log('ℹ️ "Turn on" button not found (might rely on auto-redirect)');
                }

            } catch (error: any) {
                // Bỏ qua lỗi nếu không tìm thấy
                console.log('ℹ️ Error checking "Turn on" button:', error.message);
            }

            // 8. Lấy email từ profile và lưu vào Google Sheet
            let associatedEmail = '';
            let sheetUpdateStatus = 'Skipped';

            try {
                // Method 1: Dùng XPath user cung cấp
                let profileEmail = await page.evaluate(() => {
                    const xpath = '//*[@id="gb"]/div[2]/div[3]/div[1]/div[2]/div/a';
                    const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                    const element = result.singleNodeValue as HTMLElement;

                    if (element) {
                        const ariaLabel = element.getAttribute('aria-label') || '';
                        // Format: "Google Account: Name (email@gmail.com)"
                        let match = ariaLabel.match(/\(([^)]+@gmail\.com)\)/);
                        if (match && match[1]) return match[1];

                        // Thử tìm trong title
                        const title = element.getAttribute('title') || '';
                        match = title.match(/\(([^)]+@gmail\.com)\)/);
                        if (match && match[1]) return match[1];
                    }
                    return null;
                });

                if (!profileEmail) {
                    // Method 2: Fallback selector cũ
                    const profileSelector = 'a[aria-label*="Google Account"], a[aria-label*="Tài khoản Google"]';
                    try {
                        await page.waitForSelector(profileSelector, { timeout: 3000 });
                        profileEmail = await page.evaluate((selector) => {
                            const el = document.querySelector(selector);
                            if (!el) return null;
                            const ariaLabel = el.getAttribute('aria-label') || '';
                            const match = ariaLabel.match(/\(([^)]+@gmail\.com)\)/);
                            if (match && match[1]) {
                                return match[1];
                            }
                            return null;
                        }, profileSelector);
                    } catch (e) {
                    }
                }

                if (profileEmail) {
                    associatedEmail = profileEmail;

                    // Kết nối Google Sheet
                    const sheets = GoogleSheetClient.create();
                    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
                    const sheetName = process.env.GOOGLE_SHEET_NAME2; // FactoryAccount

                    if (spreadsheetId && sheetName) {
                        const reader = new GoogleSheetReader(sheets, spreadsheetId, sheetName);
                        const writer = new GoogleSheetWriter(sheets, spreadsheetId, sheetName);

                        const rows = await reader.getAllRows();
                        const row = rows.find(r => r.Gmail?.trim().toLowerCase() === associatedEmail.trim().toLowerCase());

                        if (row) {
                            await writer.updateCell(row.rowIndex, 'C', secretKey);
                            sheetUpdateStatus = `Updated row ${row.rowIndex}`;
                        } else {
                            sheetUpdateStatus = 'Email not found in sheet';
                        }
                    } else {
                        sheetUpdateStatus = 'Missing env vars';
                    }
                } else {
                    sheetUpdateStatus = 'Email extraction failed';
                }

            } catch (error: any) {
                sheetUpdateStatus = `Error: ${error.message}`;
            }

            return {
                profileId: job.profileId,
                success: true,
                data: {
                    message: `✅ Đã setup 2FA thành công! Key: ${secretKey} | Sheet: ${sheetUpdateStatus}`,
                    secretKey: secretKey,
                    url: `https://myaccount.google.com/two-step-verification/authenticator?key=${secretKey}`,
                    email: associatedEmail
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
     * Tạo mã 2FA TOTP từ secret
     */
    private generate2FACode(secret: string): string {
        try {
            // Loại bỏ khoảng trắng và chuyển thành uppercase
            const cleanSecret = secret.replace(/\s/g, '').toUpperCase();
            // Tạo TOTP code
            const token = generateSync({ secret: cleanSecret });
            return token;
        } catch (error: any) {
            throw new Error(`Failed to generate 2FA code: ${error.message}`);
        }
    }

    /**
     * Click nút Next với nhiều cách fallback
     */
    private async clickNextButton(page: Page): Promise<void> {
        const nextButtonClicked = await Promise.race([
            page.click('button:has-text("Next")').then(() => true).catch(() => false),
            page.click('button:has-text("Tiếp theo")').then(() => true).catch(() => false),
            page.click('[jsname="LgbsSe"]').then(() => true).catch(() => false),
        ]);

        if (!nextButtonClicked) {
            // Fallback: tìm button chứa text Next hoặc Tiếp theo
            await page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll('button'));
                const nextBtn = buttons.find(btn =>
                    btn.textContent?.includes('Next') ||
                    btn.textContent?.includes('Tiếp theo') ||
                    btn.textContent?.includes('NEXT') ||
                    btn.textContent?.includes('Done') ||
                    btn.textContent?.includes('Xong')
                );
                if (nextBtn) {
                    (nextBtn as HTMLElement).click();
                }
            });
        }
    }
}
