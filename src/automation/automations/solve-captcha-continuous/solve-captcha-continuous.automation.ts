import { Page } from 'puppeteer-core';
import { AutomationEngine } from '../../engines/automation.engine';
import { AutomationJob, AutomationResult } from '../../types/automation-job';
import { LogStreamService } from '../../../log-stream/log-stream.service';

export class SolveCaptchaContinuousAutomation implements AutomationEngine {
    name = 'solve-captcha-continuous';

    async run(page: Page, job: AutomationJob, signal?: AbortSignal, logger?: LogStreamService): Promise<AutomationResult> {
        try {
            logger?.log(`[P${job.profileId}] Bắt đầu vòng lặp quét Captcha (Extension mode)...`, 'info');
            let solvedCount = 0;

            // Vòng lặp chính đợi Captcha
            while (true) {
                if (signal?.aborted) break;

                try {
                    const currentUrl = page.url();
                    // Giới hạn chỉ chạy khi đang ở trang ReCaptcha hoặc trang chứa captcha
                    if (!currentUrl.includes('accounts.google.com/v3/signin/challenge/recaptcha') && !currentUrl.includes('recaptcha')) {
                        await new Promise(resolve => setTimeout(resolve, 5000));
                        continue;
                    }

                    // Chờ vài giây đề phòng form chưa Load xong
                    await new Promise(resolve => setTimeout(resolve, 3000));

                    // Kiểm tra xem Form captcha có tồn tại không
                    const stillExists = await page.$('.g-recaptcha, iframe[src*="recaptcha"]');
                    if (!stillExists) {
                        await new Promise(resolve => setTimeout(resolve, 3000));
                        continue;
                    }

                    // Kiểm tra xem widget có bắt lỗi đỏ lòm (Wrong / Try again)
                    const hasError = await page.evaluate(() => {
                        const errDiv = document.querySelector('.L0Zxb, .o6cuMc, [aria-live="assertive"]');
                        return errDiv ? errDiv.textContent?.includes('verify') || errDiv.textContent?.includes('wrong') : false;
                    });

                    if (hasError) {
                        logger?.log(`[P${job.profileId}] Có thông báo lỗi, Reload widget sinh mã data-s mới...`, 'warning');
                        await this.resetCaptchaWidget(page);
                        await new Promise(resolve => setTimeout(resolve, 3000));
                    }

                    // Giải bằng CapMonster Extension
                    const waitForExtension = async () => {
                        logger?.log(`[P${job.profileId}] Đợi Capmonster Extension giải Captcha tự động trong 120s...`, 'info');

                        let solved = false;
                        for (let p = 0; p < 60; p++) {
                            if (signal?.aborted) break;
                            await new Promise(r => setTimeout(r, 2000));

                            try {
                                const isResolved = await page.evaluate(() => {
                                    // 1. Kiểm tra textarea g-recaptcha-response
                                    const textareas = document.querySelectorAll('textarea[name="g-recaptcha-response"], textarea.g-recaptcha-response');
                                    for (const ta of Array.from(textareas)) {
                                        if ((ta as HTMLTextAreaElement).value && (ta as HTMLTextAreaElement).value.length > 20) {
                                            return true;
                                        }
                                    }

                                    // 2. Chặn lỗi đỏ
                                    const errDiv = document.querySelector('.L0Zxb, .o6cuMc, [aria-live="assertive"]');
                                    if (errDiv && (errDiv.textContent?.includes('verify') || errDiv.textContent?.includes('wrong'))) {
                                        return false; // Chưa qua, bị lỗi
                                    }

                                    // 3. Nếu iFrame captcha biến mất hoàn toàn
                                    const stillExists = document.querySelector('.g-recaptcha, iframe[src*="recaptcha"]');
                                    if (!stillExists) return true;

                                    return false;
                                });

                                if (isResolved) {
                                    solved = true;
                                    break;
                                }
                            } catch (err) {}
                        }

                        if (solved) {
                            logger?.log(`[P${job.profileId}] Extension đã giải xong! Đang ấn Next...`, 'success');
                            await new Promise(r => setTimeout(r, 2000));

                            try {
                                const nextResult = await page.evaluate(() => {
                                    // Check if password field is visible
                                    const pwNode = document.querySelector('input[type="password"]');
                                    if (pwNode) {
                                        const style = window.getComputedStyle(pwNode);
                                        if (style.display !== 'none' && style.visibility !== 'hidden') {
                                            return 'password_visible';
                                        }
                                    }

                                    const buttons = Array.from(document.querySelectorAll('button, div[role="button"]:not([aria-hidden="true"])'));
                                    for (const btn of buttons) {
                                        const text = btn.textContent?.trim().toLowerCase() || '';
                                        if (text === 'next' || text === 'tiếp theo' || text === 'tiếp tục' || text === 'continue') {
                                            if (!(btn as HTMLButtonElement).disabled && btn.getAttribute('aria-disabled') !== 'true') {
                                                (btn as HTMLElement).click();
                                                return 'clicked';
                                            }
                                        }
                                    }
                                    return 'not_found';
                                });
                                if (nextResult === 'clicked') logger?.log(`[P${job.profileId}] Đã nhấn Next.`, 'info');
                                else if (nextResult === 'password_visible') logger?.log(`[P${job.profileId}] Đã thấy ô Password, bỏ qua bấm Next.`, 'info');
                            } catch (e) { }

                            solvedCount++;
                        } else {
                            if (!signal?.aborted) {
                                logger?.log(`[P${job.profileId}] Quá thời gian 120s chờ Extension. Trình duyệt sẽ tự làm mới!`, 'warning');
                                await this.resetCaptchaWidget(page);
                            }
                        }

                        // Chờ một quãng nghỉ 5-10s sau khi xong trước khi vòng lặp check lại
                        await new Promise(r => setTimeout(r, 7000));
                    };

                    if (!signal?.aborted) {
                        await waitForExtension();
                    }

                } catch (err: any) {
                    const msg = err?.message || '';
                    logger?.log(`[P${job.profileId}] Error Loop: ${msg}`, 'error');
                    
                    if (msg.includes('Target closed') || msg.includes('detached') || msg.includes('Execution context was destroyed') || msg.includes('Session closed')) {
                        logger?.log(`[P${job.profileId}] Trình duyệt đã đóng. Dừng vòng lặp.`, 'warning');
                        break;
                    }
                    
                    await new Promise(resolve => setTimeout(resolve, 3000));
                }
            } // end while(true)

            return {
                profileId: job.profileId,
                success: true,
                data: { message: `Đã tự động giải ${solvedCount} CAPTCHA từ lúc bật tới lúc tắt.` },
            };

        } catch (error: any) {
            return {
                profileId: job.profileId,
                success: false,
                error: error?.message,
            };
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
                        iframe.src = src; // Reload iframe
                    }
                }
            });
            await new Promise(resolve => setTimeout(resolve, 2000));
        } catch { }
    }
}
