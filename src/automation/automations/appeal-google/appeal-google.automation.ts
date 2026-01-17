import { Page } from 'puppeteer-core';
import { AutomationEngine } from '../../engines/automation.engine';
import { AutomationJob, AutomationResult } from '../../types/automation-job';

export class AppealGoogleAutomation implements AutomationEngine {
    name = 'appeal-google';

    async run(page: Page, job: AutomationJob, signal?: AbortSignal): Promise<AutomationResult> {
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

            // 1. Kiểm tra xem có đúng trang appeal không
            const pageContent = await page.content();
            const isAppealPage =
                pageContent.includes('Your account has been disabled') ||
                pageContent.includes('account was disabled') ||
                pageContent.includes('Start appeal');

            if (!isAppealPage) {
                return {
                    profileId: job.profileId,
                    success: false,
                    error: 'Not on appeal page',
                };
            }

            // 2. Tìm button "Start appeal" bằng jsaction attribute
            const startAppealButton = await page.$(
                'button[jsaction*="click:cOuCgd"][jsaction*="mousedown:UX7yZ"]',
            );

            if (!startAppealButton) {
                return {
                    profileId: job.profileId,
                    success: false,
                    error: 'Start appeal button not found',
                };
            }

            // 4. Click vào button
            await startAppealButton.click();

            // 5. Đợi trang "Request a review" load
            await new Promise((resolve) => setTimeout(resolve, 2000));

            // 7. Tìm button "Next"
            //const nextButton = await page.$('button[jsaction*="click:cOuCgd"]');
            const nextButton = await page.$('[type="button"]');
            if (!nextButton) {
                return {
                    profileId: job.profileId,
                    success: false,
                    error: 'Next button not found',
                };
            }


            // 9. Click vào button Next
            await nextButton.click();

            // 10. Đợi trang "Tell us why your account should be restored" load
            await new Promise((resolve) => setTimeout(resolve, 2000));


            // 12. Tìm textarea để điền appeal reason
            const textarea = await page.$('[aria-label="Enter appeal reason"]');

            if (!textarea) {
                return {
                    profileId: job.profileId,
                    success: false,
                    error: 'Appeal reason textarea not found',
                };
            }

            // 13. Generate random appeal text và điền vào textarea
            const appealText = generateAppealText();
            await textarea.click(); // Focus vào textarea
            await textarea.type(appealText, { delay: 3 }); // Type nhanh hơn

            // 14. Đợi một chút sau khi điền text
            await new Promise((resolve) => setTimeout(resolve, 1000));

            // 15. Tìm button "Next" (button thứ 2)
            //const nextButton2 = await page.$('button[jsaction*="click:cOuCgd"]');
            const nextButton2 = await page.$('[type="button"]');

            if (!nextButton2) {
                return {
                    profileId: job.profileId,
                    success: false,
                    error: 'Second Next button not found',
                };
            }

            // 16. Click vào button Next
            await nextButton2.click();

            // 17. Đợi trang "Provide a contact email" load
            await new Promise((resolve) => setTimeout(resolve, 2000));


            // 19. Tìm input field để điền email
            const emailInput = await page.$('[name="contactEmailAddress"]');

            if (!emailInput) {
                return {
                    profileId: job.profileId,
                    success: false,
                    error: 'Contact email input not found',
                };
            }

            // 20. Generate random email và điền vào input
            const contactEmail = generateRandomEmail();
            await emailInput.click(); // Focus vào input
            await emailInput.type(contactEmail, { delay: 10 }); // Type với delay tự nhiên

            // 21. Đợi một chút sau khi điền email
            await new Promise((resolve) => setTimeout(resolve, 1000));

            // 22. Tìm button "Submit appeal"
            const submitButton = await page.$('button[jsaction*="click:cOuCgd"]');

            if (!submitButton) {
                return {
                    profileId: job.profileId,
                    success: false,
                    error: 'Submit appeal button not found',
                };
            }
            // 24. Click vào button Submit appeal
            await submitButton.click();

            // 25. Đợi confirmation page load (tăng lên 5s)
            await new Promise((resolve) => setTimeout(resolve, 5000));

            // 26. Kiểm tra xem có thành công không (trang "Your appeal was submitted")
            try {
                // Wait for the success text to appear
                await page.waitForFunction(
                    () => {
                        const text = document.body.innerText || '';
                        return text.includes('Your appeal was submitted') ||
                            text.includes('appeal was submitted');
                    },
                    { timeout: 10000 }
                );

                console.log('✅ Appeal submitted successfully');
            } catch (err) {
                // Fallback: check page content
                const confirmationPageContent = await page.content();
                const isAppealSubmitted =
                    confirmationPageContent.includes('Your appeal was submitted') ||
                    confirmationPageContent.includes('appeal was submitted');

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
                    // console.log(`📝 Attempting to update sheet for gmail: ${gmail}`);

                    // Lấy ngày hiện tại theo định dạng D/M/YY
                    const getCurrentDateGMT7 = (): string => {
                        const now = new Date();
                        const gmt7 = new Date(now.getTime() + (7 * 60 * 60 * 1000));

                        const day = gmt7.getUTCDate();
                        const month = gmt7.getUTCMonth() + 1;
                        const year = String(gmt7.getUTCFullYear()).slice(-2);

                        return `${day}/${month}/${year}`;
                    };

                    const currentDate = getCurrentDateGMT7();

                    // Call API để update cột F (Note) thành "appealing" và cột H (DateAppeal)
                    const updateResponse = await fetch('http://localhost:3000/sheet/update-note-and-appeal', {
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
                        console.error('Response:', responseData);
                        sheetUpdateResult = { success: false, error: errorMsg, response: responseData };
                    } else {
                        // console.log(`✅ Updated Google Sheet for ${gmail}: Note=appealing, DateAppeal=${currentDate}`);
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
