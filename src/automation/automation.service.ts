import { Injectable } from '@nestjs/common';
import { AutomationRunner } from './engines/automation-runner';
import { AutomationJob, AutomationResult } from './types/automation-job';
import { LoginGoogleAutomation } from './automations/login-google/login-google.automation';
import { VerifyPhoneSheetAutomation } from './automations/verify-phone-sheet/verify-phone-sheet.automation';
import { VerifyPhoneSheetCheckAutomation } from './automations/verify-phone-sheet-check/verify-phone-sheet-check.automation';
import { AppealGoogleAutomation } from './automations/appeal-google/appeal-google.automation';
import { CheckPhoneVerifyAutomation } from './automations/check-phone-verify/check-phone-verify.automation';
import { LogoutGoogleAutomation } from './automations/logout-google/logout-google.automation';
import { Setup2FAAutomation } from './automations/setup-2fa/setup-2fa.automation';
import { PasswordGoogleAutomation } from './automations/password-google/password-google.automation';
import { SolveCaptchaApiAutomation } from './automations/solve-captcha-api/solve-captcha-api.automation';
import { LoginCaptchaRetryAutomation } from './automations/login-captcha-retry/login-captcha-retry.automation';
import { SolveCaptchaContinuousAutomation } from './automations/solve-captcha-continuous/solve-captcha-continuous.automation';
import { AutomationEngine } from './engines/automation.engine';
import { ChromeService } from './browser/chrome.service';
import { CapMonsterHelper } from './helpers/capmonster-helper';
import { LogStreamService } from '../log-stream/log-stream.service';

// Registry các automation
const automationRegistry: Record<string, () => AutomationEngine> = {
    'login-google': () => new LoginGoogleAutomation(),
    'verify-phone-sheet': () => new VerifyPhoneSheetAutomation(),
    'verify-phone-sheet-check': () => new VerifyPhoneSheetCheckAutomation(),
    'appeal-google': () => new AppealGoogleAutomation(),
    'check-phone-verify': () => new CheckPhoneVerifyAutomation(),
    'logout-google': () => new LogoutGoogleAutomation(),
    'setup-2fa': () => new Setup2FAAutomation(),
    'password-google': () => new PasswordGoogleAutomation(),
    'solve-captcha-api': () => new SolveCaptchaApiAutomation(),
    'login-captcha-retry': () => new LoginCaptchaRetryAutomation(),
    'solve-captcha-continuous': () => new SolveCaptchaContinuousAutomation(),
};

@Injectable()
export class AutomationService {
    private abortControllers: Map<string, AbortController> = new Map();
    private runningStatus: Map<string, boolean> = new Map();

    constructor(
        private readonly runner: AutomationRunner,
        private readonly chromeService: ChromeService,
        private readonly logStream: LogStreamService,
    ) { }

    /**
     * Kiểm tra xem automation có đang chạy không
     */
    getStatus() {
        const isRunning = Array.from(this.runningStatus.values()).some(v => v === true);
        return { isRunning, runningTasks: Object.fromEntries(this.runningStatus) };
    }

    /**
     * Dừng automation đang chạy
     */
    stopAutomation(automationName?: string) {
        if (automationName) {
            const controller = this.abortControllers.get(automationName);
            if (controller) {
                controller.abort();
                this.abortControllers.delete(automationName);
            }
            this.runningStatus.set(automationName, false);
        } else {
            for (const controller of this.abortControllers.values()) {
                controller.abort();
            }
            this.abortControllers.clear();
            this.runningStatus.clear();
        }
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

        // Tạo AbortController mới riêng cho automation này
        if (this.abortControllers.has(automationName)) {
            // Dừng tiến trình cũ nếu nó đang chạy
            this.stopAutomation(automationName);
        }

        const controller = new AbortController();
        this.abortControllers.set(automationName, controller);
        this.runningStatus.set(automationName, true);

        const engine = engineFactory();

        try {
            const results = await this.runner.runMany(engine, jobs, controller.signal, this.logStream);

            this.runningStatus.set(automationName, false);
            this.abortControllers.delete(automationName);

            return {
                success: results.every(r => r.success),
                results,
            };
        } catch (error: any) {
            this.runningStatus.set(automationName, false);
            this.abortControllers.delete(automationName);

            if (error.name === 'AbortError' || controller.signal.aborted) {
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
        captchaType: 'ReCaptcha2' | 'ReCaptchaEnterprise' = 'ReCaptcha2',
    ): Promise<{ success: boolean; results: any[] }> {
        const results = await Promise.all(
            profiles.map(async (profileInfo) => {
                try {
                    const browser = await this.chromeService.connect(profileInfo.remoteDebugAddress);
                    const page = await this.chromeService.getOrCreatePage(browser);

                    const formattedMode = mode === 'token' ? 'Token' : 'Click';
                    await CapMonsterHelper.switchCaptchaMode(page, formattedMode, captchaType);

                    return {
                        profileId: profileInfo.profileId,
                        success: true,
                        mode,
                        captchaType,
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
