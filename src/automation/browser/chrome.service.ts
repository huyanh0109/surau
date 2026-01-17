import { Injectable } from '@nestjs/common';
import puppeteer, { Browser } from 'puppeteer-core';

@Injectable()
export class ChromeService {
    /**
     * Kết nối đến browser đang chạy qua remote debugging
     */
    async connect(remoteDebugAddress: string): Promise<Browser> {
        const browser = await puppeteer.connect({
            browserURL: `http://${remoteDebugAddress}`,
            defaultViewport: null,
        });

        return browser;
    }

    /**
     * Lấy page đầu tiên hoặc tạo page mới
     */
    async getOrCreatePage(browser: Browser) {
        const pages = await browser.pages();
        return pages.length ? pages[0] : await browser.newPage();
    }

    /**
     * Lấy URL hiện tại từ browser
     */
    async getCurrentUrl(remoteDebugAddress: string): Promise<string | null> {
        let browser: Browser | null = null;
        try {
            browser = await this.connect(remoteDebugAddress);
            const page = await this.getOrCreatePage(browser);
            const url = page.url();
            return url || null;
        } catch (error: any) {
            return null;
        } finally {
            // Không đóng browser vì nó đang được dùng
        }
    }
}
