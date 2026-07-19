const { sleep, generate2FACode, isEmail, clickNextButton } = require('./helpers');

/**
 * THU GIAI GESTURE CAPTCHA 1 LAN DUY NHAT — TUYEN TINH, KHONG LAP LAI.
 * Neu bat ky buoc nao that bai -> return ngay, khong retry.
 * Nguoi dung co the tu giai bang nut SOLVE GESTURE neu can.
 */
async function tryGestureCaptchaOnce(page, job, signal, logger, step) {
    const log = (msg) => { logger?.(msg); console.log(`[P${job.profileId}] [Gesture] ${msg}`); };
    const solver = require('./solve-gesture-captcha-copy');

    // Cho trang on dinh
    await sleep(2000);

    let hasGesture = false;
    let hasV2Captcha = false;
    let checkboxClicked = false;
    let mainPage = page;

    // Vong lap do tim captcha va click checkbox
    for (let i = 0; i < 30; i++) {
        if (signal?.aborted) return mainPage;
        try {
            // Update page moi nhat
            const running = job.manager.runningProfiles.get(job.profileId);
            if (running?.context) {
                const pages = running.context.pages?.() || [];
                const livePage = pages.find(p => !p.isClosed());
                if (livePage) mainPage = livePage;
            }

            const currentUrl = mainPage.url();
            try {
                const parsedUrl = new URL(currentUrl);
                if (parsedUrl.hostname === 'one.google.com' || parsedUrl.hostname === 'myaccount.google.com') {
                    log(`Successfully logged in (${parsedUrl.hostname}) - no captcha.`);
                    break;
                }
            } catch (e) {}

            const frames = mainPage.frames();
            
            // Check if any frame has hand-gestures or has text indicating gesture captcha
            for (const f of frames) {
                const url = f.url();
                if (url.includes('hand-gestures')) {
                    hasGesture = true;
                    break;
                }
                if (url.includes('recaptcha')) {
                    try {
                        const text = await f.evaluate(() => {
                            return (document.body?.innerText || '').toLowerCase();
                        }).catch(() => '');
                        if (text && (text.includes('gesture') || text.includes('hand') || text.includes('camera') || 
                            text.includes('bàn tay') || text.includes('giơ') || text.includes('nắm') ||
                            text.includes('ngón') || text.includes('vẫy') || text.includes('chỉ'))) {
                            hasGesture = true;
                            break;
                        }
                    } catch (e) {}
                }
            }

            // Fallback: check using native Playwright frameLocator (cross-origin safe)
            if (!hasGesture) {
                try {
                    const hasIframe = await mainPage.evaluate(() => {
                        return !!document.querySelector('iframe[src*="recaptcha"], iframe[src*="hand-gestures"], iframe[src*="bframe"]');
                    }).catch(() => false);
                    if (hasIframe) {
                        const bodyText = await mainPage.frameLocator('iframe[src*="recaptcha"], iframe[src*="hand-gestures"], iframe[src*="bframe"]').locator('body').innerText({ timeout: 1000 }).catch(() => '');
                        if (bodyText) {
                            const text = bodyText.toLowerCase();
                            if (text.includes('gesture') || text.includes('hand') || text.includes('camera') || 
                                text.includes('bàn tay') || text.includes('giơ') || text.includes('nắm') ||
                                text.includes('ngón') || text.includes('vẫy') || text.includes('chỉ')) {
                                hasGesture = true;
                                break;
                            }
                        }
                    }
                } catch (e) {}
            }

            if (hasGesture) {
                log(`[detect] GESTURE CAPTCHA. Frames: ${frames.map(f => f.url().substring(0, 60)).join(' | ')}`);
                break;
            }

            // Auto-click reCAPTCHA checkbox if visible and unchecked
            try {
                const hasAnchorIframe = await mainPage.evaluate(() => {
                    return !!document.querySelector('iframe[src*="anchor"]');
                }).catch(() => false);
                if (hasAnchorIframe) {
                    const checkbox = mainPage.frameLocator('iframe[src*="anchor"]').locator('#recaptcha-anchor');
                    if (await checkbox.isVisible({ timeout: 1000 }).catch(() => false)) {
                        const ariaChecked = await checkbox.getAttribute('aria-checked', { timeout: 1000 }).catch(() => 'false');
                        if (ariaChecked !== 'true' && !checkboxClicked) {
                            log('[detect] reCAPTCHA checkbox visible and unchecked. Clicking it...');
                            await checkbox.click();
                            checkboxClicked = true;
                            await sleep(3000);
                            continue;
                        }
                    }
                }
            } catch (e) {}

            // reCAPTCHA v2: co iframe recaptcha
            hasV2Captcha = (currentUrl.includes('challenge') || currentUrl.includes('recaptcha')) &&
                frames.some(f => f.url().includes('recaptcha'));

            // Check early exit based on the step we are waiting for (Chỉ thoát sớm khi không bị khóa bởi captcha)
            const nextStepVisible = await mainPage.evaluate((step) => {
                const isVisible = (el) => {
                    return !!(el && (el.offsetWidth > 0 || el.offsetHeight > 0 || el.getBoundingClientRect().width > 0));
                };
                if (step === 'email') {
                    const email = document.querySelector('input[type="email"]');
                    if (isVisible(email)) return true;
                }
                if (step === 'password') {
                    const pwd = document.querySelector('input[type="password"]');
                    if (isVisible(pwd)) return true;
                }
                if (step === 'post-login') {
                    const code2fa = document.querySelector('input[type="tel"], input#totpPin, input[autocomplete="one-time-code"]');
                    if (isVisible(code2fa)) return true;
                    const recovery = document.querySelector('[name="knowledgePreregisteredEmailResponse"]');
                    if (isVisible(recovery)) return true;
                }
                return false;
            }, step).catch(() => false);

            if (nextStepVisible && !hasV2Captcha) {
                log(`Next step input (${step}) visible - no captcha.`);
                break;
            }
        } catch (e) {}
        await sleep(500);
    }

    if (!hasGesture) {
        if (hasV2Captcha) log('reCAPTCHA v2 detected - khong tu dong giai, bo qua gesture solver.');
        else log('Khong phat hien gesture captcha, tiep tuc.');
        return mainPage;
    }

    log('Phat hien Gesture Captcha! Bat dau tu dong giai bang solve-gesture-captcha-copy...');

    // Goi run tu solve-gesture-captcha-copy.js
    const result = await solver.run(mainPage, job, signal, log);
    if (result.success) {
        log(`Gesture da giai thanh cong!`);
    } else {
        log(`Giai gesture that bai: ${result.error || ''}`);
    }

    // Tra ve page moi nhat
    try {
        const running = job.manager.runningProfiles.get(job.profileId);
        if (running?.context) {
            const pages = running.context.pages?.() || [];
            const livePage = pages.find(p => !p.isClosed());
            if (livePage) return livePage;
        }
    } catch (e) {}
    return mainPage;
}

/**
 * Login Google
 */
async function run(page, job, signal, logger) {
    const log = (msg) => { logger?.(msg); console.log(`[P${job.profileId}] ${msg}`); };
    try {
        const { sheetRow } = job;
        if (!sheetRow?.Gmail || !sheetRow?.PassWord) return { profileId: job.profileId, success: false, error: 'Thieu Gmail hoac Password' };

        if (signal?.aborted) return { profileId: job.profileId, success: false, error: 'Stopped' };

        // 1. Mo trang login
        await page.goto('https://accounts.google.com/v3/signin/identifier?authuser=0&continue=https%3A%2F%2Fone.google.com%2F&ec=GAlAywM&hl=en_GB&flowName=GlifWebSignIn&flowEntry=AddSession&theme=glif', {
            waitUntil: 'domcontentloaded'
        });

        // Thu giai Gesture Captcha neu xuat hien ngay khi load trang
        page = await tryGestureCaptchaOnce(page, job, signal, logger, 'email');

        // Đợi một chút xem có bị redirect do đã đăng nhập sẵn không
        await sleep(2000);
        const currentUrl = page.url();
        try {
            const parsedUrl = new URL(currentUrl);
            if ((parsedUrl.hostname === 'one.google.com' && !parsedUrl.pathname.includes('/about')) || parsedUrl.hostname === 'myaccount.google.com') {
                log('✅ Profile đã đăng nhập Google từ trước (Đang ở trang Google One/MyAccount).');
                return { profileId: job.profileId, success: true, data: { gmail: sheetRow.Gmail, message: 'Already logged in' } };
            }
        } catch (e) {}

        // 2. Nhap email
        const emailSelector = 'input[type="email"], input[name="identifier"], input#identifierId';
        try {
            await page.waitForSelector(emailSelector, { timeout: 15000 });
        } catch (err) {
            const path = require('path');
            const screenshotPath = path.join(process.cwd(), `screenshot_failed_${job.profileId}.png`);
            try {
                await page.screenshot({ path: screenshotPath });
                log(`📸 Đã chụp ảnh lỗi lưu tại: ${screenshotPath}`);
            } catch (ssErr) {
                log(`Không thể chụp ảnh lỗi: ${ssErr.message}`);
            }

            const pageUrl = page.url();
            const pageTitle = await page.title().catch(() => 'Không rõ');
            log(`❌ Không tìm thấy ô nhập Email. URL hiện tại: ${pageUrl} | Tiêu đề: ${pageTitle}`);

            if (pageUrl.includes('chrome-error://') || pageUrl.includes('neterror')) {
                throw new Error('Không thể tải trang Google. Vui lòng kiểm tra lại kết nối mạng hoặc Proxy của profile.');
            } else if (pageTitle.includes('secure') || pageTitle.includes('bảo mật') || pageTitle.toLowerCase().includes('signin')) {
                throw new Error('Google chặn đăng nhập (Device/Browser not secure) hoặc yêu cầu giải captcha trước.');
            } else {
                throw new Error(`Lỗi tải trang Google Login: ${err.message}`);
            }
        }

        await page.locator(emailSelector).first().type(sheetRow.Gmail, { delay: 10 });
        await page.locator('#identifierNext').click();

        // Thu giai Gesture Captcha 1 lan (neu co).
        page = await tryGestureCaptchaOnce(page, job, signal, logger, 'password');

        if (signal?.aborted) return { profileId: job.profileId, success: false, error: 'Stopped' };
        if (signal?.aborted) return { profileId: job.profileId, success: false, error: 'Stopped' };

        // 3. Cho form password (waitForSelector nhanh hon poll loop)
        // Luon cap nhat page moi nhat truoc khi cho
        try {
            const running = job.manager.runningProfiles.get(job.profileId);
            if (running?.context) {
                const pages = running.context.pages?.() || [];
                const livePage = pages.find(p => !p.isClosed());
                if (livePage) page = livePage;
            }
        } catch (e) {}

        log('Cho form password... (toi da 5 phut)');
        try {
            await page.waitForSelector('input[type="password"]', { state: 'visible', timeout: 300000 });
        } catch (e) {
            throw new Error('Khong tim thay o nhap password sau 5 phut');
        }

        // Nhap password va nhan Enter de submit (Enter work regardless of page state sau captcha)
        const pwField = page.locator('input[type="password"]').first();
        await pwField.type(sheetRow.PassWord, { delay: 10 });
        log('Da nhap password.');
        await sleep(300);
        await pwField.press('Enter');
        log('Da submit password (Enter).');


        // Thu giai Gesture Captcha sau password (neu co)
        page = await tryGestureCaptchaOnce(page, job, signal, logger, 'post-login');

        await sleep(2000);

        // Tu dong dong popup "Save password?"
        try {
            await page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll('button'));
                const dismissBtn = buttons.find(btn =>
                    btn.textContent?.includes('Never') ||
                    btn.textContent?.includes('No thanks') ||
                    btn.textContent?.includes('Không bao giờ') ||
                    btn.textContent?.includes('Không, cảm ơn')
                );
                if (dismissBtn) dismissBtn.click();
            });
        } catch { }

        if (signal?.aborted) return { profileId: job.profileId, success: false, error: 'Stopped' };

        // 4. Xac minh: Email khoi phuc hoac 2FA
        try {
            const isEmailRecovery = isEmail(sheetRow.Recover);

            if (isEmailRecovery) {
                // ===== EMAIL KHOI PHUC =====
                try {
                    const inputField = page.locator('[name="knowledgePreregisteredEmailResponse"]').first();
                    const isInputDirectlyVisible = await inputField.isVisible().catch(() => false);
                    
                    if (!isInputDirectlyVisible) {
                        const recoveryOption = page.locator('[data-challengetype="12"]').first();
                        await recoveryOption.waitFor({ state: 'visible', timeout: 5000 });
                        await recoveryOption.click();
                        log('Da click tuy chon email khoi phuc.');
                    }
                } catch (e) {
                    log('No recovery email option button found, waiting for input field directly.');
                }

                // Cho o nhap email xuat hien (dung waitForSelector, khong sleep)
                await page.waitForSelector('[name="knowledgePreregisteredEmailResponse"]', { state: 'visible', timeout: 10000 });
                const recoverField = page.locator('[name="knowledgePreregisteredEmailResponse"]').first();
                await recoverField.type(sheetRow.Recover, { delay: 10 });
                log('Da nhap email khoi phuc.');
                await recoverField.press('Enter');
                log('Da submit email khoi phuc.');

            } else {
                // ===== 2FA (Authenticator) =====
                log('[2FA] Xu ly 2FA...');
                const inputSelector = 'input[type="tel"], input#totpPin, input[autocomplete="one-time-code"]';

                // Đợi trang chọn phương thức hoặc ô nhập OTP hiển thị đầy đủ
                const challengeSelector = `[data-challengetype], [data-challengeid], [data-challengeindex], ${inputSelector}`;
                await page.waitForSelector(challengeSelector, { state: 'visible', timeout: 15000 }).catch(() => {});

                // Kiem tra nen co hien o nhap chua
                const isInputVisible = await page.locator(inputSelector).first().isVisible({ timeout: 3000 }).catch(() => false);

                if (!isInputVisible) {
                    // Tim va click phuong thuc Authenticator
                    const clicked = await page.evaluate(() => {
                        const findAndClick = (selector) => {
                            for (const el of document.querySelectorAll(selector)) {
                                const txt = el.textContent?.toLowerCase() || '';
                                if ((txt.includes('authenticator') || txt.includes('app')) &&
                                    !txt.includes('offline') && !txt.includes('sms') && !txt.includes('security code')) {
                                    el.scrollIntoView({ block: 'center' }); el.click(); return true;
                                }
                            }
                            return false;
                        };
                        return findAndClick('[data-challengetype="6"]') ||
                               findAndClick('[data-challengeid="6"]') ||
                               findAndClick('[data-challengeid="2"]') ||
                               findAndClick('[data-challengeid="3"]') ||
                               findAndClick('li, div[role="link"], div[role="button"]');
                    }).catch(() => false);

                    if (clicked) log('[2FA] Da chon phuong thuc Authenticator.');
                }

                // Cho o nhap ma (waitForSelector - resolve ngay khi hien)
                await page.waitForSelector(inputSelector, { state: 'visible', timeout: 15000 });

                // Sinh ma va nhap
                const code = generate2FACode(sheetRow.Recover);
                log(`[2FA] Ma: ${code}`);
                if (code && code.length === 6) {
                    const inputField = page.locator(inputSelector).first();
                    await inputField.fill(code);
                    log('[2FA] Da nhap ma, submit...');
                    await inputField.press('Enter');
                } else {
                    throw new Error(`Ma 2FA khong hop le: ${code}`);
                }
            }
        } catch (error) {
            log(`Info: Skip/Manual verification (${error.message})`);
        }

        // Dismiss "Save password?" popup neu co
        try {
            await page.evaluate(() => {
                const btn = Array.from(document.querySelectorAll('button')).find(b =>
                    ['Never', 'No thanks', 'Không bao giờ', 'Không, cảm ơn'].some(t => b.textContent?.includes(t))
                );
                if (btn) btn.click();
            });
        } catch {}

        if (signal?.aborted) return { profileId: job.profileId, success: false, error: 'Stopped' };

        // 5. Cho dang nhap xong
        try { await page.waitForNavigation({ waitUntil: 'load', timeout: 30000 }); } catch {}

        log('Dang nhap xong!');
        const result = { profileId: job.profileId, success: true, data: { gmail: sheetRow.Gmail, message: 'Done!' } };
        page = null;
        return result;
    } catch (error) {
        page = null;
        return { profileId: job.profileId, success: false, error: error.message };
    } finally {
        setImmediate(() => { if (global.gc) global.gc(); });
    }
}

module.exports = { name: 'login-google-gesture', run };
