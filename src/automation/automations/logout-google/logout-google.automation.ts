import { Page } from 'puppeteer-core';
import { AutomationEngine } from '../../engines/automation.engine';
import { AutomationJob, AutomationResult } from '../../types/automation-job';
import { LogStreamService } from '../../../log-stream/log-stream.service';

export class LogoutGoogleAutomation implements AutomationEngine {
    name = 'logout-google';

    async run(page: Page, job: AutomationJob, signal?: AbortSignal, logger?: LogStreamService): Promise<AutomationResult> {
        try {
            if (signal?.aborted) {
                return { profileId: job.profileId, success: false, error: 'Stopped' };
            }

            // 1. Mở trang logout
            await page.goto('https://accounts.google.com/SignOutOptions?hl=vi&continue=https://one.google.com/settings%3Fexpand%3Dupgrade&ec=GBRAywM', {
                waitUntil: 'networkidle2',
            });

            if (signal?.aborted) {
                return { profileId: job.profileId, success: false, error: 'Stopped' };
            }

            // 2. Đợi trang load
            await new Promise(resolve => setTimeout(resolve, 2000));

            // 3. Tìm và click vào button signout
            try {
                await page.waitForSelector('[name="signout"]', { visible: true, timeout: 10000 });
                await page.click('[name="signout"]');
            } catch (err: any) {
                // Có thể đã logout rồi hoặc không tìm thấy button
                return {
                    profileId: job.profileId,
                    success: false,
                    error: 'Signout button not found - may already be logged out',
                };
            }

            // 4. Đợi logout hoàn tất
            await new Promise(resolve => setTimeout(resolve, 2000));

            return {
                profileId: job.profileId,
                success: true,
                data: { message: 'Logged out successfully!' },
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
