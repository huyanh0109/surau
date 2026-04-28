import { Page } from 'puppeteer-core';
import { AutomationEngine } from '../../engines/automation.engine';
import { AutomationJob, AutomationResult } from '../../types/automation-job';
import { LogStreamService } from '../../../log-stream/log-stream.service';
import { generateSync } from 'otplib';
import axios from '../../../axios-fetch';
import * as dotenv from 'dotenv';
dotenv.config();

export class LoginCaptchaRetryAutomation implements AutomationEngine {
    name = 'login-captcha-retry';

    async run(page: Page, job: AutomationJob, signal?: AbortSignal, logger?: LogStreamService): Promise<AutomationResult> {
        try {
            const { sheetRow } = job;
            const apiKey = process.env.CAPSMONTER_KEY;

            if (!sheetRow?.Gmail || !sheetRow?.PassWord) {
                throw new Error('Missing Gmail or Password in sheetRow');
            }

            if (!apiKey) {
                throw new Error('Missing CAPSMONTER_KEY in environment variables');
            }

            let loginAttempts = 0;
            const maxLoginAttempts = 10; // Thử lại tối đa 10 lần

            while (loginAttempts < maxLoginAttempts) {
                if (signal?.aborted) return { profileId: job.profileId, success: false, error: 'Stopped' };

                loginAttempts++;
                console.log(`[Profile ${job.profileId}] === Bắt đầu vòng lặp đăng nhập (Lần ${loginAttempts}/${maxLoginAttempts}) ===`);

                // 1. Mở trang login
                await page.goto('https://accounts.google.com/v3/signin/identifier?authuser=0&continue=https%3A%2F%2Fone.google.com%2F&ec=GAlAywM&hl=en_GB&flowName=GlifWebSignIn&flowEntry=AddSession&dsh=S1778782401%3A1705652493426088&theme=glif', {
                    waitUntil: 'networkidle2',
                });

                if (signal?.aborted) return { profileId: job.profileId, success: false, error: 'Stopped' };

                // 2. Nhập email
                await page.waitForSelector('input[type="email"]', { timeout: 30000 });
                // Có thể trang bắt nhập email lại, xóa trắng trước
                await page.evaluate(() => {
                    const el = document.querySelector('input[type="email"]') as HTMLInputElement;
                    if (el) el.value = '';
                });
                await page.type('input[type="email"]', sheetRow.Gmail, { delay: 10 });
                await page.click('#identifierNext');

                if (signal?.aborted) return { profileId: job.profileId, success: false, error: 'Stopped' };

                // 3. Đợi xem màn hình tiếp theo là: Nhập Mật Khẩu, hay là Giải CAPTCHA, hay là Lỗi "Couldn't sign you in"
                let nextStep = '';
                let waitAttempt = 0;

                while (waitAttempt < 15) { // Đợi tối đa 15s để xem UI chuyển thành gì
                    if (signal?.aborted) return { profileId: job.profileId, success: false, error: 'Stopped' };

                    const currentStatus = await page.evaluate(() => {
                        // Bắt lỗi đỏ
                        const errorMsgText = document.body.innerText;
                        if (errorMsgText.includes("Couldn't sign you in") || errorMsgText.includes("Something went wrong")) {
                            return 'BLOCKED';
                        }
                        // Bắt trường Password
                        if (document.querySelector('input[type="password"]')) {
                            // Cần check xem nó có bị ẩn không (display: none)
                            const pwNode = document.querySelector('input[type="password"]');
                            const style = window.getComputedStyle(pwNode!);
                            if (style.display !== 'none' && style.visibility !== 'hidden') {
                                return 'PASSWORD';
                            }
                        }
                        // Bắt trường Captcha
                        const iframe = document.querySelector('iframe[src*="recaptcha"]');
                        const dataSiteKey = document.querySelector('[data-sitekey]');
                        if (iframe || dataSiteKey) {
                            return 'CAPTCHA';
                        }
                        return 'WAITING';
                    });

                    if (currentStatus !== 'WAITING') {
                        nextStep = currentStatus;
                        break;
                    }

                    await new Promise(resolve => setTimeout(resolve, 1000));
                    waitAttempt++;
                }

                console.log(`[Profile ${job.profileId}] UI Step detected: ${nextStep}`);

                if (nextStep === 'BLOCKED') {
                    console.log(`[Profile ${job.profileId}] Bị Google chặn (Couldn't sign you in). Reset và thử lại...`);
                    await new Promise(resolve => setTimeout(resolve, 3000)); // Nghỉ 3s trước khi loop quay lại
                    continue; // Quay lại đầu vòng lặp while
                }

                if (nextStep === 'CAPTCHA') {
                    console.log(`[Profile ${job.profileId}] Trúng CAPTCHA! Bắt đầu giải bằng CapMonster API...`);

                    const captchaSuccess = await this.solveCaptchaWithCapMonster(page, job.profileId, apiKey, signal);

                    if (!captchaSuccess) {
                        console.log(`[Profile ${job.profileId}] Giải Captcha thất bại. Thử lại toàn bộ luồng...`);
                        await new Promise(resolve => setTimeout(resolve, 3000));
                        continue; // Thuộc về captcha error, thử lại loop
                    }

                    console.log(`[Profile ${job.profileId}] Đã vượt CAPTCHA xong, đợi 5s xem có lỗi chặn Không thể đăng nhập không...`);
                    // Đợi UI sau captcha load (có thể ra mk, có thể bị chặn tiếp)
                    await new Promise(resolve => setTimeout(resolve, 5000));

                    const postCaptchaBlocked = await page.evaluate(() => {
                        return document.body.innerText.includes("Couldn't sign you in") || document.body.innerText.includes("Something went wrong");
                    });

                    if (postCaptchaBlocked) {
                        console.log(`[Profile ${job.profileId}] Bị chặn sau khi giải CAPTCHA (Trust Score yếu). Làm lại từ đầu...`);
                        await new Promise(resolve => setTimeout(resolve, 3000));
                        continue;
                    }

                    // Nếu qua được captcha thì chờ mk
                    console.log(`[Profile ${job.profileId}] Có vẻ qua được CAPTCHA, đi tiếp tới nhập Mật khẩu`);
                }

                // --------- BƯỚC 4: NHẬP PASSWORD -------------
                // Lúc này có thể UI đã hiển thị input password
                try {
                    await page.waitForSelector('input[type="password"]', { visible: true, timeout: 15000 });
                } catch {
                    // Nếu không thấy password thì check lại lỗi chặn
                    const isBlocked = await page.evaluate(() => {
                        return document.body.innerText.includes("Couldn't sign you in") || document.body.innerText.includes("Something went wrong");
                    });
                    if (isBlocked) {
                        console.log(`[Profile ${job.profileId}] Gặp màn hình Couldn't sign you in lúc đợi password. Chạy lại vòng lặp...`);
                        continue;
                    } else {
                        throw new Error("Không thấy ô nhập Password và cũng không thấy lỗi!");
                    }
                }

                await new Promise(resolve => setTimeout(resolve, 1000));
                await page.evaluate(() => {
                    const el = document.querySelector('input[type="password"]') as HTMLInputElement;
                    if (el) el.value = '';
                });
                await page.type('input[type="password"]', sheetRow.PassWord, { delay: 10 });
                await new Promise(resolve => setTimeout(resolve, 500));
                await page.click('#passwordNext', { clickCount: 2, delay: 100 });

                await new Promise(resolve => setTimeout(resolve, 2000));

                // Bỏ qua Save password
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
                } catch { }

                if (signal?.aborted) return { profileId: job.profileId, success: false, error: 'Stopped' };

                // --------- BƯỚC 5: XÁC MINH BẢO MẬT (2FA/RECOVER) -------------
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
                    } else {
                        try {
                            const twoFAOption = await page.waitForSelector('[data-challengeid="3"]', { visible: true, timeout: 5000 });
                            if (twoFAOption) {
                                await twoFAOption.evaluate(el => el.scrollIntoView({ block: 'center' }));
                                await new Promise(resolve => setTimeout(resolve, 500));
                                await twoFAOption.click();
                                await new Promise(resolve => setTimeout(resolve, 2000));
                            }
                        } catch { }

                        await page.waitForSelector('[type="tel"]', { visible: true, timeout: 10000 });
                        const code = this.generate2FACode(sheetRow.Recover);
                        await page.type('[type="tel"]', code, { delay: 10 });
                        await new Promise(resolve => setTimeout(resolve, 500));
                        await this.clickNextButton(page);
                    }
                } catch (error: any) {
                    // Không yêu cầu 2FA
                }

                // --------- KIỂM TRA ĐĂNG NHẬP THÀNH CÔNG -------------
                try {
                    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
                } catch (error: any) { }

                const finalUrl = page.url();
                if (finalUrl.includes('myaccount') || finalUrl.includes('one.google.com') || finalUrl.includes('myactivity')) {
                    console.log(`[Profile ${job.profileId}] ĐĂNG NHẬP HOÀN TOÀN THÀNH CÔNG!`);
                    return {
                        profileId: job.profileId,
                        success: true,
                        data: { gmail: sheetRow.Gmail, message: 'Đăng nhập thành công qua Captcha!' },
                    };
                }

                const checkFinalBlock = await page.evaluate(() => {
                    return document.body.innerText.includes("Couldn't sign you in") || document.body.innerText.includes("Something went wrong");
                });

                if (checkFinalBlock) {
                    console.log(`[Profile ${job.profileId}] Bị chặn ở bước cuối cùng sau khi Login. Thử lại từ đầu!`);
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    continue;
                } else {
                    console.log(`[Profile ${job.profileId}] URL cuối lạ: ${finalUrl}, nhưng không thấy lỗi. Tạm kết thúc thành công.`);
                    return {
                        profileId: job.profileId,
                        success: true,
                        data: { gmail: sheetRow.Gmail, message: 'Done nhưng chưa redirect chuẩn' },
                    };
                }
            } // end while

            throw new Error(`Đã thử ${maxLoginAttempts} lần nhưng Google vẫn chặn.`);

        } catch (error: any) {
            console.error(`❌ [Profile ${job.profileId}] Lỗi Auto-Retry Login:`, error.message);
            return {
                profileId: job.profileId,
                success: false,
                error: error?.message,
            };
        }
    }


    /**
     * Tách logic giải CAPTCHA thành hàm riêng để gọn code
     */
    private async solveCaptchaWithCapMonster(page: Page, profileId: string | number, apiKey: string, signal?: AbortSignal): Promise<boolean> {
        try {
            console.log(`[Profile ${profileId}] [CAPTCHA] Đợi CapMonster Extension tự giải trong 120s...`);

            let solved = false;
            for (let p = 0; p < 60; p++) {
                if (signal?.aborted) return false;
                await new Promise(r => setTimeout(r, 2000));

                try {
                    const status = await page.evaluate(() => {
                        // 1. Kiểm tra textarea g-recaptcha-response đã có token chưa
                        const textareas = document.querySelectorAll('textarea[name="g-recaptcha-response"], textarea.g-recaptcha-response');
                        for (const ta of Array.from(textareas)) {
                            if ((ta as HTMLTextAreaElement).value && (ta as HTMLTextAreaElement).value.length > 20) {
                                return 'solved';
                            }
                        }

                        // 2. Kiểm tra lỗi đỏ (verify / wrong)
                        const errDiv = document.querySelector('.L0Zxb, .o6cuMc, [aria-live="assertive"]');
                        if (errDiv && (errDiv.textContent?.includes('verify') || errDiv.textContent?.includes('wrong'))) {
                            return 'error';
                        }

                        // 3. Nếu iframe captcha biến mất hoàn toàn => đã qua
                        const stillExists = document.querySelector('.g-recaptcha, iframe[src*="recaptcha"]');
                        if (!stillExists) return 'solved';

                        return 'waiting';
                    });

                    if (status === 'solved') {
                        solved = true;
                        break;
                    }
                    if (status === 'error') {
                        console.log(`[Profile ${profileId}] [CAPTCHA] Extension giải sai, reset widget...`);
                        await this.resetCaptchaWidget(page);
                        // Tiếp tục chờ extension giải lại
                    }
                } catch (err) { }
            }

            if (!solved) {
                console.log(`[Profile ${profileId}] [CAPTCHA] Quá 120s chờ Extension. Reset widget...`);
                await this.resetCaptchaWidget(page);
                return false;
            }

            console.log(`[Profile ${profileId}] [CAPTCHA] Extension đã giải xong! Kiểm tra trang hiện tại...`);
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Bấm Next nếu không có trường nhập pass
            try {
                const isPasswordVisible = await page.evaluate(() => {
                    const pwNode = document.querySelector('input[type="password"]');
                    if (pwNode) {
                        const style = window.getComputedStyle(pwNode);
                        return style.display !== 'none' && style.visibility !== 'hidden';
                    }
                    return false;
                });

                if (isPasswordVisible) {
                    console.log(`[Profile ${profileId}] [CAPTCHA] Đã thấy ô nhập Password trên màn hình, KHÔNG bấm NEXT để nhập pass trước.`);
                } else {
                    await page.evaluate(() => {
                        const buttons = Array.from(document.querySelectorAll('button, div[role="button"]:not([aria-hidden="true"])'));
                        for (const btn of buttons) {
                            const text = btn.textContent?.trim().toLowerCase() || '';
                            if (text === 'next' || text === 'tiếp theo' || text === 'tiếp tục' || text === 'continue') {
                                if (!(btn as HTMLButtonElement).disabled && btn.getAttribute('aria-disabled') !== 'true') {
                                    (btn as HTMLElement).click();
                                    return;
                                }
                            }
                        }
                    });
                    console.log(`[Profile ${profileId}] [CAPTCHA] Đã click nút NEXT.`);
                }
            } catch (ignore) { }

            return true;
        } catch (e: any) {
            console.log(`[Profile ${profileId}] [CAPTCHA] Lỗi không xử lý được:`, e.message);
            return false;
        }
    }


    // ====== Các hàm Helper cũ của Google Login ======

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

    private async resetCaptchaWidget(page: Page): Promise<void> {
        try {
            await page.evaluate(() => {
                const win = window as any;
                if (typeof win.grecaptcha !== 'undefined') {
                    try { win.grecaptcha.reset(); } catch { }
                }
                if (typeof win.grecaptcha?.enterprise !== 'undefined') {
                    try { win.grecaptcha.enterprise.reset(); } catch { }
                }
            });
            await page.evaluate(() => {
                const iframes = Array.from(document.querySelectorAll('iframe'));
                for (const iframe of iframes) {
                    const src = iframe.src || '';
                    if (src.includes('recaptcha')) {
                        iframe.src = src;
                    }
                }
            });
            await new Promise(resolve => setTimeout(resolve, 2000));
        } catch { }
    }
}
