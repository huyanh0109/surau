import { Page, Browser } from 'puppeteer-core';

export class CapMonsterHelper {
    /**
     * Chuyển chế độ giải captcha (Token/Click) cho loại captcha cụ thể
     */
    static async switchCaptchaMode(page: Page, mode: 'Token' | 'Click', captchaType: 'ReCaptcha2' | 'ReCaptchaEnterprise' = 'ReCaptcha2'): Promise<void> {
        try {
            let extensionId = await this.getCapMonsterExtensionId(page.browser());
            if (!extensionId) {
                extensionId = 'gdnifgdibaknmedgkcocainknamefbnf'; // Fallback
            }
            const extensionUrl = `chrome-extension://${extensionId}/popup.html`;

            const popupPage = await page.browser().newPage();
            await popupPage.goto(extensionUrl, { waitUntil: 'networkidle2', timeout: 10000 });

            // Đợi extension load
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Click vào label có text phù hợp trong group tương ứng
            const clicked = await popupPage.evaluate((targetMode, targetType) => {
                const groupId = `captcha-clicks-or-token-${targetType}`;
                const group = document.getElementById(groupId);

                if (!group) return 'group-not-found';

                const labels = Array.from(group.querySelectorAll('label'));
                const targetLabel = labels.find(label => {
                    const text = label.textContent?.trim();
                    return text === targetMode;
                });

                if (targetLabel) {
                    (targetLabel as HTMLElement).click();
                    return 'ok';
                }
                return 'label-not-found';
            }, mode, captchaType);

            if (clicked === 'group-not-found') {
                throw new Error(`Captcha group "${captchaType}" not found in extension popup`);
            }
            if (clicked === 'label-not-found') {
                throw new Error(`${mode} radio button not found for ${captchaType}`);
            }

            await new Promise(resolve => setTimeout(resolve, 1000));
            await popupPage.close();
        } catch (error: any) {
            throw error;
        }
    }

    /**
     * Chuyển ReCaptcha2 mode sang Token
     */
    static async switchToTokenMode(page: Page): Promise<void> {
        return this.switchCaptchaMode(page, 'Token', 'ReCaptcha2');
    }

    /**
     * Chuyển ReCaptcha2 mode sang Click
     */
    static async switchToClickMode(page: Page): Promise<void> {
        return this.switchCaptchaMode(page, 'Click', 'ReCaptcha2');
    }

    /**
     * Chuyển ReCaptcha Enterprise mode sang Token
     */
    static async switchToEnterpriseTokenMode(page: Page): Promise<void> {
        return this.switchCaptchaMode(page, 'Token', 'ReCaptchaEnterprise');
    }

    /**
     * Chuyển ReCaptcha Enterprise mode sang Click
     */
    static async switchToEnterpriseClickMode(page: Page): Promise<void> {
        return this.switchCaptchaMode(page, 'Click', 'ReCaptchaEnterprise');
    }

    /**
     * Bật extension CapMonster
     */
    static async enableExtension(page: Page): Promise<void> {
        try {
            let extensionId = await this.getCapMonsterExtensionId(page.browser());
            if (!extensionId) {
                extensionId = 'gdnifgdibaknmedgkcocainknamefbnf'; // Fallback
            }
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
            let extensionId = await this.getCapMonsterExtensionId(page.browser());
            if (!extensionId) {
                extensionId = 'gdnifgdibaknmedgkcocainknamefbnf'; // Fallback
            }
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
