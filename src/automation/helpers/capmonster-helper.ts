import { Page, Browser } from 'puppeteer-core';

export class CapMonsterHelper {
    /**
     * Chuyển ReCaptcha2 mode sang Token
     */
    static async switchToTokenMode(page: Page): Promise<void> {
        try {
            const extensionId = 'iiaoghhehhhblbajkopbiebfenlfnecl';
            const extensionUrl = `chrome-extension://${extensionId}/popup.html`;

            const popupPage = await page.browser().newPage();
            await popupPage.goto(extensionUrl, { waitUntil: 'networkidle2', timeout: 10000 });

            // Đợi extension load
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Click vào label có text "Token" (Ant Design Radio)
            const clicked = await popupPage.evaluate(() => {
                const labels = Array.from(document.querySelectorAll('label'));
                const tokenLabel = labels.find(label => {
                    const text = label.textContent?.trim();
                    return text === 'Token';
                });

                if (tokenLabel) {
                    (tokenLabel as HTMLElement).click();
                    return true;
                }
                return false;
            });

            if (!clicked) {
                throw new Error('Token radio button not found');
            }

            await new Promise(resolve => setTimeout(resolve, 1000));
            await popupPage.close();
        } catch (error: any) {
            throw error;
        }
    }

    /**
     * Chuyển ReCaptcha2 mode sang Click
     */
    static async switchToClickMode(page: Page): Promise<void> {
        try {
            const extensionId = 'iiaoghhehhhblbajkopbiebfenlfnecl';
            const extensionUrl = `chrome-extension://${extensionId}/popup.html`;

            const popupPage = await page.browser().newPage();
            await popupPage.goto(extensionUrl, { waitUntil: 'networkidle2', timeout: 10000 });

            await new Promise(resolve => setTimeout(resolve, 2000));

            // Click vào label có text "Click" (Ant Design Radio)
            const clicked = await popupPage.evaluate(() => {
                const labels = Array.from(document.querySelectorAll('label'));
                const clickLabel = labels.find(label => {
                    const text = label.textContent?.trim();
                    return text === 'Click';
                });

                if (clickLabel) {
                    (clickLabel as HTMLElement).click();
                    return true;
                }
                return false;
            });

            if (!clicked) {
                throw new Error('Click radio button not found');
            }

            await new Promise(resolve => setTimeout(resolve, 1000));
            await popupPage.close();
        } catch (error: any) {
            throw error;
        }
    }

    /**
     * Bật extension CapMonster
     */
    static async enableExtension(page: Page): Promise<void> {
        try {
            const extensionId = 'iiaoghhehhhblbajkopbiebfenlfnecl';
            const extensionUrl = `chrome-extension://${extensionId}/popup.html`;

            const popupPage = await page.browser().newPage();
            await popupPage.goto(extensionUrl, { waitUntil: 'networkidle2', timeout: 10000 });

            await new Promise(resolve => setTimeout(resolve, 2000));

            // Click vào switch nếu đang OFF
            const enabled = await popupPage.evaluate(() => {
                const switchBtn = document.getElementById('main-extension-enabled-switch') as HTMLButtonElement;
                if (switchBtn) {
                    // Kiểm tra nếu switch chưa bật (không có class checked)
                    const isChecked = switchBtn.getAttribute('aria-checked') === 'true';
                    if (!isChecked) {
                        switchBtn.click();
                        return 'turned-on';
                    }
                    return 'already-on';
                }
                return 'not-found';
            });

            if (enabled === 'not-found') {
                throw new Error('Extension switch not found');
            }

            await new Promise(resolve => setTimeout(resolve, 1000));
            await popupPage.close();
        } catch (error: any) {
            throw error;
        }
    }

    /**
     * Tắt extension CapMonster
     */
    static async disableExtension(page: Page): Promise<void> {
        try {
            const extensionId = 'iiaoghhehhhblbajkopbiebfenlfnecl';
            const extensionUrl = `chrome-extension://${extensionId}/popup.html`;

            const popupPage = await page.browser().newPage();
            await popupPage.goto(extensionUrl, { waitUntil: 'networkidle2', timeout: 10000 });

            await new Promise(resolve => setTimeout(resolve, 2000));

            // Click vào switch nếu đang ON
            const disabled = await popupPage.evaluate(() => {
                const switchBtn = document.getElementById('main-extension-enabled-switch') as HTMLButtonElement;
                if (switchBtn) {
                    const isChecked = switchBtn.getAttribute('aria-checked') === 'true';
                    if (isChecked) {
                        switchBtn.click();
                        return 'turned-off';
                    }
                    return 'already-off';
                }
                return 'not-found';
            });

            if (disabled === 'not-found') {
                throw new Error('Extension switch not found');
            }

            await new Promise(resolve => setTimeout(resolve, 1000));
            await popupPage.close();
        } catch (error: any) {
            throw error;
        }
    }

    /**
     * Lấy extension ID của CapMonster từ browser
     */
    static async getCapMonsterExtensionId(browser: Browser): Promise<string | null> {
        try {
            const targets = await browser.targets();
            const extensionTarget = targets.find(target =>
                target.url().includes('chrome-extension://') &&
                target.url().includes('capmonster')
            );

            if (extensionTarget) {
                const url = extensionTarget.url();
                const match = url.match(/chrome-extension:\/\/([a-z]+)\//);
                if (match) {
                    return match[1];
                }
            }
            return null;
        } catch (error) {
            return null;
        }
    }
}
