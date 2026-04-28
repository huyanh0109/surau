import { Page } from 'puppeteer-core';
import { AutomationJob, AutomationResult } from '../types/automation-job';
import { LogStreamService } from '../../log-stream/log-stream.service';

/**
 * Interface chung cho toàn bộ module automation
 */
export interface AutomationEngine {
    /**
     * Tên automation
     */
    name: string;

    /**
     * Chạy automation trên một page
     */
    run(page: Page, job: AutomationJob, signal?: AbortSignal, logger?: LogStreamService): Promise<AutomationResult>;
}
