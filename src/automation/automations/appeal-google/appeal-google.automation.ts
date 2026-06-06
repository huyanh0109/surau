import { Page } from 'puppeteer-core';
import { AutomationEngine } from '../../engines/automation.engine';
import { AutomationJob, AutomationResult } from '../../types/automation-job';
import { LogStreamService } from '../../../log-stream/log-stream.service';

async function clickAppealButton(page: Page, allowedTexts: string[]): Promise<boolean> {
    const clicked = await page.evaluate((texts) => {
        const buttons = Array.from(document.querySelectorAll('button'));
        for (const btn of buttons) {
            const style = window.getComputedStyle(btn);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
                continue;
            }
            if ((btn as HTMLButtonElement).disabled) {
                continue;
            }
            const txt = (btn.textContent || '').trim().toLowerCase();
            // Skip email selection button and language selection buttons
            if (txt.includes('@') || txt.includes('english') || txt.includes('tiếng việt') || txt.includes('help') || txt.includes('trợ giúp')) {
                continue;
            }
            // Skip back buttons
            if (txt === 'back' || txt === 'quay lại' || txt.includes('back') || txt.includes('quay lại')) {
                continue;
            }
            for (const target of texts) {
                if (txt === target.toLowerCase() || txt.includes(target.toLowerCase())) {
                    (btn as HTMLButtonElement).click();
                    return true;
                }
            }
        }
        return false;
    }, allowedTexts);

    return clicked;
}

export class AppealGoogleAutomation implements AutomationEngine {
    name = 'appeal-google';

    async run(page: Page, job: AutomationJob, signal?: AbortSignal, logger?: LogStreamService): Promise<AutomationResult> {
        const log = (msg: string) => { logger?.(msg); console.log(`[P${job.profileId}] ${msg}`); };
        try {
            if (signal?.aborted) {
                return { profileId: job.profileId, success: false, error: 'Stopped' };
            }

            // Helper function to get random element
            const getRandomElement = (arr: string[]): string => {
                return arr[Math.floor(Math.random() * arr.length)];
            };

            // Generate random appeal text
            const generateAppealText = (): string => {
                const aOptions = [
                    'Dear Gmail Support Team!',
                    'Dear Google Support Team!',
                    'Dear Google Support!',
                    'Dear Google!',
                    'Dear Support Team!',
                    'Dear Admin!',
                    'Dear Admin Google!',
                ];
                const bOptions = [
                    'I logged in and used the account normally, fully complying with all of Google\'s policies.',
                    'I have been accessing and using my account regularly without violating any of Google\'s regulations.',
                    'I was using the account as usual and did not breach any of Google\'s rules.',
                    'I signed in and operated my account without any issues, adhering strictly to Google\'s guidelines.',
                    'I used my account normally and did not break any of Google\'s terms of service.',
                ];
                const cOptions = [
                    'I use the account to upload and store data for my work.',
                    'I utilize the account for uploading and storing data necessary for my job.',
                    'I use the account for uploading and saving data related to my work tasks.',
                    'I employ the account to upload and archive data for my professional activities.',
                    'I leverage the account to upload and keep data essential for my work.',
                ];
                const dOptions = [
                    'I hope Google will review the issue of my account being locked and unlock it for me.',
                    'I trust that Google will reconsider the situation with my locked account and help me regain access.',
                    'I am hopeful that Google will reassess the matter regarding my locked account and unlock it for me.',
                    'I kindly ask Google to re-evaluate my account\'s locked status and assist in unlocking it.',
                    'I wish for Google to look into the problem of my account being locked and unlock it on my behalf.',
                ];
                const fOptions = [
                    'I always comply with Google\'s rules and policies. I do not use third-party software or anything that would violate these regulations.',
                    'I adhere strictly to Google\'s guidelines and policies. I never use third-party software or engage in activities that breach these rules.',
                    'I consistently follow Google\'s regulations and policies. I refrain from using any third-party software or actions that violate these guidelines.',
                    'I am always in compliance with Google\'s rules and policies. I avoid using any third-party software or anything that contravenes these regulations.',
                    'I strictly observe Google\'s policies and rules. I do not utilize any third-party software or engage in activities that violate these guidelines.',
                ];
                const eOptions = [
                    'Thank you for your time and consideration!',
                    'Thanks!',
                    'Thank You!',
                    'Thank you for your support!',
                    'Thank you for your help!',
                ];

                const a = getRandomElement(aOptions);
                const b = getRandomElement(bOptions);
                const c = getRandomElement(cOptions);
                const d = getRandomElement(dOptions);
                const e = getRandomElement(eOptions);
                const f = getRandomElement(fOptions);

                return `${a} ${b} ${c} ${d} ${f} ${e}`;
            };

            // Generate random email
            const generateRandomEmail = (): string => {
                const names = [
                    'john',
                    'jane',
                    'mike',
                    'sarah',
                    'david',
                    'emily',
                    'robert',
                    'lisa',
                    'james',
                    'maria',
                ];
                const surnames = [
                    'smith',
                    'johnson',
                    'brown',
                    'williams',
                    'jones',
                    'davis',
                    'miller',
                    'wilson',
                    'moore',
                    'taylor',
                ];
                const domains = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com'];

                const name = getRandomElement(names);
                const surname = getRandomElement(surnames);
                const randomNum = Math.floor(Math.random() * 9999);
                const domain = getRandomElement(domains);

                return `${name}.${surname}${randomNum}@${domain}`;
            };

            let appealText = '';
            let contactEmail = '';
            let pageContent = await page.content();
            const hasText = (t: string) => pageContent.toLowerCase().includes(t.toLowerCase());

            // Nhận diện các trang/bước của Google Appeal
            const isRequestReviewPage = hasText('Request a review') || hasText('review of your account') || hasText('Step 1 of 3') || hasText('Step 1/') || hasText('Bước 1/') || hasText('Yêu cầu xem xét') || hasText('xem xét tài khoản');
            const isOnStep2 = hasText('Step 2 of 3') || hasText('Step 2/') || hasText('Bước 2/') || hasText('Enter appeal reason') || hasText('Nhập lý do khiếu nại') || (await page.$('textarea')) !== null;
            const isOnStep3 = hasText('Step 3 of 3') || hasText('Step 3/') || hasText('Bước 3/') || hasText('contactEmailAddress') || (await page.$('[name="contactEmailAddress"]')) !== null;
            const isInitialDisabledPage = hasText('Your account has been disabled') || hasText('account was disabled') || hasText('Start appeal') || hasText('Bắt đầu khiếu nại') || hasText('tài khoản đã bị vô hiệu') || hasText('tài khoản bị vô hiệu') || hasText('vô hiệu hóa');

            const isAppealPage = isInitialDisabledPage || isRequestReviewPage || isOnStep2 || isOnStep3;
            if (!isAppealPage) {
                return {
                    profileId: job.profileId,
                    success: false,
                    error: 'Not on appeal page',
                };
            }

            // --- BƯỚC 1: NHẤN "START APPEAL" ---
            if (!isRequestReviewPage && !isOnStep2 && !isOnStep3) {
                log('Đang ở trang thông báo bị vô hiệu hóa. Tìm nút Start Appeal...');
                const startBtn = await page.$('button[jsaction*="click:cOuCgd"][jsaction*="mousedown:UX7yZ"]');
                let clickedStart = false;
                if (startBtn) {
                    await startBtn.click();
                    clickedStart = true;
                } else {
                    clickedStart = await clickAppealButton(page, ['Start appeal', 'Bắt đầu khiếu nại', 'Bắt đầu']);
                }

                if (!clickedStart) {
                    await new Promise((resolve) => setTimeout(resolve, 2000));
                    pageContent = await page.content();
                    const nowOnReview = hasText('Request a review') || hasText('Step 1 of 3') || hasText('Bước 1/') || hasText('Yêu cầu xem xét');
                    if (!nowOnReview) {
                        return { profileId: job.profileId, success: false, error: 'Start appeal button not found' };
                    }
                } else {
                    await new Promise((resolve) => setTimeout(resolve, 2000));
                }
            }

            // --- BƯỚC 2: CLICK NEXT Ở BƯỚC 1 (Request a Review) ---
            pageContent = await page.content();
            const currentlyOnStep1 = hasText('Request a review') || hasText('Step 1 of 3') || hasText('Bước 1/') || hasText('Yêu cầu xem xét') || hasText('xem xét tài khoản');
            const currentlyOnStep2 = hasText('Step 2 of 3') || hasText('Step 2/') || hasText('Bước 2/') || hasText('Enter appeal reason') || hasText('Nhập lý do khiếu nại') || (await page.$('textarea')) !== null;
            const currentlyOnStep3 = hasText('Step 3 of 3') || hasText('Step 3/') || hasText('Bước 3/') || hasText('contactEmailAddress') || (await page.$('[name="contactEmailAddress"]')) !== null;

            if (currentlyOnStep1 && !currentlyOnStep2 && !currentlyOnStep3) {
                log('Đang ở trang Request a review (Bước 1). Nhấn Next...');
                const clickedNext1 = await clickAppealButton(page, ['Next', 'Tiếp theo', 'Tiếp tục', 'Continue']);
                if (!clickedNext1) {
                    return { profileId: job.profileId, success: false, error: 'Next button not found' };
                }
                await new Promise((resolve) => setTimeout(resolve, 2000));
            }

            // --- BƯỚC 3: NHẬP LÝ DO APPEAL Ở BƯỚC 2 ---
            pageContent = await page.content();
            const nowOnStep2 = hasText('Step 2 of 3') || hasText('Step 2/') || hasText('Bước 2/') || hasText('Enter appeal reason') || hasText('Nhập lý do khiếu nại') || (await page.$('textarea')) !== null;
            const nowOnStep3 = hasText('Step 3 of 3') || hasText('Step 3/') || hasText('Bước 3/') || hasText('contactEmailAddress') || (await page.$('[name="contactEmailAddress"]')) !== null;

            if (nowOnStep2 && !nowOnStep3) {
                log('Đang ở trang nhập lý do khiếu nại (Bước 2)...');
                let textarea = await page.$('[aria-label="Enter appeal reason"]');
                if (!textarea) {
                    textarea = await page.$('textarea');
                }
                if (!textarea) {
                    return { profileId: job.profileId, success: false, error: 'Appeal reason textarea not found' };
                }

                appealText = generateAppealText();
                await textarea.click();
                await textarea.type(appealText, { delay: 3 });
                await new Promise((resolve) => setTimeout(resolve, 1000));

                log('Nhấn Next ở Bước 2...');
                const clickedNext2 = await clickAppealButton(page, ['Next', 'Tiếp theo', 'Tiếp tục', 'Continue']);
                if (!clickedNext2) {
                    return { profileId: job.profileId, success: false, error: 'Second Next button not found' };
                }
                await new Promise((resolve) => setTimeout(resolve, 2000));
            }

            // --- BƯỚC 4: NHẬP CONTACT EMAIL VÀ SUBMIT Ở BƯỚC 3 ---
            pageContent = await page.content();
            const nowOnStep3Final = hasText('Step 3 of 3') || hasText('Step 3/') || hasText('Bước 3/') || hasText('contactEmailAddress') || (await page.$('[name="contactEmailAddress"]')) !== null;

            if (nowOnStep3Final) {
                log('Đang ở trang cung cấp email liên hệ (Bước 3)...');
                let emailInput = await page.$('[name="contactEmailAddress"]');
                if (!emailInput) {
                    emailInput = await page.$('input[type="email"]');
                }
                if (!emailInput) {
                    return { profileId: job.profileId, success: false, error: 'Contact email input not found' };
                }

                contactEmail = generateRandomEmail();
                await emailInput.click();
                await emailInput.type(contactEmail, { delay: 10 });
                await new Promise((resolve) => setTimeout(resolve, 1000));

                log('Nhấn nút gửi (Submit)...');
                const clickedSubmit = await clickAppealButton(page, ['Submit', 'Gửi', 'Hoàn tất', 'Done']);
                if (!clickedSubmit) {
                    return { profileId: job.profileId, success: false, error: 'Submit appeal button not found' };
                }
                await new Promise((resolve) => setTimeout(resolve, 5000));
            }

            // Kiểm tra thành công
            try {
                await page.waitForFunction(
                    () => {
                        const text = document.body.innerText || '';
                        return text.includes('Your appeal was submitted') ||
                            text.includes('appeal was submitted') ||
                            text.includes('khiếu nại của bạn đã được gửi') ||
                            text.includes('đã được gửi');
                    },
                    { timeout: 10000 }
                );
                console.log('✅ Appeal submitted successfully');
            } catch (err) {
                const confirmationPageContent = await page.content();
                const lowerHtml = confirmationPageContent.toLowerCase();
                const isAppealSubmitted =
                    lowerHtml.includes('appeal was submitted') ||
                    lowerHtml.includes('khiếu nại của bạn đã được gửi') ||
                    lowerHtml.includes('đã được gửi');

                if (!isAppealSubmitted) {
                    return {
                        profileId: job.profileId,
                        success: false,
                        error: 'Appeal submission confirmation page not found',
                    };
                }
            }

            // 27. Lấy gmail từ sheetRow để update Google Sheet
            const gmail = job.sheetRow?.Gmail;
            let sheetUpdateResult: any = null;

            if (gmail) {
                try {
                    const getCurrentDateGMT7 = (): string => {
                        const now = new Date();
                        const gmt7 = new Date(now.getTime() + (7 * 60 * 60 * 1000));

                        const day = gmt7.getUTCDate();
                        const month = gmt7.getUTCMonth() + 1;
                        const year = String(gmt7.getUTCFullYear()).slice(-2);

                        return `${day}/${month}/${year}`;
                    };

                    const currentDate = getCurrentDateGMT7();

                    const updateResponse = await fetch('http://localhost:3500/sheet/update-note-and-appeal', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            gmail: gmail,
                            note: 'appealing',
                            dateAppeal: currentDate,
                        }),
                    });

                    const responseData = await updateResponse.json();

                    if (!updateResponse.ok) {
                        const errorMsg = `Failed to update sheet for ${gmail}: ${updateResponse.status} ${updateResponse.statusText}`;
                        console.error(errorMsg);
                        sheetUpdateResult = { success: false, error: errorMsg, response: responseData };
                    } else {
                        sheetUpdateResult = { success: true, ...responseData };
                    }
                } catch (error: any) {
                    const errorMsg = `Error updating sheet for ${gmail}: ${error.message}`;
                    console.error(errorMsg);
                    sheetUpdateResult = { success: false, error: errorMsg };
                }
            } else {
                console.warn('⚠️ No Gmail found in sheetRow, cannot update sheet');
                sheetUpdateResult = { success: false, error: 'No Gmail in sheetRow' };
            }

            return {
                profileId: job.profileId,
                success: true,
                data: {
                    message: 'Appeal process fully completed successfully!',
                    appealText: appealText,
                    contactEmail: contactEmail,
                    gmail: gmail,
                    sheetUpdateResult: sheetUpdateResult,
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
}
