import { Page } from 'puppeteer-core';
import { AutomationEngine } from '../../engines/automation.engine';
import { AutomationJob, AutomationResult } from '../../types/automation-job';
import { generateSync } from 'otplib';

export class LoginGoogleAutomation implements AutomationEngine {
    name = 'login-google';

    async run(page: Page, job: AutomationJob, signal?: AbortSignal): Promise<AutomationResult> {
        try {
            const { sheetRow } = job;

            if (!sheetRow?.Gmail || !sheetRow?.PassWord) {
                throw new Error('Missing Gmail or Password in sheetRow');
            }

            if (signal?.aborted) {
                return { profileId: job.profileId, success: false, error: 'Stopped' };
            }

            // 1. Mở trang login
            await page.goto('https://accounts.google.com/v3/signin/identifier?authuser=0&continue=https%3A%2F%2Fone.google.com%2F&ec=GAlAywM&hl=en_GB&flowName=GlifWebSignIn&flowEntry=AddSession&dsh=S1778782401%3A1705652493426088&theme=glif', {
                waitUntil: 'networkidle2',
            });

            if (signal?.aborted) {
                return { profileId: job.profileId, success: false, error: 'Stopped' };
            }

            // 2. Nhập email
            await page.waitForSelector('input[type="email"]', { timeout: 30000 });
            await page.type('input[type="email"]', sheetRow.Gmail, { delay: 10 });
            await page.click('#identifierNext');

            if (signal?.aborted) {
                return { profileId: job.profileId, success: false, error: 'Stopped' };
            }

            // 3. Chờ và nhập password
            await page.waitForSelector('input[type="password"]', { visible: true, timeout: 300000 });
            await new Promise(resolve => setTimeout(resolve, 2000));
            await page.type('input[type="password"]', sheetRow.PassWord, { delay: 10 });
            await page.click('#passwordNext');

            // Đợi trang load sau khi nhập password 
            await new Promise(resolve => setTimeout(resolve, 2000));
            if (signal?.aborted) {
                return { profileId: job.profileId, success: false, error: 'Stopped' };
            }

            // 4. Xác minh qua Email hoặc 2FA
            try {
                // Kiểm tra Recover là email hay 2FA secret
                const isEmailRecovery = this.isEmail(sheetRow.Recover);

                if (isEmailRecovery) {
                    // ===== LUỒNG EMAIL KHÔI PHỤC =====
                    const recoveryOption = await page.waitForSelector('[data-challengetype="12"]', { visible: true, timeout: 10000 });

                    if (recoveryOption) {
                        await recoveryOption.evaluate(el => el.scrollIntoView({ block: 'center' }));
                        await new Promise(resolve => setTimeout(resolve, 500));
                        await recoveryOption.click();
                    }

                    // Đợi trang chuyển sau khi click
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    // Nhập email khôi phục
                    await page.waitForSelector('[name="knowledgePreregisteredEmailResponse"]', { visible: true, timeout: 10000 });
                    await page.type('[name="knowledgePreregisteredEmailResponse"]', sheetRow.Recover, { delay: 10 });
                    await new Promise(resolve => setTimeout(resolve, 500));

                    // Click nút Next
                    await this.clickNextButton(page);
                } else {
                    // ===== LUỒNG 2FA =====
                    // Thử click tùy chọn 2FA nếu có
                    try {
                        const twoFAOption = await page.waitForSelector('[data-challengeid="3"]', { visible: true, timeout: 5000 });
                        if (twoFAOption) {
                            await twoFAOption.evaluate(el => el.scrollIntoView({ block: 'center' }));
                            await new Promise(resolve => setTimeout(resolve, 500));
                            await twoFAOption.click();
                            await new Promise(resolve => setTimeout(resolve, 2000));
                        }
                    } catch {
                        // Không có [data-challengeid="3"], chuyển thẳng đến ô nhập
                    }

                    // Tìm ô nhập mã TOTP
                    await page.waitForSelector('[type="tel"]', { visible: true, timeout: 10000 });

                    // Tạo mã 2FA từ secret
                    const code = this.generate2FACode(sheetRow.Recover);

                    // Nhập mã vào ô
                    await page.type('[type="tel"]', code, { delay: 10 });
                    await new Promise(resolve => setTimeout(resolve, 500));

                    // Click nút Next
                    await this.clickNextButton(page);
                }
            } catch (error: any) {
                // Có thể không cần xác minh
                // console.log(error.message);
            }

            if (signal?.aborted) {
                return { profileId: job.profileId, success: false, error: 'Stopped' };
            }
            // 5. Chờ đăng nhập thành công
            try {
                await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 });
            } catch (error: any) {
                // Done
            }
            return {
                profileId: job.profileId,
                success: true,
                data: { gmail: sheetRow.Gmail, message: 'Done!' },
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
 * Kiểm tra xem chuỗi có phải email không
 */
    private isEmail(value: string): boolean {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(value);
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
            page.click('[jsname="LgbsSe"]').then(() => true).catch(() => false),
            page.click('button[type="button"]').then(() => true).catch(() => false),
        ]);

        if (!nextButtonClicked) {
            // Fallback: tìm button chứa text Next hoặc Tiếp theo
            await page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll('button'));
                const nextBtn = buttons.find(btn =>
                    btn.textContent?.includes('Next') ||
                    btn.textContent?.includes('Tiếp theo')
                );
                if (nextBtn) {
                    (nextBtn as HTMLElement).click();
                }
            });
        }
    }
}
