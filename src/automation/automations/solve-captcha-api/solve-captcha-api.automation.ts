import { Page } from 'puppeteer-core';
import { AutomationEngine } from '../../engines/automation.engine';
import { AutomationJob, AutomationResult } from '../../types/automation-job';
import { LogStreamService } from '../../../log-stream/log-stream.service';
import axios from '../../../axios-fetch';
import * as dotenv from 'dotenv';
dotenv.config();

export class SolveCaptchaApiAutomation implements AutomationEngine {
    name = 'solve-captcha-api';

    async run(page: Page, job: AutomationJob, signal?: AbortSignal, logger?: LogStreamService): Promise<AutomationResult> {
        try {
            const apiKey = process.env.CAPSMONTER_KEY;

            if (!apiKey) {
                throw new Error('Missing CAPSMONTER_KEY in environment variables');
            }

            if (signal?.aborted) {
                return { profileId: job.profileId, success: false, error: 'Stopped' };
            }

            console.log(`[Profile ${job.profileId}] [1] Bắt đầu giải ReCaptcha bằng Token API... (URL: ${page.url()})`);

            // 1. Chờ ReCaptcha iframe tải xong
            console.log(`[Profile ${job.profileId}] [2] Tìm kiếm ReCaptcha trên trang...`);

            // Chờ iframe xuất hiện
            let siteKey: string | null = null;
            let dataS: string | null = null;
            let isEnterprise = false;
            let attempts = 0;

            while (attempts < 5) { // Đợi tối đa 5 lần (5 giây) thay vì 30 lần
                if (signal?.aborted) return { profileId: job.profileId, success: false, error: 'Stopped' };

                const captchaInfo = await page.evaluate(() => {
                    // Try data-sitekey
                    const el = document.querySelector('[data-sitekey]');
                    if (el) {
                        return {
                            key: el.getAttribute('data-sitekey'),
                            s: el.getAttribute('data-s'),
                            enterprise: false
                        };
                    }

                    // Try iframe src
                    const iframes = Array.from(document.querySelectorAll('iframe'));
                    for (const iframe of iframes) {
                        const src = iframe.src || '';
                        if (src.includes('recaptcha') && src.includes('k=')) {
                            const match = src.match(/[?&]k=([^&]+)/);
                            const sMatch = src.match(/[?&]s=([^&]+)/);
                            if (match) {
                                return {
                                    key: match[1],
                                    s: sMatch ? sMatch[1] : null,
                                    enterprise: src.includes('recaptcha/enterprise')
                                };
                            }
                        }
                    }
                    return null;
                });

                if (captchaInfo && captchaInfo.key) {
                    siteKey = captchaInfo.key;
                    dataS = captchaInfo.s;
                    isEnterprise = captchaInfo.enterprise;
                    break;
                }

                await new Promise(resolve => setTimeout(resolve, 1000));
                attempts++;
            }

            if (!siteKey) {
                throw new Error('Không tìm thấy SiteKey của ReCaptcha trên trang này (đã tìm iframe và data-sitekey)');
            }

            console.log(`[Profile ${job.profileId}] [3] Đã tìm thấy SiteKey: ${siteKey}. Enterprise: ${isEnterprise}`);

            // 2. Google accounts luôn dùng Enterprise
            const currentUrl = page.url();
            const forceEnterprise = isEnterprise || currentUrl.includes('accounts.google.com') || currentUrl.includes('gds.google.com');
            const taskType = forceEnterprise ? 'RecaptchaV2EnterpriseTaskProxyless' : 'NoCaptchaTaskProxyless';

            console.log(`[Profile ${job.profileId}] [4] Gửi SiteKey tới CapMonster API (${taskType})...`);

            // Re-extract data-s ngay trước khi gửi (đảm bảo fresh nhất)
            const freshDataS = await page.evaluate(() => {
                const el = document.querySelector('[data-sitekey]');
                if (el) return el.getAttribute('data-s');
                const iframes = Array.from(document.querySelectorAll('iframe'));
                for (const iframe of iframes) {
                    const src = iframe.src || '';
                    if (src.includes('recaptcha') && src.includes('s=')) {
                        const sMatch = src.match(/[?&]s=([^&]+)/);
                        if (sMatch) return sMatch[1];
                    }
                }
                return null;
            });

            // Lấy userAgent thật của trang để CapMonster dùng, tránh bị báo lỗi fingerprint
            const userAgent = await page.evaluate(() => navigator.userAgent);

            // Lấy proxy hiện tại để dùng cho CapMonster (Google check trùng IP)
            let proxyParams: any = {};
            try {
                const proxyRes = await axios.get('http://localhost:3500/proxy/config');
                const config = proxyRes.data;
                const activeProxy = config.activeIndex === 1 ? config.proxy1 : config.proxy2;
                if (activeProxy) {
                    const parts = activeProxy.split(':');
                    if (parts.length >= 2) {
                        proxyParams = {
                            proxyType: 'http',
                            proxyAddress: parts[0],
                            proxyPort: parseInt(parts[1], 10)
                        };
                        // Hỗ trợ proxy có pass
                        if (parts.length >= 4) {
                            proxyParams.proxyLogin = parts[2];
                            proxyParams.proxyPassword = parts[3];
                        }
                    }
                }
            } catch (e) { }

            // Tính toán taskType cuối cùng
            let actualTaskType = taskType;
            if (proxyParams.proxyAddress && taskType.includes('Proxyless')) {
                actualTaskType = taskType.replace('Proxyless', ''); // Chuyển sang proxy task
            }

            const pageCookies = await page.cookies();
            const cookieString = pageCookies.map(c => `${c.name}=${c.value}`).join('; ');

            const apiDomain = await page.evaluate(() => {
                const iframes = document.querySelectorAll('iframe');
                for (const iframe of Array.from(iframes)) {
                    if (iframe.src && iframe.src.includes('recaptcha.net')) return 'www.recaptcha.net';
                }
                return '';
            });

            const pageAction = await page.evaluate(() => {
                const iframes = document.querySelectorAll('iframe');
                for (const iframe of Array.from(iframes)) {
                    const match = (iframe.src || '').match(/[?&]sa=([^&]+)/);
                    if (match) return match[1];
                }
                return 'identifier';
            });

            const taskPayload: any = { type: actualTaskType, websiteURL: currentUrl, websiteKey: siteKey, userAgent: userAgent, cookies: cookieString, pageAction: pageAction, ...proxyParams };
            if (apiDomain) taskPayload.apiDomain = apiDomain;
            
            const finalDataS = freshDataS || dataS;
            if (finalDataS) {
                if (taskType.includes('Enterprise')) {
                    taskPayload.enterprisePayload = { s: finalDataS };
                } else {
                    taskPayload.recaptchaDataSValue = finalDataS;
                }
                console.log(`[Profile ${job.profileId}] [4] Đã gắn kèm tham số phụ 'data-s' (${finalDataS.substring(0, 15)}...)`);
            }

            const createTaskResponse = await axios.post('https://api.capmonster.cloud/createTask', {
                clientKey: apiKey,
                task: taskPayload
            }, { timeout: 60000 }); // Tăng timeout tạo task lên 60s để tránh lỗi timeout of 15000ms exceeded

            if (createTaskResponse.data.errorId !== 0) {
                throw new Error(`CapMonster CreateTask Error: ${createTaskResponse.data.errorCode}`);
            }

            const taskId = createTaskResponse.data.taskId;
            console.log(`[Profile ${job.profileId}] [5] Task ID tạo thành công: ${taskId}, đạng chờ Token kết quả...`);

            // 3. Poll Lấy Token kết quả
            let gRecaptchaResponse = '';
            let pollCount = 0;
            const maxPolls = 60; // Max 120s

            while (pollCount < maxPolls) {
                if (signal?.aborted) return { profileId: job.profileId, success: false, error: 'Stopped' };

                await new Promise(resolve => setTimeout(resolve, 2000));

                try {
                    const getResultResponse = await axios.post('https://api.capmonster.cloud/getTaskResult', {
                        clientKey: apiKey,
                        taskId: taskId
                    }, { timeout: 30000 }); // Tăng timeout lấy kết quả lên 30s

                    if (getResultResponse.data.errorId !== 0) {
                        throw new Error(`CapMonster GetTaskResult Error: ${getResultResponse.data.errorCode}`);
                    }

                    if (getResultResponse.data.status === 'ready') {
                        gRecaptchaResponse = getResultResponse.data.solution.gRecaptchaResponse;
                        break;
                    } else {
                        if (pollCount % 3 === 0) {
                            console.log(`[Profile ${job.profileId}] [6] Vẫn đang giải mã... (${pollCount * 2}s)`);
                        }
                    }
                } catch (pollErr: any) {
                    console.log(`[Profile ${job.profileId}] [6_ERR] Lỗi check status: ${pollErr.message}`);
                }

                pollCount++;
            }

            if (!gRecaptchaResponse) {
                throw new Error('Hết thời gian (120s) chờ Token từ CapMonster');
            }

            console.log(`[Profile ${job.profileId}] [7] Đã lấy được Token thành công! (length: ${gRecaptchaResponse.length})`);

            // 4. Inject token vào ô [name="g-recaptcha-response"]
            console.log(`[Profile ${job.profileId}] [8] Injecting Token và giả lập Click...`);

            // Đưa token vào ô input ẩn bằng JS (KHÔNG click checkbox - sẽ gây reset token)
            await page.evaluate((token) => {
                const textareas = document.querySelectorAll('textarea[name="g-recaptcha-response"], textarea[name="g-recaptcha-response-1"], textarea.g-recaptcha-response');
                textareas.forEach(ta => {
                    (ta as HTMLTextAreaElement).value = token;
                    ta.dispatchEvent(new Event('input', { bubbles: true }));
                    ta.dispatchEvent(new Event('change', { bubbles: true }));
                });
            }, gRecaptchaResponse);

            console.log(`[Profile ${job.profileId}] [9] Đã điền Token vào Form. Đang gọi callback...`);

            console.log(`[Profile ${job.profileId}] [9] Đã điền Token vào Form.`);

            await new Promise(resolve => setTimeout(resolve, 1500));

            // 5. Gọi callback JS để báo cho widget Google
            await page.evaluate((token) => {
                try {
                    const win = window as any;
                    if (typeof win.___grecaptcha_cfg !== 'undefined' && win.___grecaptcha_cfg.clients) {
                        const clients = win.___grecaptcha_cfg.clients;
                        for (const cid in clients) {
                            for (const k1 in clients[cid]) {
                                const obj1 = clients[cid][k1];
                                if (obj1 && typeof obj1 === 'object') {
                                    if (typeof obj1.callback === 'function') {
                                        obj1.callback(token);
                                        return;
                                    }
                                    for (const k2 in obj1) {
                                        const obj2 = obj1[k2];
                                        if (obj2 && typeof obj2 === 'object' && typeof obj2.callback === 'function') {
                                            obj2.callback(token);
                                            return;
                                        }
                                    }
                                }
                            }
                        }
                    }
                } catch (ignore) { }
            }, gRecaptchaResponse);

            console.log(`[Profile ${job.profileId}] [9] Đã gọi callback xong.`);

            // 6. Kiểm tra và bấm nút Next để đi tiếp
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
                    console.log(`[Profile ${job.profileId}] [10] Đã thấy ô Mật khẩu. KHÔNG bấm NEXT để tránh submit sớm.`);
                } else {
                    const nextClicked = await page.evaluate(() => {
                        const buttons = Array.from(document.querySelectorAll('button, div[role="button"]:not([aria-hidden="true"])'));
                        for (const btn of buttons) {
                            const text = btn.textContent?.trim().toLowerCase() || '';
                            if (text === 'next' || text === 'tiếp theo' || text === 'tiếp tục' || text === 'continue') {
                                if (!(btn as HTMLButtonElement).disabled && btn.getAttribute('aria-disabled') !== 'true') {
                                    (btn as HTMLElement).click();
                                    return true;
                                }
                            }
                        }
                        return false;
                    });

                    if (nextClicked) {
                        console.log(`[Profile ${job.profileId}] [10] Đã bấm nút NEXT để đi tiếp.`);
                    } else {
                        console.log(`[Profile ${job.profileId}] [10] Không tìm thấy nút NEXT, hy vọng script khác sẽ bấm.`);
                    }
                }
            } catch (clickErr) {
                 console.log(`[Profile ${job.profileId}] [10] Lỗi bấm Next:`, clickErr);
            }

            // Đợi một chút để xem trang có load tiếp hay form submit không - Tăng lên 15 giây theo yêu cầu
            console.log(`[Profile ${job.profileId}] [DEBUG] Đã giải xong CAPTCHA, vui lòng tự bấm Next để kiểm tra... Đợi 15s`);
            await new Promise(resolve => setTimeout(resolve, 15000));

            return {
                profileId: job.profileId,
                success: true,
                data: { message: 'Đã giải ReCaptcha Token thành công!' },
            };
        } catch (error: any) {
            console.error(`❌ [Profile ${job.profileId}] Lỗi giải CAPTCHA:`, error.message);
            return {
                profileId: job.profileId,
                success: false,
                error: error?.message,
            };
        }
    }
}
