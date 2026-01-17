import { Injectable } from '@nestjs/common';
import { ChromeService } from '../browser/chrome.service';
import { AutomationEngine } from './automation.engine';
import { AutomationJob, AutomationResult } from '../types/automation-job';

@Injectable()
export class AutomationRunner {
    constructor(private readonly chromeService: ChromeService) { }

    /**
     * Chạy một automation engine trên một job
     */
    async runOne(
        engine: AutomationEngine,
        job: AutomationJob,
        signal?: AbortSignal,
    ): Promise<AutomationResult> {
        // Kiểm tra nếu đã bị abort
        if (signal?.aborted) {
            return {
                profileId: job.profileId,
                success: false,
                error: 'Automation stopped',
            };
        }

        let browser;

        try {
            browser = await this.chromeService.connect(job.remoteDebugAddress);
            const page = await this.chromeService.getOrCreatePage(browser);

            // Chạy automation
            const result = await engine.run(page, job, signal);

            return result;
        } catch (error: any) {
            return {
                profileId: job.profileId,
                success: false,
                error: error?.message || 'Unknown error',
            };
        }
    }

    /**
     * Chạy automation engine trên nhiều jobs song song
     */
    async runMany(
        engine: AutomationEngine,
        jobs: AutomationJob[],
        signal?: AbortSignal,
    ): Promise<AutomationResult[]> {
        return Promise.all(jobs.map(job => this.runOne(engine, job, signal)));
    }
}
