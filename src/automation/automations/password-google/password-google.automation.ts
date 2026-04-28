import { Page } from 'puppeteer-core';
import { AutomationEngine } from '../../engines/automation.engine';
import { AutomationJob, AutomationResult } from '../../types/automation-job';
import { LogStreamService } from '../../../log-stream/log-stream.service';
import { generateSync } from 'otplib';

export class PasswordGoogleAutomation implements AutomationEngine {
    name = 'password-google';

    async run(page: Page, job: AutomationJob, signal?: AbortSignal, logger?: LogStreamService): Promise<AutomationResult> {
        try {
            const { sheetRow } = job;

            if (!sheetRow?.PassWord) {
                throw new Error('Missing Password in sheetRow');
            }

            if (signal?.aborted) {
                return { profileId: job.profileId, success: false, error: 'Stopped' };
            }

            // Note: We skip the navigation to login page and email entry
            // This automation assumes the page is already at the password prompt.

            if (signal?.aborted) {
                return { profileId: job.profileId, success: false, error: 'Stopped' };
            }

            // 1. Chờ và nhập password
            await page.waitForSelector('input[type="password"]', { visible: true, timeout: 30000 });
            await new Promise(resolve => setTimeout(resolve, 2000));
            await page.type('input[type="password"]', sheetRow.PassWord, { delay: 10 });

            // Double click với delay để đảm bảo button được click
            await new Promise(resolve => setTimeout(resolve, 500));
            await page.click('#passwordNext', { clickCount: 2, delay: 100 });

            // Đợi trang load sau khi nhập password 
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Tự động đóng popup "Save password?" của Chrome
            try {
                await page.evaluate(() => {
                    const buttons = Array.from(document.querySelectorAll('button'));
                    const dismissBtn = buttons.find(btn =>
                        btn.textContent?.includes('Never') ||
                        btn.textContent?.includes('No thanks') ||
                        btn.textContent?.includes('Không bao giờ') ||
                        btn.textContent?.includes('Không, cảm ơn')
                    );
                    if (dismissBtn) {
                        (dismissBtn as HTMLElement).click();
                    }
                });
            } catch {
                // Ignore
            }

            if (signal?.aborted) {
                return { profileId: job.profileId, success: false, error: 'Stopped' };
            }

            // 2. Xác minh qua Email hoặc 2FA (Recovery)
            try {
                const isEmailRecovery = this.isEmail(sheetRow.Recover);

                if (isEmailRecovery) {
                    const recoveryOption = await page.waitForSelector('[data-challengetype="12"]', { visible: true, timeout: 10000 });
                    if (recoveryOption) {
                        await recoveryOption.evaluate(el => el.scrollIntoView({ block: 'center' }));
                        await new Promise(resolve => setTimeout(resolve, 500));
                        await recoveryOption.click();
                    }
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    await page.waitForSelector('[name="knowledgePreregisteredEmailResponse"]', { visible: true, timeout: 10000 });
                    await page.type('[name="knowledgePreregisteredEmailResponse"]', sheetRow.Recover, { delay: 10 });
                    await new Promise(resolve => setTimeout(resolve, 500));
                    await this.clickNextButton(page);
                } else if (sheetRow.Recover) {
                    try {
                        const twoFAOption = await page.waitForSelector('[data-challengeid="3"]', { visible: true, timeout: 5000 });
                        if (twoFAOption) {
                            await twoFAOption.evaluate(el => el.scrollIntoView({ block: 'center' }));
                            await new Promise(resolve => setTimeout(resolve, 500));
                            await twoFAOption.click();
                            await new Promise(resolve => setTimeout(resolve, 2000));
                        }
                    } catch {
                        // Skip
                    }

                    await page.waitForSelector('[type="tel"]', { visible: true, timeout: 10000 });
                    const code = this.generate2FACode(sheetRow.Recover);
                    await page.type('[type="tel"]', code, { delay: 10 });
                    await new Promise(resolve => setTimeout(resolve, 500));
                    await this.clickNextButton(page);
                }
            } catch (error: any) {
                // Verification might not be needed
            }

            if (signal?.aborted) {
                return { profileId: job.profileId, success: false, error: 'Stopped' };
            }

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

    private isEmail(value: string): boolean {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(value);
    }

    private generate2FACode(secret: string): string {
        try {
            const cleanSecret = secret.replace(/\s/g, '').toUpperCase();
            const token = generateSync({ secret: cleanSecret });
            return token;
        } catch (error: any) {
            throw new Error(`Failed to generate 2FA code: ${error.message}`);
        }
    }

    private async clickNextButton(page: Page): Promise<void> {
        const nextButtonClicked = await Promise.race([
            page.click('button:has-text("Next")').then(() => true).catch(() => false),
            page.click('[jsname="LgbsSe"]').then(() => true).catch(() => false),
            page.click('button[type="button"]').then(() => true).catch(() => false),
        ]);

        if (!nextButtonClicked) {
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
