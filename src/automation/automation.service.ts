import { Injectable } from '@nestjs/common';
import { AutomationRunner } from './engines/automation-runner';
import { AutomationJob, AutomationResult } from './types/automation-job';
import { LoginGoogleAutomation } from './automations/login-google/login-google.automation';
import { VerifyPhoneSheetAutomation } from './automations/verify-phone-sheet/verify-phone-sheet.automation';
import { AppealGoogleAutomation } from './automations/appeal-google/appeal-google.automation';
import { CheckPhoneVerifyAutomation } from './automations/check-phone-verify/check-phone-verify.automation';
import { LogoutGoogleAutomation } from './automations/logout-google/logout-google.automation';
import { AutomationEngine } from './engines/automation.engine';
import { ChromeService } from './browser/chrome.service';
import { CapMonsterHelper } from './helpers/capmonster-helper';

// Registry các automation
const automationRegistry: Record<string, () => AutomationEngine> = {
    'login-google': () => new LoginGoogleAutomation(),
    'verify-phone-sheet': () => new VerifyPhoneSheetAutomation(),
    'appeal-google': () => new AppealGoogleAutomation(),
    'check-phone-verify': () => new CheckPhoneVerifyAutomation(),
    'logout-google': () => new LogoutGoogleAutomation(),
};

@Injectable()
export class AutomationService {
    private abortController: AbortController | null = null;
    private isRunning = false;

    constructor(
        private readonly runner: AutomationRunner,
        private readonly chromeService: ChromeService,
    ) { }

    /**
     * Kiểm tra xem automation có đang chạy không
     */
    getStatus() {
        return {
            isRunning: this.isRunning,
        };
    }

    /**
     * Dừng automation đang chạy
     */
    stopAutomation() {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
        this.isRunning = false;
        return { stopped: true };
    }

    /**
     * Chạy automation theo tên
     */
    async runAutomation(
        automationName: string,
        jobs: AutomationJob[],
    ): Promise<{ success: boolean; results: AutomationResult[]; stopped?: boolean }> {
        const engineFactory = automationRegistry[automationName];

        if (!engineFactory) {
            throw new Error(`Automation "${automationName}" not found`);
        }

        // Tạo AbortController mới
        this.abortController = new AbortController();
        this.isRunning = true;

        const engine = engineFactory();

        try {
            const results = await this.runner.runMany(engine, jobs, this.abortController.signal);

            this.isRunning = false;

            return {
                success: results.every(r => r.success),
                results,
            };
        } catch (error: any) {
            this.isRunning = false;

            if (error.name === 'AbortError' || this.abortController?.signal.aborted) {
                return {
                    success: false,
                    results: [],
                    stopped: true,
                };
            }

            throw error;
        }
    }

    /**
     * Lấy danh sách automation có sẵn
     */
    getAvailableAutomations(): string[] {
        return Object.keys(automationRegistry);
    }

    /**
     * Switch CapMonster mode for all opened profiles
     */
    async switchCapMonsterMode(
        profiles: { profileId: string; remoteDebugAddress: string }[],
        mode: 'token' | 'click',
    ): Promise<{ success: boolean; results: any[] }> {
        const results = await Promise.all(
            profiles.map(async (profileInfo) => {
                try {
                    const browser = await this.chromeService.connect(profileInfo.remoteDebugAddress);
                    const page = await this.chromeService.getOrCreatePage(browser);

                    if (mode === 'token') {
                        await CapMonsterHelper.switchToTokenMode(page);
                    } else {
                        await CapMonsterHelper.switchToClickMode(page);
                    }

                    return {
                        profileId: profileInfo.profileId,
                        success: true,
                        mode,
                    };
                } catch (error: any) {
                    return {
                        profileId: profileInfo.profileId,
                        success: false,
                        error: error?.message,
                    };
                }
            }),
        );

        return {
            success: results.every(r => r.success),
            results,
        };
    }

    /**
     * Enable or disable CapMonster extension
     */
    async toggleCapMonster(
        profiles: { profileId: string; remoteDebugAddress: string }[],
        action: 'enable' | 'disable',
    ): Promise<{ success: boolean; results: any[] }> {
        const results = await Promise.all(
            profiles.map(async (profileInfo) => {
                try {
                    const browser = await this.chromeService.connect(profileInfo.remoteDebugAddress);
                    const page = await this.chromeService.getOrCreatePage(browser);

                    if (action === 'enable') {
                        await CapMonsterHelper.enableExtension(page);
                    } else {
                        await CapMonsterHelper.disableExtension(page);
                    }

                    return {
                        profileId: profileInfo.profileId,
                        success: true,
                        action,
                    };
                } catch (error: any) {
                    return {
                        profileId: profileInfo.profileId,
                        success: false,
                        error: error?.message,
                    };
                }
            }),
        );

        return {
            success: results.every(r => r.success),
            results,
        };
    }
}
