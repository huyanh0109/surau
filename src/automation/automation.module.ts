import { Module } from '@nestjs/common';
import { AutomationController } from './automation.controller';
import { AutomationService } from './automation.service';
import { AutomationRunner } from './engines/automation-runner';
import { ChromeService } from './browser/chrome.service';

@Module({
    controllers: [AutomationController],
    providers: [AutomationService, AutomationRunner, ChromeService],
    exports: [AutomationService, ChromeService],
})
export class AutomationModule { }
