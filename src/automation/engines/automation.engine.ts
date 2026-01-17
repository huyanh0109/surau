import { Page } from 'puppeteer-core';
import { AutomationJob, AutomationResult } from '../types/automation-job';

/**
 * Interface chung cho tất cả automation
 */
export interface AutomationEngine {
    /**
     * Tên automation
     */
    name: string;

    /**
     * Chạy automation trên một page
     */
    run(page: Page, job: AutomationJob, signal?: AbortSignal): Promise<AutomationResult>;
}
