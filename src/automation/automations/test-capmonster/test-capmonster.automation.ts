import { Page } from 'puppeteer-core';
import { CapMonsterHelper } from '../../helpers/capmonster-helper';
import { AutomationEngine } from '../../engines/automation.engine';
import { AutomationJob, AutomationResult } from '../../types/automation-job';

/**
 * Test automation để switch CapMonster mode
 * Dùng để test và debug
 */
export class TestCapMonsterSwitchAutomation implements AutomationEngine {
    name = 'test-capmonster-switch';

    async run(page: Page, job: AutomationJob, signal?: AbortSignal): Promise<AutomationResult> {
        try {
            console.log(`🧪 Testing CapMonster mode switch for profile ${job.profileId}`);

            // Test 1: Switch to Token mode
            console.log('📝 Switching to Token mode...');
            await CapMonsterHelper.switchToTokenMode(page);
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Test 2: Switch to Click mode
            console.log('🖱️ Switching to Click mode...');
            await CapMonsterHelper.switchToClickMode(page);
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Test 3: Switch back to Token
            console.log('📝 Switching back to Token mode...');
            await CapMonsterHelper.switchToTokenMode(page);

            console.log('✅ CapMonster mode switch test completed!');

            return {
                profileId: job.profileId,
                success: true,
                data: { message: 'CapMonster switch test passed' },
            };
        } catch (error: any) {
            console.error(`❌ Test failed: ${error.message}`);
            return {
                profileId: job.profileId,
                success: false,
                error: error?.message,
            };
        }
    }
}
